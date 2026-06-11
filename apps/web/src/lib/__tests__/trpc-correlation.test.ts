import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getTrpcHeaders,
  getLastCorrelationId,
  __resetCorrelationForTests,
} from '../trpc';
import {
  captureRenderError,
  __resetRenderObservabilityForTests,
  type RenderErrorContext,
  type RenderTelemetrySink,
} from '../observability';

// ENG-135c — pins the renderer side of the correlation contract:
//
//   1. Every tRPC request mints a FRESH x-correlation-id that
//      satisfies the server's strict intake ([A-Za-z0-9_-]{8,64}).
//   2. The most recent id is exposed via getLastCorrelationId so
//      captureRenderError can stamp client error events with the id
//      of the request they (most likely) belong to.
//   3. Before any request fires, the id is null and render events
//      carry correlationId: null instead of a fabricated value.

const SERVER_INTAKE_PATTERN = /^[A-Za-z0-9_-]{8,64}$/;

// The global test setup (src/test/setup.ts) pins crypto.randomUUID to a
// CONSTANT value for determinism elsewhere. Uniqueness is exactly what
// these cases assert, so give the mock a per-call implementation here —
// vitest isolates the setup per test file, so this never leaks out.
let uuidCounter = 0;

beforeEach(() => {
  uuidCounter = 0;
  vi.mocked(crypto.randomUUID).mockImplementation(
    () =>
      `00000000-0000-4000-8000-${String(uuidCounter++).padStart(12, '0')}` as ReturnType<
        typeof crypto.randomUUID
      >
  );
  __resetCorrelationForTests();
  __resetRenderObservabilityForTests();
});

afterEach(() => {
  __resetCorrelationForTests();
  __resetRenderObservabilityForTests();
});

describe('correlation id minting (ENG-135c)', () => {
  it('attaches a fresh x-correlation-id on every header build', () => {
    const first = getTrpcHeaders()['x-correlation-id'];
    const second = getTrpcHeaders()['x-correlation-id'];
    expect(first).toBeTruthy();
    expect(second).toBeTruthy();
    expect(first).not.toBe(second);
  });

  it('mints ids that pass the server intake pattern', () => {
    for (let i = 0; i < 5; i += 1) {
      expect(getTrpcHeaders()['x-correlation-id']).toMatch(
        SERVER_INTAKE_PATTERN
      );
    }
  });

  it('exposes the most recent id via getLastCorrelationId', () => {
    expect(getLastCorrelationId()).toBeNull();
    const minted = getTrpcHeaders()['x-correlation-id'];
    expect(getLastCorrelationId()).toBe(minted);
  });
});

describe('captureRenderError correlation stamp (ENG-135c)', () => {
  function buildRecordingSink() {
    const events: RenderErrorContext[] = [];
    const sink: RenderTelemetrySink = {
      captureRenderError(_err: unknown, context: RenderErrorContext) {
        events.push(context);
      },
    };
    return { events, sink };
  }

  it('stamps the last minted id on render error events', async () => {
    const { registerRenderTelemetrySink } = await import('../observability');
    const { events, sink } = buildRecordingSink();
    registerRenderTelemetrySink(sink);

    const minted = getTrpcHeaders()['x-correlation-id'];
    captureRenderError(new Error('boom'), {
      source: 'render',
      componentStack: 'at App',
    });

    expect(events).toHaveLength(1);
    expect(events[0]!.correlationId).toBe(minted);
  });

  it('carries correlationId null before any request fires', async () => {
    const { registerRenderTelemetrySink } = await import('../observability');
    const { events, sink } = buildRecordingSink();
    registerRenderTelemetrySink(sink);

    captureRenderError(new Error('boom'), {
      source: 'window',
      componentStack: null,
    });

    expect(events[0]!.correlationId).toBeNull();
  });

  it('an explicit caller-supplied correlationId wins over the default', async () => {
    const { registerRenderTelemetrySink } = await import('../observability');
    const { events, sink } = buildRecordingSink();
    registerRenderTelemetrySink(sink);

    getTrpcHeaders();
    captureRenderError(new Error('boom'), {
      source: 'render',
      componentStack: null,
      correlationId: 'explicit-id-123',
    });

    expect(events[0]!.correlationId).toBe('explicit-id-123');
  });
});
