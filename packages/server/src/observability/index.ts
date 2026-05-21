/**
 * ENG-135 — Observability module barrel.
 *
 * Public surface for application code that wants to capture errors
 * or record measured spans. See `docs/OBSERVABILITY.md` for the
 * contract and the follow-up Sentry / GlitchTip adapter design.
 *
 * @module observability
 */

export {
  captureException,
  clearTelemetryOptInCacheForTenant,
  recordSpan,
  withSpan,
  type TelemetryEventAttrs,
  __clearTelemetryOptInCacheForTests,
} from './capture.js';
export {
  noopSink,
  registerTelemetrySink,
  getActiveTelemetrySink,
  type TelemetrySink,
} from './sink.js';
export { redactErrorAttrs } from './redact.js';
