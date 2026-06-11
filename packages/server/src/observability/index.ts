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
  captureProcessCrash,
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
// ENG-135b — Sentry / GlitchTip adapter (DSN-gated; see the module
// doc for the consent layers and the never-throw contract).
export {
  initServerTelemetryAdapter,
  flushServerTelemetry,
  isServerTelemetryAdapterActive,
  __resetServerTelemetryAdapterForTests,
  type ServerTelemetryAdapterOptions,
} from './sentry.js';
