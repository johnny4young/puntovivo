/**
 * Runs the adapter against the real SDK and a local ingest server, so an SDK
 * default change cannot hide behind the mocked adapter tests.
 */
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import Module from 'node:module';
import { gunzipSync } from 'node:zlib';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  __resetServerTelemetryAdapterForTests,
  flushServerTelemetry,
  initServerTelemetryAdapter,
} from '../observability/sentry.js';
import { getActiveTelemetrySink, noopSink, registerTelemetrySink } from '../observability/sink.js';

type ModuleWithCompile = { prototype: { _compile: unknown } };

describe('Sentry adapter envelopes', () => {
  const items: Array<{ type: string; payload: Record<string, unknown> }> = [];
  const compileBeforeInit = (Module as unknown as ModuleWithCompile).prototype._compile;
  let ingest: Server;

  beforeAll(async () => {
    ingest = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', chunk => chunks.push(chunk));
      req.on('end', () => {
        const raw = Buffer.concat(chunks);
        const body = req.headers['content-encoding'] === 'gzip' ? gunzipSync(raw) : raw;
        const lines = body.toString().split('\n');
        for (let i = 1; i + 1 < lines.length; i += 2) {
          items.push({ type: JSON.parse(lines[i]!).type, payload: JSON.parse(lines[i + 1]!) });
        }
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end('{}');
      });
    });
    await new Promise<void>(resolve => ingest.listen(0, '127.0.0.1', resolve));
    const { port } = ingest.address() as AddressInfo;

    await initServerTelemetryAdapter({
      env: {
        PUNTOVIVO_SENTRY_DSN: `http://key@127.0.0.1:${port}/1`,
        PUNTOVIVO_SENTRY_TRACES_SAMPLE_RATE: '1',
      },
      appVersion: '1.2.3',
    });
    const sink = getActiveTelemetrySink();
    sink.captureException(new Error('boom'), { step: 'checkout' });
    sink.recordSpan('sale.commit', { step: 'checkout' }, 5, 'ok');
    await flushServerTelemetry();
  });

  afterAll(async () => {
    registerTelemetrySink(noopSink);
    __resetServerTelemetryAdapterForTests();
    await new Promise(resolve => ingest.close(resolve));
  });

  it('sends spans as transactions rather than streamed span items', () => {
    expect(items.map(item => item.type).sort()).toEqual(['event', 'transaction']);
  });

  it('sends only the explicit capture data, without host or request identity', () => {
    for (const { payload } of items) {
      expect(payload).not.toHaveProperty('server_name');
      expect(payload).not.toHaveProperty('user');
      expect(payload).not.toHaveProperty('request');
    }
    const event = items.find(item => item.type === 'event')?.payload;
    expect(event?.extra).toEqual({ step: 'checkout' });
  });

  it('leaves the module loader unpatched', () => {
    expect((Module as unknown as ModuleWithCompile).prototype._compile).toBe(compileBeforeInit);
  });
});
