/**
 * ENG-135b — Sentry / GlitchTip adapter for the server-side
 * `TelemetrySink`.
 *
 * This module is the ONLY file that touches the `@sentry/node` API
 * surface. It activates exclusively when the operator provisions a
 * DSN via `PUNTOVIVO_SENTRY_DSN`; without it the SDK is never
 * imported (dynamic `import()` on the DSN-set path only), so dev and
 * test boots stay zero-cost and emit zero network traffic. GlitchTip
 * speaks the Sentry protocol, so the same adapter covers both — the
 * choice is just whose DSN the env var carries.
 *
 * Consent layers (documented in docs/OBSERVABILITY.md):
 *   - Tenant-attributed events still flow through the per-tenant
 *     opt-in gate in `capture.ts` — this adapter only receives what
 *     that gate forwards, already redacted.
 *   - Setting the DSN is the operator-level consent for tenant-less
 *     app diagnostics (process crash captures via
 *     `captureProcessCrash`).
 *
 * The adapter never throws: a malformed DSN or an SDK init failure
 * logs a structured warning and leaves the `noopSink` in place — a
 * telemetry failure can never block a boot or a sale (mirrors the
 * ENG-020/054 fiscal stance).
 */

import { createModuleLogger } from '../logging/logger.js';
import { registerTelemetrySink, type TelemetrySink } from './sink.js';
import type { TelemetryEventAttrs } from './capture.js';

const log = createModuleLogger('observability');

/**
 * The subset of the `@sentry/node` module the adapter consumes.
 * Kept minimal on purpose: tests mock exactly this surface, and an
 * SDK major bump only has to keep these four members stable for the
 * adapter to survive untouched.
 */
interface SentryNodeLike {
  init(options: {
    dsn: string;
    environment: string;
    release: string;
    defaultIntegrations: false;
    tracesSampleRate: number;
  }): unknown;
  captureException(err: unknown, context: { extra: Record<string, unknown> }): unknown;
  startInactiveSpan(options: {
    name: string;
    op: string;
    startTime: Date;
    attributes: Record<string, string | number | boolean>;
  }): {
    setStatus(status: { code: number; message?: string }): unknown;
    end(endTime: Date): unknown;
  };
  flush(timeoutMs: number): Promise<boolean>;
}

/**
 * Options for {@link initServerTelemetryAdapter}. `env` is injectable
 * so tests never have to mutate `process.env`; `appVersion` becomes
 * the Sentry `release` so fleet events group by shipped build.
 */
export interface ServerTelemetryAdapterOptions {
  env?: Record<string, string | undefined>;
  appVersion?: string;
}

/** Module-level handle to the imported SDK while the adapter is active. */
let activeSdk: SentryNodeLike | null = null;

/**
 * Test-only: forget the active SDK handle so each test starts from
 * the inactive state. Pair with `registerTelemetrySink(noopSink)`.
 */
export function __resetServerTelemetryAdapterForTests(): void {
  activeSdk = null;
}

/** Whether the adapter registered a live sink in this process. */
export function isServerTelemetryAdapterActive(): boolean {
  return activeSdk !== null;
}

/**
 * Sentry span attributes only accept primitives; our attrs bag can
 * carry arbitrary values. Drop everything non-primitive instead of
 * stringifying — nested payloads belong on exceptions, not spans.
 */
function toSpanAttributes(
  attrs: TelemetryEventAttrs
): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(attrs)) {
    if (
      typeof value === 'string' ||
      typeof value === 'number' ||
      typeof value === 'boolean'
    ) {
      out[key] = value;
    }
  }
  return out;
}

/**
 * SpanStatus codes from the Sentry span protocol (OK = 1, ERROR = 2).
 * Inlined as literals so the adapter does not depend on constant
 * re-exports that have moved between SDK majors.
 */
const SPAN_STATUS_OK = 1;
const SPAN_STATUS_ERROR = 2;

