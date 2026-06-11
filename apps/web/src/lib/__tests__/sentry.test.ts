import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ENG-135b — pins the renderer-side adapter contract:
//
//   1. `installRenderTelemetryAdapter` is DSN-gated: without
//      VITE_PUNTOVIVO_SENTRY_DSN the lazy `lib/sentry` chunk is never
//      imported (zero SDK code, zero traffic); with it the module
//      loads once and initialises against the DSN.
//   2. `initSentryRenderSink` initialises the SDK with our minimal
//      surface (defaultIntegrations off + dedupe only) and registers
//      a render sink that forwards TENANT-LESS context — tenantId is
//      stripped before the SDK sees it (consent layers, see
//      docs/OBSERVABILITY.md).
//
// `@sentry/browser` is mocked at the module boundary so the suite
// pins OUR wrapper contract, not SDK internals.

const { initMock, captureExceptionMock, dedupeIntegrationMock, initSinkSpy } =
  vi.hoisted(() => ({
    initMock: vi.fn(),
    captureExceptionMock: vi.fn(),
    dedupeIntegrationMock: vi.fn(() => ({ name: 'Dedupe' })),
    initSinkSpy: vi.fn(),
  }));

vi.mock('@sentry/browser', () => ({
  init: initMock,
  captureException: captureExceptionMock,
  dedupeIntegration: dedupeIntegrationMock,
}));

// The gating tests must observe whether observability.ts actually
// imported the adapter module, so the module itself is mocked; the
// adapter-contract tests unwrap the real one via importActual.
vi.mock('../sentry', () => ({
  initSentryRenderSink: initSinkSpy,
}));

import {
  captureRenderError,
  installRenderTelemetryAdapter,
  __resetRenderObservabilityForTests,
} from '../observability';

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  __resetRenderObservabilityForTests();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe('installRenderTelemetryAdapter (ENG-135b)', () => {
  it('does nothing when the DSN is unset — the SDK chunk is never imported', async () => {
    installRenderTelemetryAdapter();
    await settle();
    expect(initSinkSpy).not.toHaveBeenCalled();
  });

  it('treats a whitespace-only DSN as unset', async () => {
    vi.stubEnv('VITE_PUNTOVIVO_SENTRY_DSN', '   ');
    installRenderTelemetryAdapter();
    await settle();
    expect(initSinkSpy).not.toHaveBeenCalled();
  });

  it('lazy-loads and initialises the adapter once when the DSN is set', async () => {
    vi.stubEnv('VITE_PUNTOVIVO_SENTRY_DSN', 'http://key@127.0.0.1:9/1');
    installRenderTelemetryAdapter();
    installRenderTelemetryAdapter();
    await settle();
    expect(initSinkSpy).toHaveBeenCalledOnce();
    expect(initSinkSpy).toHaveBeenCalledWith('http://key@127.0.0.1:9/1');
  });
});

describe('initSentryRenderSink (ENG-135b)', () => {
  async function initRealAdapter(): Promise<void> {
    const real =
      await vi.importActual<typeof import('../sentry')>('../sentry');
    real.initSentryRenderSink('http://key@127.0.0.1:9/1');
  }

  it('initialises the SDK with defaultIntegrations off and dedupe only', async () => {
    await initRealAdapter();
    expect(initMock).toHaveBeenCalledOnce();
    expect(initMock).toHaveBeenCalledWith({
      dsn: 'http://key@127.0.0.1:9/1',
      environment: 'test',
      defaultIntegrations: false,
      integrations: [{ name: 'Dedupe' }],
    });
  });

  it('forwards render errors with the tenantId stripped', async () => {
    await initRealAdapter();
    const boom = new Error('render boom');
    captureRenderError(boom, {
      source: 'render',
      tenantId: 'tenant-1',
      componentStack: 'at App',
    });
    expect(captureExceptionMock).toHaveBeenCalledOnce();
    const [err, context] = captureExceptionMock.mock.calls[0]! as [
      unknown,
      { extra: Record<string, unknown>; tags: Record<string, unknown> },
    ];
    expect(err).toBe(boom);
    expect(context.extra).not.toHaveProperty('tenantId');
    expect(context.extra).toMatchObject({
      source: 'render',
      componentStack: 'at App',
    });
    expect(context.tags).toEqual({ source: 'render' });
  });

  it('keeps window-source metadata (filename/line) on the event', async () => {
    await initRealAdapter();
    captureRenderError(new Error('window boom'), {
      source: 'window',
      filename: 'app.js',
      lineNumber: 42,
      columnNumber: 7,
      componentStack: null,
    });
    const [, context] = captureExceptionMock.mock.calls[0]! as [
      unknown,
      { extra: Record<string, unknown>; tags: Record<string, unknown> },
    ];
    expect(context.extra).toMatchObject({
      source: 'window',
      filename: 'app.js',
      lineNumber: 42,
      columnNumber: 7,
    });
    expect(context.tags).toEqual({ source: 'window' });
  });
});
