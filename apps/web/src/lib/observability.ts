/**
 * ENG-135 — Renderer-side observability surface.
 *
 * The browser bundle has no Sentry / GlitchTip SDK in v1: the
 * adapter follow-up will install one once the operator has
 * provisioned a DSN. Until then this module fulfils two
 * responsibilities the AppErrorBoundary + global error listeners
 * need:
 *
 *   1. A single `captureRenderError(err, context)` entry point that
 *      always console.errors with a structured shape (so a tail of
 *      `dev:web` output still gives a complete event) and forwards
 *      to the future SDK adapter when one is installed.
 *   2. `installGlobalErrorListeners()` wires `window.error` +
 *      `window.unhandledrejection` to the same entry point — those
 *      escape the React boundary and would otherwise vanish without
 *      a trace in production.
 *
 * The forwarder is a tiny `RenderTelemetrySink` interface; the
 * adapter PR registers an implementation at boot. Until then a noop
 * sink is the default. This mirrors the server-side `TelemetrySink`
 * (packages/server/src/observability/sink.ts) so a future end-to-end
 * trace propagation effort (renderer → server correlationId in
 * headers) has a parallel shape on both sides.
 *
 * ENG-173 extends this module with `installWebVitalsReporter()`, which
 * forwards Core Web Vitals (LCP / CLS / INP / TTFB / FCP) to the public
 * `observability.reportWebVital` tRPC mutation. It is background-only (no UI)
 * and sampled once per page load.
 *
 * @module lib/observability
 */

import { onCLS, onFCP, onINP, onLCP, onTTFB, type Metric } from 'web-vitals';
import { vanillaClient } from './trpc';

export interface RenderErrorContext {
  /**
   * The tenant the user is currently logged into, when known. Set
   * by the AuthProvider on login and cleared on logout via
   * `setActiveTenantId(...)`.
   */
  tenantId?: string | null;
  /**
   * Set by AppErrorBoundary from `ErrorInfo.componentStack`. Browser
   * error events fill in `filename` + `lineNumber` instead.
   */
  componentStack?: string | null;
  filename?: string;
  lineNumber?: number;
  columnNumber?: number;
  /**
   * 'render' = React component tree threw; 'window' = window.error;
   * 'rejection' = unhandledrejection. Helps the future adapter
   * group events.
   */
  source: 'render' | 'window' | 'rejection';
}

export interface RenderTelemetrySink {
  captureRenderError(err: unknown, context: RenderErrorContext): void;
}

const noopRenderSink: RenderTelemetrySink = {
  captureRenderError() {
    /* no-op */
  },
};

let activeRenderSink: RenderTelemetrySink = noopRenderSink;
let activeTenantId: string | null = null;

/**
 * Replace the active sink. Adapter authors call this once at boot
 * after instantiating the Sentry / GlitchTip browser SDK.
 */
export function registerRenderTelemetrySink(sink: RenderTelemetrySink): void {
  activeRenderSink = sink;
}

/**
 * AuthProvider calls this on every login / logout so the active
 * tenantId is available to capture sites that don't have direct
 * access to the React context (window error listeners).
 */
export function setActiveTenantId(tenantId: string | null): void {
  activeTenantId = tenantId;
}

function safeInvoke(action: () => void): void {
  try {
    action();
  } catch (err) {
    // The sink itself is broken — log to the console at least; if
    // the console is already gone we are out of options.
    if (typeof console !== 'undefined' && console.error) {
      console.error('render telemetry sink threw; sink event dropped', err);
    }
  }
}

/**
 * The one entry point. Always console.errors with a structured
 * payload so a developer tail catches everything; forwards to the
 * active sink which (when a real adapter is registered) pushes the
 * event to the centralized pipe.
 *
 * Passing the tenantId explicitly is allowed; defaults to whatever
 * `setActiveTenantId` last set so window-level listeners do not
 * need to plumb React context.
 */
export function captureRenderError(
  err: unknown,
  context: Omit<RenderErrorContext, 'tenantId'> & { tenantId?: string | null }
): void {
  const resolvedTenant =
    context.tenantId !== undefined ? context.tenantId : activeTenantId;
  const payload: RenderErrorContext = { ...context, tenantId: resolvedTenant };
  if (typeof console !== 'undefined' && console.error) {
    console.error('captured render error', { err, ...payload });
  }
  safeInvoke(() => activeRenderSink.captureRenderError(err, payload));
}

let renderAdapterInstallRequested = false;

/**
 * ENG-135b — load and register the Sentry / GlitchTip adapter when
 * the operator provisioned `VITE_PUNTOVIVO_SENTRY_DSN`. The adapter
 * module (`lib/sentry.ts`) statically imports `@sentry/browser`, so
 * the dynamic `import()` below is what keeps the SDK out of the
 * eager bundle: without the DSN the chunk is never even fetched.
 *
 * Fire-and-forget by design — the import resolves in the background
 * and must never delay `createRoot(...).render`. Errors raised
 * before the adapter finishes loading still hit the console fallback
 * in `captureRenderError`; only the centralized copy is lost, which
 * matches the best-effort contract of the sink.
 */
