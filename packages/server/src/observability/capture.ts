/**
 * captureException + withSpan helpers.
 *
 * These two functions are the entry points every production code
 * path uses to record an error or a measured operation. They run
 * unconditionally — the local pino log always emits — and
 * additionally route through the registered `TelemetrySink` when
 * the active tenant has opted in.
 *
 * Tenant opt-in is per-tenant (`tenants.settings.telemetryOptIn`)
 * and defaults to false. Anonymous captures (no `tenantId`) skip
 * the opt-in check entirely — the centralized sink never receives
 * an anonymous request because the helper short-circuits before
 * the lookup; only the local log emits. The opt-in cache lives for
 * 60s so error storms do not hammer the DB.
 *
 * The helpers never throw because of sink failures. Callers choose
 * whether to await the opt-in lookup; either way, the local log
 * emits before any centralized-sink work starts.
 *
 * @module observability/capture
 */

import type { DatabaseInstance } from '../db/index.js';
import { tenants } from '../db/schema.js';
import { eq } from 'drizzle-orm';
import { createModuleLogger } from '../logging/logger.js';
import { redactErrorAttrs } from './redact.js';
import { getActiveTelemetrySink, noopSink } from './sink.js';

const log = createModuleLogger('observability');

/**
 * Generic context bag passed to `captureException` /
 * `withSpan` / sink callbacks. Every field is optional — callers
 * supply whatever they have at the point of capture. The keys with
 * special semantics in the local log are listed here for IDE
 * autocompletion; arbitrary additional fields pass through.
 */
export interface TelemetryEventAttrs {
  tenantId?: string | null;
  userId?: string | null;
  correlationId?: string | null;
  procedure?: string;
  errCode?: string;
  durationMs?: number;
  [key: string]: unknown;
}

/**
 * Per-process cache so error storms don't hammer the DB for the
 * opt-in lookup. 60 seconds is short enough that an admin toggling
 * the flag sees the change within a minute, long enough to absorb
 * a sudden burst of errors without DB pressure.
 */
const OPT_IN_TTL_MS = 60_000;

interface OptInCacheEntry {
  optedIn: boolean;
  expiresAt: number;
}

const optInCache = new Map<string, OptInCacheEntry>();

/**
 * Test-only: clear the whole per-tenant cache between assertions.
 * Production code uses the tenant-scoped invalidator below.
 */
export function __clearTelemetryOptInCacheForTests(): void {
  optInCache.clear();
}

/**
 * Clear one tenant's cached telemetry opt-in value. Called by the
 * admin toggle mutation so revoking consent takes effect before the
 * next captured event, instead of waiting for the TTL window.
 */
export function clearTelemetryOptInCacheForTenant(tenantId: string): void {
  optInCache.delete(tenantId);
}

/**
 * Resolve the active tenant's `telemetryOptIn` value with a small
 * cache. Returns false on any error path so a transient DB issue
 * never silently flips a tenant into the centralized pipe.
 */
async function isTenantOptedIn(db: DatabaseInstance, tenantId: string): Promise<boolean> {
  const cached = optInCache.get(tenantId);
  const now = Date.now();
  if (cached && cached.expiresAt > now) {
    return cached.optedIn;
  }
  // Best-effort: any DB failure during opt-in resolution defaults
  // to opt-out so a transient outage cannot silently flip a tenant
  // into the centralized pipe.
  let optedIn: boolean;
  try {
    const row = await db
      .select({ settings: tenants.settings })
      .from(tenants)
      .where(eq(tenants.id, tenantId))
      .get();
    const settings = (row?.settings ?? {}) as Record<string, unknown>;
    optedIn = settings.telemetryOptIn === true;
  } catch (err) {
    log.warn({ tenantId, err }, 'telemetry opt-in lookup failed; defaulting to opt-out');
    optedIn = false;
  }
  optInCache.set(tenantId, { optedIn, expiresAt: now + OPT_IN_TTL_MS });
  return optedIn;
}

function safeInvokeSink(action: () => void): void {
  try {
    action();
  } catch (err) {
    log.warn({ err }, 'telemetry sink threw; sink event dropped');
  }
}