function buildSink(sdk: SentryNodeLike): TelemetrySink {
  return {
    captureException(err, attrs) {
      sdk.captureException(err, { extra: { ...attrs } });
    },
    recordSpan(name, attrs, durationMs, outcome) {
      // Our spans are reported retroactively (completed, with a
      // measured duration) while the SDK's API is start/end-oriented,
      // so reconstruct the window from wall-clock now minus duration.
      const endTime = new Date();
      const startTime = new Date(endTime.getTime() - Math.max(0, durationMs));
      const span = sdk.startInactiveSpan({
        name,
        op: 'puntovivo.span',
        startTime,
        attributes: { ...toSpanAttributes(attrs), outcome },
      });
      span.setStatus(
        outcome === 'ok'
          ? { code: SPAN_STATUS_OK }
          : { code: SPAN_STATUS_ERROR, message: 'internal_error' }
      );
      span.end(endTime);
    },
  };
}

/**
 * Parse `PUNTOVIVO_SENTRY_TRACES_SAMPLE_RATE` (0..1). Spans are
 * opt-in on top of the DSN: the default 0 keeps the error pipe live
 * while sending no span traffic. Invalid values warn and fall back
 * to 0 so a typo can never silently enable span fan-out.
 */
function resolveTracesSampleRate(raw: string | undefined): number {
  if (raw === undefined || raw.trim() === '') {
    return 0;
  }
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) {
    log.warn(
      { tracesSampleRate: raw },
      'invalid PUNTOVIVO_SENTRY_TRACES_SAMPLE_RATE; falling back to 0'
    );
    return 0;
  }
  return parsed;
}

/**
 * Initialise the Sentry / GlitchTip adapter and register it as the
 * active `TelemetrySink`. Called once from `createServer` — both the
 * standalone server and the embedded desktop server flow through it.
 *
 * Behaviour:
 *   - `PUNTOVIVO_SENTRY_DSN` unset/empty → returns false without
 *     importing the SDK; the `noopSink` stays active.
 *   - Already active → returns true without re-initialising (tests
 *     boot many servers per process; only the first DSN-set boot
 *     wires the pipe).
 *   - SDK import/init failure → logs a warning, returns false, and
 *     leaves the `noopSink` in place. NEVER throws.
 *
 * `defaultIntegrations: false` is deliberate: the SDK's
 * auto-instrumentation monkey-patches http/undici and would distort
 * the ENG-133 p95 latency budgets; every event in this codebase
 * reaches the sink through the explicit capture helpers instead.
 */
export async function initServerTelemetryAdapter(
  options: ServerTelemetryAdapterOptions = {}
): Promise<boolean> {
  const env = options.env ?? process.env;
  const dsn = env.PUNTOVIVO_SENTRY_DSN?.trim();
  if (!dsn) {
    return false;
  }
  if (activeSdk !== null) {
    return true;
  }
  try {
    const sdk = (await import('@sentry/node')) as unknown as SentryNodeLike;
    sdk.init({
      dsn,
      environment:
        env.PUNTOVIVO_RUNTIME_ENV ?? env.NODE_ENV ?? 'development',
      release: options.appVersion ?? 'unknown',
      defaultIntegrations: false,
      tracesSampleRate: resolveTracesSampleRate(
        env.PUNTOVIVO_SENTRY_TRACES_SAMPLE_RATE
      ),
    });
    registerTelemetrySink(buildSink(sdk));
    activeSdk = sdk;
    log.info(
      { environment: env.PUNTOVIVO_RUNTIME_ENV ?? env.NODE_ENV ?? 'development' },
      'centralized telemetry adapter registered (Sentry protocol)'
    );
    return true;
  } catch (err) {
    log.warn(
      { err },
      'telemetry adapter init failed; staying on local-only logging'
    );
    return false;
  }
}

/**
 * Drain the SDK's buffered events. Used by the Electron main crash
 * path so a captured `uncaughtException` actually leaves the process
 * before `app.exit(1)`. Resolves immediately when the adapter is
 * inactive; never rejects.
 */
export async function flushServerTelemetry(timeoutMs = 2000): Promise<void> {
  if (activeSdk === null) {
    return;
  }
  try {
    await activeSdk.flush(timeoutMs);
  } catch (err) {
    log.warn({ err }, 'telemetry flush failed');
  }
}