export function installRenderTelemetryAdapter(): void {
  if (renderAdapterInstallRequested || typeof window === 'undefined') {
    return;
  }
  const dsn = import.meta.env.VITE_PUNTOVIVO_SENTRY_DSN?.trim();
  if (!dsn) {
    return;
  }
  renderAdapterInstallRequested = true;
  void import('./sentry')
    .then((mod) => mod.initSentryRenderSink(dsn))
    .catch((err) => {
      if (typeof console !== 'undefined' && console.error) {
        console.error('render telemetry adapter failed to load', err);
      }
    });
}

let listenersInstalled = false;
let errorListener: ((event: ErrorEvent) => void) | null = null;
let rejectionListener: ((event: PromiseRejectionEvent) => void) | null = null;

/**
 * Wire `window.error` + `window.unhandledrejection` so an error
 * that escapes the React boundary still reaches the observability
 * pipe. Idempotent — calling more than once is harmless.
 */
export function installGlobalErrorListeners(): void {
  if (listenersInstalled || typeof window === 'undefined') return;
  listenersInstalled = true;
  errorListener = (event: ErrorEvent) => {
    captureRenderError(event.error ?? event.message, {
      source: 'window',
      filename: event.filename,
      lineNumber: event.lineno,
      columnNumber: event.colno,
      componentStack: null,
    });
  };
  rejectionListener = (event: PromiseRejectionEvent) => {
    captureRenderError(event.reason, {
      source: 'rejection',
      componentStack: null,
    });
  };
  window.addEventListener('error', errorListener);
  window.addEventListener('unhandledrejection', rejectionListener);
}

// ============================================================================
// ENG-173 — Web Vitals real-user monitoring (RUM)
// ============================================================================

/**
 * Coarse device tier sent with every Web Vitals sample. Mirrors the server
 * `webVitalDeviceClassEnum`; lets the future dashboard slice slow routes by
 * hardware without storing a raw user-agent.
 */
export type DeviceClass = 'low' | 'mid' | 'high' | 'unknown';

/**
 * Bucket the device by `navigator.hardwareConcurrency` (logical cores). A
 * rough proxy for the merchant's hardware tier — the ICP runs on everything
 * from a 2-core Celeron AIO to an 8-core workstation. Returns `'unknown'` when
 * the API is unavailable or returns a nonsensical value.
 */
export function resolveDeviceClass(): DeviceClass {
  const cores =
    typeof navigator !== 'undefined' ? navigator.hardwareConcurrency : undefined;
  if (typeof cores !== 'number' || !Number.isFinite(cores) || cores <= 0) {
    return 'unknown';
  }
  if (cores <= 2) return 'low';
  if (cores <= 6) return 'mid';
  return 'high';
}

/**
 * Resolve the sampling rate in [0, 1]. `VITE_WEB_VITALS_SAMPLE_RATE` overrides
 * when set to a valid fraction; otherwise default 10 % in production, 100 % in
 * dev so a local smoke always reports.
 */
function resolveSampleRate(): number {
  const raw = import.meta.env.VITE_WEB_VITALS_SAMPLE_RATE;
  const parsed = raw !== undefined ? Number(raw) : Number.NaN;
  if (Number.isFinite(parsed) && parsed >= 0 && parsed <= 1) {
    return parsed;
  }
  return import.meta.env.PROD ? 0.1 : 1;
}

let webVitalsInstalled = false;

/**
 * Install the Web Vitals reporter. Idempotent + browser-guarded so it is safe
 * to call once at bootstrap (next to {@link installGlobalErrorListeners}).
 *
 * Sampling is decided ONCE per page load — a load is either fully sampled (all
 * five metrics report) or fully skipped — so a route's metrics stay coherent
 * for aggregation. Each metric finalises on page-hide / first-interaction
 * (web-vitals default) and is forwarded to the public `reportWebVital`
 * mutation, which derives the tenant server-side and gates on the per-tenant
 * telemetry opt-in. Delivery is best-effort: failures never surface to the
 * user, and an in-flight unload may drop the final fetch (acceptable for RUM).
 */
export function installWebVitalsReporter(): void {
  if (webVitalsInstalled || typeof window === 'undefined') {
    return;
  }
  webVitalsInstalled = true;
  if (Math.random() >= resolveSampleRate()) {
    return;
  }

  const deviceClass = resolveDeviceClass();
  const report = (metric: Metric): void => {
    safeInvoke(() => {
      void vanillaClient.observability.reportWebVital
        .mutate({
          metric: metric.name,
          value: metric.value,
          rating: metric.rating,
          route: window.location.pathname,
          deviceClass,
        })
        .catch(() => {
          /* best-effort RUM — never surface a reporting failure */
        });
    });
  };

  onLCP(report);
  onCLS(report);
  onINP(report);
  onTTFB(report);
  onFCP(report);
}

/**
 * Test-only escape hatch — production code never resets between
 * mounts so this is gated behind an explicit call site. Also
 * detaches the window listeners so the next test starts with a
 * clean slate; without the explicit detach a re-install would
 * stack a second handler on top of the first.
 */
export function __resetRenderObservabilityForTests(): void {
  activeRenderSink = noopRenderSink;
  activeTenantId = null;
  renderAdapterInstallRequested = false;
  if (typeof window !== 'undefined') {
    if (errorListener) window.removeEventListener('error', errorListener);
    if (rejectionListener)
      window.removeEventListener('unhandledrejection', rejectionListener);
  }
  errorListener = null;
  rejectionListener = null;
  listenersInstalled = false;
  webVitalsInstalled = false;
}