/**
 * Capture an exception. The local pino log always emits. When
 * `attrs.tenantId` is provided AND `db` is supplied AND the tenant
 * has opted in, the active sink is invoked with a redacted attrs
 * bag.
 *
 * Tolerant of partial input:
 * - `db` undefined → skip opt-in lookup, sink never fires.
 * - `tenantId` null/undefined → anonymous capture, local log only.
 * - Sink throws → swallowed (see safeInvokeSink).
 *
 * The function is async because the opt-in lookup is async; the
 * helper returns a Promise the caller may or may not await. In hot
 * paths (tRPC middleware) the caller awaits so the response timing
 * already accounts for the lookup; in lifecycle paths (unhandled
 * rejection) the caller fires-and-forgets.
 */
export async function captureException(
  err: unknown,
  attrs: TelemetryEventAttrs = {},
  db?: DatabaseInstance
): Promise<void> {
  // Local log is unconditional. Pino's redact policy applies here.
  log.error({ ...attrs, err }, 'captured exception');

  const tenantId = attrs.tenantId ?? null;
  if (!tenantId || !db) {
    return;
  }
  const optedIn = await isTenantOptedIn(db, tenantId);
  if (!optedIn) {
    return;
  }
  const sink = getActiveTelemetrySink();
  if (sink === noopSink) {
    return;
  }
  const safeAttrs = redactErrorAttrs(attrs);
  safeInvokeSink(() => sink.captureException(err, safeAttrs));
}

/**
 * Execute `fn`, measure its duration, and record the result as a
 * span on both the local log and the active sink (when the tenant
 * is opted in). On error the span outcome is 'error' and the
 * exception is forwarded through `captureException` before
 * re-throwing.
 *
 * Use for any measurable unit of work — tRPC procedure
 * invocations are wired through this helper by the tracing
 * middleware.
 */
export async function withSpan<T>(
  name: string,
  attrs: TelemetryEventAttrs,
  fn: () => Promise<T>,
  db?: DatabaseInstance
): Promise<T> {
  const startedAt = performance.now();
  try {
    const result = await fn();
    const durationMs = Math.max(0, performance.now() - startedAt);
    log.info({ ...attrs, span: name, durationMs, outcome: 'ok' }, 'span ok');
    await recordSpan(name, attrs, durationMs, 'ok', db);
    return result;
  } catch (err) {
    const durationMs = Math.max(0, performance.now() - startedAt);
    log.error({ ...attrs, span: name, durationMs, outcome: 'error', err }, 'span error');
    await captureException(err, { ...attrs, procedure: name }, db);
    await recordSpan(name, attrs, durationMs, 'error', db);
    throw err;
  }
}

/**
 * capture a process-level crash (Electron main
 * `uncaughtException` / `unhandledRejection`, or any other
 * tenant-less lifecycle failure).
 *
 * Deliberately different consent model from `captureException`:
 * process crashes carry NO tenant context, so the per-tenant opt-in
 * gate cannot apply — gating on it would make the crash path
 * vacuous. Instead, the operator-level consent is the DSN itself:
 * the sink is only ever non-noop when the operator provisioned
 * `PUNTOVIVO_SENTRY_DSN` (see observability/sentry.ts and
 * docs/OBSERVABILITY.md § consent layers). Attrs are still redacted
 * before the sink sees them.
 *
 * Synchronous on purpose — crash paths cannot await a DB lookup,
 * and there is none to make. Never throws.
 */
export function captureProcessCrash(err: unknown, attrs: TelemetryEventAttrs = {}): void {
  // Local log is unconditional, exactly like captureException.
  log.error({ ...attrs, err }, 'process crash captured');

  const sink = getActiveTelemetrySink();
  if (sink === noopSink) {
    return;
  }
  const safeAttrs = redactErrorAttrs(attrs);
  safeInvokeSink(() => sink.captureException(err, safeAttrs));
}

export async function recordSpan(
  name: string,
  attrs: TelemetryEventAttrs,
  durationMs: number,
  outcome: 'ok' | 'error',
  db?: DatabaseInstance
): Promise<void> {
  const tenantId = attrs.tenantId ?? null;
  if (!tenantId || !db) {
    return;
  }
  const optedIn = await isTenantOptedIn(db, tenantId);
  if (!optedIn) {
    return;
  }
  const sink = getActiveTelemetrySink();
  if (sink === noopSink) {
    return;
  }
  const safeAttrs = redactErrorAttrs(attrs);
  safeInvokeSink(() => sink.recordSpan(name, safeAttrs, durationMs, outcome));
}
