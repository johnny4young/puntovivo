/** Exercise our adapter against the installed SDK; only the transport is replaced. */
import { afterEach, expect, it, vi } from 'vitest';
import * as Sentry from '@sentry/node';
import {
  initServerTelemetryAdapter,
  flushServerTelemetry,
  __resetServerTelemetryAdapterForTests,
  getActiveTelemetrySink,
  registerTelemetrySink,
  noopSink,
} from '../observability/index.js';

const { envelopes } = vi.hoisted(() => ({ envelopes: [] as unknown[] }));

vi.mock('@sentry/node', async importOriginal => {
  const sdk = await importOriginal<typeof import('@sentry/node')>();
  return {
    ...sdk,
    init: (options: Parameters<typeof sdk.init>[0]) =>
      sdk.init({
        ...options,
        transport: () => ({
          send: async envelope => {
            envelopes.push(envelope);
            return { statusCode: 200 };
          },
          flush: async () => true,
        }),
      }),
  };
});

afterEach(async () => {
  await Sentry.close(2000);
  registerTelemetrySink(noopSink);
  __resetServerTelemetryAdapterForTests();
  envelopes.length = 0;
});

it('preserves the consent boundary and static transaction wire format on the real SDK', async () => {
  expect(await initServerTelemetryAdapter({ env: {} })).toBe(false);
  expect(Sentry.getClient()).toBeUndefined();
  expect(
    await initServerTelemetryAdapter({
      env: {
        PUNTOVIVO_SENTRY_DSN: 'https://synthetic@example.invalid/1',
        PUNTOVIVO_SENTRY_TRACES_SAMPLE_RATE: '1',
      },
      appVersion: 'synthetic-fixture',
    })
  ).toBe(true);
  const options = Sentry.getClient<NonNullable<ReturnType<typeof Sentry.init>>>()!.getOptions();
  expect(options.enableOpenTelemetrySetup).toBe(false);
  expect(options.enableRuntimeChannelInjection).toBe(false);
  expect(options.traceLifecycle).toBe('static');
  expect(options.integrations).toEqual([]);
  expect(options.dataCollection).toEqual({
    userInfo: false,
    cookies: false,
    httpHeaders: false,
    httpBodies: [],
    urlQueryParams: false,
    genAI: { inputs: false, outputs: false },
    databaseQueryData: false,
    queues: false,
    graphQL: { document: false, variables: false },
    stackFrameVariables: false,
    frameContextLines: 0,
  });
  const sink = getActiveTelemetrySink();
  sink.captureException(new Error('synthetic-adapter-error'), { fixture: 'synthetic' });
  sink.recordSpan('synthetic-operation', { count: 2 }, 100, 'ok');
  await flushServerTelemetry();
  const serialized = JSON.stringify(envelopes);
  expect(serialized).toContain('synthetic-adapter-error');
  expect(serialized).toContain('synthetic-fixture');
  expect(serialized).toContain('synthetic-operation');
  expect(serialized).toContain('"type":"transaction"');
  expect(serialized).not.toContain('"type":"span"');
});
