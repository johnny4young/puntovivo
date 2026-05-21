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
 * @module lib/observability
 */

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
  if (typeof window !== 'undefined') {
    if (errorListener) window.removeEventListener('error', errorListener);
    if (rejectionListener)
      window.removeEventListener('unhandledrejection', rejectionListener);
  }
  errorListener = null;
  rejectionListener = null;
  listenersInstalled = false;
}
