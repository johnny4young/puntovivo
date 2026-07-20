/**
 * Unit tests for the Sentry / GlitchTip adapter and the
 * process-crash capture path.
 *
 * Pins five contracts:
 *
 * 1. Without PUNTOVIVO_SENTRY_DSN the SDK is never initialised and
 * the noopSink stays active (dev/test boots emit zero traffic).
 * 2. With a DSN the adapter registers a sink whose wrappers forward
 * to the SDK (captureException context + retroactive span with
 * primitive-only attributes and outcome-mapped status).
 * 3. An SDK init failure is swallowed: init returns false, the
 * noopSink stays active, nothing throws.
 * 4. Init is idempotent per process; flushServerTelemetry no-ops
 * while inactive and drains via SDK.flush when active.
 * 5. captureProcessCrash bypasses the per-tenant opt-in gate (its
 * consent layer is the DSN itself), still redacts, never throws.
 *
 * The SDK is mocked at the module boundary — these tests pin OUR
 * wrapper contract, not @sentry/node internals, so an SDK major bump
 * only has to keep init/captureException/startInactiveSpan/flush
 * stable for the suite to keep passing.
 *
 * @module __tests__/observability-sentry.test
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  initServerTelemetryAdapter,
  flushServerTelemetry,
  isServerTelemetryAdapterActive,
  __resetServerTelemetryAdapterForTests,
  captureProcessCrash,
  registerTelemetrySink,
  getActiveTelemetrySink,
  noopSink,
  type TelemetrySink,
} from '../observability/index.js';

const initMock = vi.fn();
const captureExceptionMock = vi.fn();
const spanSetStatusMock = vi.fn();
const spanEndMock = vi.fn();
const startInactiveSpanMock = vi.fn(() => ({
  setStatus: spanSetStatusMock,
  end: spanEndMock,
}));
const flushMock = vi.fn(() => Promise.resolve(true));

vi.mock('@sentry/node', () => ({
  init: initMock,
  captureException: captureExceptionMock,
  startInactiveSpan: startInactiveSpanMock,
  flush: flushMock,
}));

afterEach(() => {
  registerTelemetrySink(noopSink);
  __resetServerTelemetryAdapterForTests();
  vi.clearAllMocks();
});

describe('initServerTelemetryAdapter', () => {
  it('returns false and never touches the SDK when the DSN is unset', async () => {
    const result = await initServerTelemetryAdapter({ env: {} });
    expect(result).toBe(false);
    expect(initMock).not.toHaveBeenCalled();
    expect(getActiveTelemetrySink()).toBe(noopSink);
    expect(isServerTelemetryAdapterActive()).toBe(false);
  });

  it('treats a whitespace-only DSN as unset', async () => {
    const result = await initServerTelemetryAdapter({
      env: { PUNTOVIVO_SENTRY_DSN: '   ' },
    });
    expect(result).toBe(false);
    expect(initMock).not.toHaveBeenCalled();
  });

  it('initialises the SDK and registers a live sink when the DSN is set', async () => {
    const result = await initServerTelemetryAdapter({
      env: {
        PUNTOVIVO_SENTRY_DSN: 'http://key@127.0.0.1:9/1',
        PUNTOVIVO_RUNTIME_ENV: 'production',
      },
      appVersion: '1.2.3',
    });
    expect(result).toBe(true);
    expect(initMock).toHaveBeenCalledOnce();
    expect(initMock).toHaveBeenCalledWith({
      dsn: 'http://key@127.0.0.1:9/1',
      environment: 'production',
      release: '1.2.3',
      defaultIntegrations: false,
      tracesSampleRate: 0,
    });
    expect(getActiveTelemetrySink()).not.toBe(noopSink);
    expect(isServerTelemetryAdapterActive()).toBe(true);
  });

  it('forwards captureException with the attrs as extra context', async () => {
    await initServerTelemetryAdapter({
      env: { PUNTOVIVO_SENTRY_DSN: 'http://key@127.0.0.1:9/1' },
    });
    const sink = getActiveTelemetrySink();
    const boom = new Error('boom');
    sink.captureException(boom, { tenantId: 't1', procedure: 'sales.complete' });
    expect(captureExceptionMock).toHaveBeenCalledWith(boom, {
      extra: { tenantId: 't1', procedure: 'sales.complete' },
    });
  });

  it('records a retroactive span with primitive-only attributes and ok status', async () => {
    await initServerTelemetryAdapter({
      env: { PUNTOVIVO_SENTRY_DSN: 'http://key@127.0.0.1:9/1' },
    });
    const sink = getActiveTelemetrySink();
    sink.recordSpan(
      'products.list',
      { tenantId: 't1', nested: { dropped: true }, count: 4 },
      120,
      'ok'
    );
    expect(startInactiveSpanMock).toHaveBeenCalledOnce();
    const call = startInactiveSpanMock.mock.calls[0]![0] as unknown as {
      name: string;
      op: string;
      startTime: Date;
      attributes: Record<string, unknown>;
    };
    expect(call.name).toBe('products.list');
    expect(call.op).toBe('puntovivo.span');
    expect(call.attributes).toEqual({
      tenantId: 't1',
      count: 4,
      outcome: 'ok',
    });
    expect(call.startTime).toBeInstanceOf(Date);
    expect(spanSetStatusMock).toHaveBeenCalledWith({ code: 1 });
    expect(spanEndMock).toHaveBeenCalledOnce();
    const endTime = spanEndMock.mock.calls[0]![0] as Date;
    // The reconstructed window must match the reported duration.
    expect(endTime.getTime() - call.startTime.getTime()).toBe(120);
  });

  it('maps the error outcome to an error span status', async () => {
    await initServerTelemetryAdapter({
      env: { PUNTOVIVO_SENTRY_DSN: 'http://key@127.0.0.1:9/1' },
    });
    getActiveTelemetrySink().recordSpan('sales.complete', {}, 35, 'error');
    expect(spanSetStatusMock).toHaveBeenCalledWith({
      code: 2,
      message: 'internal_error',
    });
  });

  it('honours a valid PUNTOVIVO_SENTRY_TRACES_SAMPLE_RATE and rejects an invalid one', async () => {
    await initServerTelemetryAdapter({
      env: {
        PUNTOVIVO_SENTRY_DSN: 'http://key@127.0.0.1:9/1',
        PUNTOVIVO_SENTRY_TRACES_SAMPLE_RATE: '0.25',
      },
    });
    expect(initMock.mock.calls[0]![0]).toMatchObject({ tracesSampleRate: 0.25 });

    registerTelemetrySink(noopSink);
    __resetServerTelemetryAdapterForTests();
    vi.clearAllMocks();

    await initServerTelemetryAdapter({
      env: {
        PUNTOVIVO_SENTRY_DSN: 'http://key@127.0.0.1:9/1',
        PUNTOVIVO_SENTRY_TRACES_SAMPLE_RATE: 'banana',
      },
    });
    expect(initMock.mock.calls[0]![0]).toMatchObject({ tracesSampleRate: 0 });
  });

  it('swallows an SDK init failure and leaves the noopSink active', async () => {
    initMock.mockImplementationOnce(() => {
      throw new Error('malformed DSN');
    });
    const result = await initServerTelemetryAdapter({
      env: { PUNTOVIVO_SENTRY_DSN: 'not-a-dsn' },
    });
    expect(result).toBe(false);
    expect(getActiveTelemetrySink()).toBe(noopSink);
    expect(isServerTelemetryAdapterActive()).toBe(false);
  });

  it('is idempotent — a second DSN-set call does not re-init', async () => {
    const env = { PUNTOVIVO_SENTRY_DSN: 'http://key@127.0.0.1:9/1' };
    expect(await initServerTelemetryAdapter({ env })).toBe(true);
    expect(await initServerTelemetryAdapter({ env })).toBe(true);
    expect(initMock).toHaveBeenCalledOnce();
  });
});

describe('flushServerTelemetry', () => {
  it('resolves without touching the SDK while inactive', async () => {
    await flushServerTelemetry(500);
    expect(flushMock).not.toHaveBeenCalled();
  });

  it('drains via SDK.flush when active and swallows flush failures', async () => {
    await initServerTelemetryAdapter({
      env: { PUNTOVIVO_SENTRY_DSN: 'http://key@127.0.0.1:9/1' },
    });
    await flushServerTelemetry(500);
    expect(flushMock).toHaveBeenCalledWith(500);

    flushMock.mockImplementationOnce(() => Promise.reject(new Error('down')));
    await expect(flushServerTelemetry(500)).resolves.toBeUndefined();
  });
});

describe('captureProcessCrash', () => {
  function buildRecordingSink() {
    const calls: Array<{ err: unknown; attrs: Record<string, unknown> }> = [];
    const sink: TelemetrySink = {
      captureException(err, attrs) {
        calls.push({ err, attrs });
      },
      recordSpan() {
        /* unused */
      },
    };
    return { sink, calls };
  }

  it('invokes the active sink without any tenant opt-in gate', () => {
    const { sink, calls } = buildRecordingSink();
    registerTelemetrySink(sink);
    const boom = new Error('main crashed');
    captureProcessCrash(boom, { source: 'electron-main', kind: 'uncaughtException' });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.err).toBe(boom);
    expect(calls[0]!.attrs).toMatchObject({
      source: 'electron-main',
      kind: 'uncaughtException',
    });
  });

  it('redacts sensitive attrs before the sink sees them', () => {
    const { sink, calls } = buildRecordingSink();
    registerTelemetrySink(sink);
    captureProcessCrash(new Error('boom'), {
      source: 'electron-main',
      password: 'hunter2',
    });
    expect(calls[0]!.attrs.password).toBe('[Redacted]');
    expect(calls[0]!.attrs.source).toBe('electron-main');
  });

  it('does nothing beyond the local log while the noopSink is active', () => {
    expect(() => captureProcessCrash(new Error('boom'))).not.toThrow();
  });

  it('never throws even when the sink is broken', () => {
    registerTelemetrySink({
      captureException() {
        throw new Error('sink exploded');
      },
      recordSpan() {
        /* unused */
      },
    });
    expect(() => captureProcessCrash(new Error('boom'), { source: 'electron-main' })).not.toThrow();
  });
});
