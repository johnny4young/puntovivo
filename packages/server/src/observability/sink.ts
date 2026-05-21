/**
 * ENG-135 — Telemetry sink interface (centralized side).
 *
 * The sink is the seam between Puntovivo internals and an external
 * observability backend (Sentry, GlitchTip, OTLP collector, etc.).
 * The local NDJSON pino log (ENG-006) is the operator-side artifact;
 * the sink is the centralized pipe that lets support see fleet
 * health without a tenant-by-tenant phone call.
 *
 * V1 ships the interface plus a `noopSink` default. The Sentry /
 * GlitchTip adapter is a follow-up that lands once the operator has
 * provisioned a DSN — installing the SDK in deps before that point
 * would bump the bundle-size budget (ENG-133) for zero immediate
 * value. Adapter authors implement these two methods, call
 * `registerTelemetrySink(adapter)` at boot, and the existing
 * captureException / withSpan helpers route through them
 * automatically.
 *
 * Important: the sink runs in addition to the local pino log, not
 * in place of it. The local log is the source of truth on the
 * device; the sink is the centralized fan-out. If the sink throws,
 * the helper swallows the error so observability never breaks
 * the application path.
 *
 * @module observability/sink
 */

import type { TelemetryEventAttrs } from './capture.js';

/**
 * Pluggable destination for captured exceptions and recorded spans.
 *
 * Adapter implementations should:
 *   - Be tolerant of partial attrs (any field can be missing).
 *   - Honour the redaction contract — the helpers in `capture.ts`
 *     run `redactErrorAttrs` before invoking the sink, but adapters
 *     should still avoid logging the raw `err.stack` to third-party
 *     services if the project policy disallows it.
 *   - Never throw — the helpers wrap calls in a try/catch but a
 *     misbehaving adapter that blocks the event loop will still hurt
 *     latency budgets (ENG-133).
 */
export interface TelemetrySink {
  /**
   * Forward an exception to the centralized pipe. Called after the
   * local pino log has emitted. `attrs` may include tenantId, userId,
   * correlationId, procedure name, and any caller-provided context.
   */
  captureException(err: unknown, attrs: TelemetryEventAttrs): void;

  /**
   * Record a completed span (typically a tRPC procedure invocation).
   * `durationMs` is measured via `performance.now()` by the caller.
   * `outcome` is 'ok' or 'error'; on error the corresponding
   * `captureException` is emitted separately, so this method need
   * not duplicate the error payload.
   */
  recordSpan(
    name: string,
    attrs: TelemetryEventAttrs,
    durationMs: number,
    outcome: 'ok' | 'error'
  ): void;
}

/**
 * Default sink. Does nothing — every observability helper falls back
 * to the local pino log alone. Replaced at runtime via
 * `registerTelemetrySink(adapter)` once an external pipe is wired.
 */
export const noopSink: TelemetrySink = {
  captureException() {
    /* no-op */
  },
  recordSpan() {
    /* no-op */
  },
};

let activeSink: TelemetrySink = noopSink;

/**
 * Replace the active sink. Calling this with `noopSink` resets to
 * the default. Subsequent calls overwrite the previous adapter — by
 * design there is exactly one centralized pipe per process.
 *
 * Returns the previous sink so test code can save and restore.
 */
export function registerTelemetrySink(sink: TelemetrySink): TelemetrySink {
  const previous = activeSink;
  activeSink = sink;
  return previous;
}

/**
 * Internal accessor used by the capture helpers. Exported so tests
 * can assert which sink is active without exporting the mutable
 * binding directly.
 */
export function getActiveTelemetrySink(): TelemetrySink {
  return activeSink;
}
