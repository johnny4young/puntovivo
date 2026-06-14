/**
 * Per-procedure rate-limit middleware — ENG-166 (auth-critical subset).
 *
 * The Fastify global rate-limit caps the whole tRPC surface at
 * 100 req/min/IP, which is generous enough to leave high-leverage auth
 * procedures (refresh, changePassword, resetPassword, user create,
 * desktopSession.register) exposed to brute-force at 100/min. This
 * middleware wraps those procedures with stricter buckets keyed by IP +
 * authenticated user. Wider tRPC coverage lands in ENG-165.
 *
 * The state is kept in-memory (process-local Map). For Puntovivo's
 * single-process Electron-embedded backend this is sufficient; the
 * global @fastify/rate-limit plugin is the cross-restart backstop, and
 * the login flow has its own DB-backed bucket (`security/loginRateLimit`).
 *
 * Test bypass: when running under Vitest or the Playwright E2E runtime
 * the middleware is a no-op so high-volume suites do not start tripping
 * caps on shared localhost/IP buckets.
 *
 * @module trpc/middleware/procedureRateLimit
 */

import { middleware } from '../init.js';
import { throwServerError } from '../../lib/errorCodes.js';

interface Bucket {
  count: number;
  expiresAt: number;
  // ENG-165 — flips true once we have reported the FIRST denial of the
  // current window, so a caller can audit a rate-limit hit exactly once
  // per window instead of once per rejected request (avoids flooding the
  // audit log under a sustained abuse burst).
  deniedSignalled: boolean;
}

const buckets = new Map<string, Bucket>();

/** ENG-165 — bucket key dimensions. `siteId` enables per-site sales buckets. */
export type RateLimitKeyDimension = 'ip' | 'userId' | 'tenantId' | 'siteId';

export interface ProcedureRateLimitOptions {
  /** Stable label folded into the bucket key — typically the procedure name. */
  name: string;
  /** Maximum allowed calls inside `windowMs`. */
  max: number;
  /** Window length in milliseconds. */
  windowMs: number;
  /**
   * Which dimensions to fold into the bucket key. Order matters only
   * for cache locality; semantically the set is order-independent.
   */
  keyBy?: ReadonlyArray<RateLimitKeyDimension>;
}

/**
 * ENG-165 — outcome of consuming a token from a bucket.
 *
 * `firstDenial` is true only on the FIRST denial within the current
 * window, so the caller can write a single auditable event per window.
 */
export interface RateLimitDecision {
  outcome: 'allowed' | 'denied';
  firstDenial: boolean;
}

function bucketKey(
  name: string,
  ip: string | null,
  userId: string | null,
  tenantId: string | null,
  siteId: string | null,
  keyBy: ReadonlyArray<RateLimitKeyDimension>
): string {
  const parts: string[] = [name];
  if (keyBy.includes('tenantId')) {
    parts.push(`tenant=${tenantId ?? 'none'}`);
  }
  if (keyBy.includes('siteId')) {
    parts.push(`site=${siteId ?? 'none'}`);
  }
  if (keyBy.includes('ip')) {
    parts.push(`ip=${ip ?? 'unknown'}`);
  }
  if (keyBy.includes('userId')) {
    parts.push(`user=${userId ?? 'anon'}`);
  }
  return parts.join('|');
}

function isE2eBypassEnabled(): boolean {
  if (process.env.PUNTOVIVO_E2E !== '1') {
    return false;
  }

  const runtimeEnv = process.env.PUNTOVIVO_RUNTIME_ENV ?? process.env.NODE_ENV;
  if (runtimeEnv === 'production') {
    return false;
  }

  return (
    runtimeEnv === 'development' ||
    process.env.NODE_ENV === 'test' ||
    process.env.VITEST === 'true' ||
    process.env.VITEST_WORKER_ID !== undefined ||
    process.env.PLAYWRIGHT_BROWSERS_PATH !== undefined ||
    process.env.CI === 'true'
  );
}

/** Options accepted by {@link consumeRateLimitBucket} / {@link checkProcedureRateLimit}. */
export type RateLimitConsumeOptions = ProcedureRateLimitOptions & {
  ip?: string | null;
  userId?: string | null;
  /** ENG-165 — tenant the request belongs to (for per-tenant buckets). */
  tenantId?: string | null;
  /** ENG-165 — active site for sales buckets. */
  siteId?: string | null;
  now?: number;
  enforceInTest?: boolean;
};

/**
 * ENG-165 — consume one token from a bucket and report the outcome plus
 * a once-per-window `firstDenial` signal. Returns `allowed` (with the
 * bucket store mutated) when there is spare capacity or the env/test
 * bypass is active, and `denied` when the bucket is saturated.
 */
export function consumeRateLimitBucket(options: RateLimitConsumeOptions): RateLimitDecision {
  const { name, max, windowMs, keyBy = ['ip'] } = options;

  if (isE2eBypassEnabled()) {
    return { outcome: 'allowed', firstDenial: false };
  }

  const isTestRunner =
    process.env.NODE_ENV === 'test' ||
    process.env.VITEST === 'true' ||
    process.env.VITEST_WORKER_ID !== undefined;
  if (isTestRunner && options.enforceInTest !== true) {
    return { outcome: 'allowed', firstDenial: false };
  }

  const now = options.now ?? Date.now();
  const ip = options.ip ?? null;
  const userId = options.userId ?? null;
  const tenantId = options.tenantId ?? null;
  const siteId = options.siteId ?? null;
  const key = bucketKey(name, ip, userId, tenantId, siteId, keyBy);

  const existing = buckets.get(key);
  if (!existing || existing.expiresAt <= now) {
    buckets.set(key, { count: 1, expiresAt: now + windowMs, deniedSignalled: false });
    return { outcome: 'allowed', firstDenial: false };
  }

  if (existing.count >= max) {
    const firstDenial = !existing.deniedSignalled;
    existing.deniedSignalled = true;
    return { outcome: 'denied', firstDenial };
  }

  existing.count += 1;
  return { outcome: 'allowed', firstDenial: false };
}

/**
 * Pure bucket-check exported for unit tests + the auth-critical
 * `rateLimitFor` middleware. Back-compat thin wrapper over
 * {@link consumeRateLimitBucket} returning only the `'allowed'|'denied'`
 * outcome.
 */
export function checkProcedureRateLimit(options: RateLimitConsumeOptions): 'allowed' | 'denied' {
  return consumeRateLimitBucket(options).outcome;
}

/**
 * Build a tRPC middleware that throttles the wrapped procedure to the
 * configured cap. Returns the same `middleware(...)` shape that the
 * other guards in this folder use so callers can `.use(rateLimitFor({...}))`
 * on their procedure chains.
 *
 * Exported as a factory (not a singleton) so each auth-critical
 * procedure declares its own cap inline with the rest of its chain.
 */
export function rateLimitFor(options: ProcedureRateLimitOptions) {
  return middleware(async ({ ctx, next }) => {
    const decision = checkProcedureRateLimit({
      ...options,
      ip: typeof ctx.req?.ip === 'string' ? ctx.req.ip : null,
      userId: ctx.user?.id ?? null,
      tenantId: ctx.tenantId ?? null,
      siteId: ctx.siteId ?? null,
    });

    if (decision === 'denied') {
      throwServerError({
        trpcCode: 'TOO_MANY_REQUESTS',
        errorCode: 'AUTH_RATE_LIMIT_EXCEEDED',
        message: 'Too many requests. Please slow down and try again shortly.',
      });
    }

    return next();
  });
}

/**
 * Test-only helper that wipes the bucket store. Vitest does not import
 * this from production code; keeping it here avoids a circular import
 * when a test wants to assert a clean baseline mid-suite.
 */
export function __resetProcedureRateLimitForTest(): void {
  buckets.clear();
}

/**
 * Drop every bucket whose window has elapsed. Returns the count of
 * pruned entries (useful for telemetry). Exposed so the server boot
 * can schedule a periodic sweep — without it the map grows unbounded
 * over a long-lived Electron session.
 */
export function sweepExpiredBuckets(now: number = Date.now()): number {
  let pruned = 0;
  for (const [key, bucket] of buckets) {
    if (bucket.expiresAt <= now) {
      buckets.delete(key);
      pruned += 1;
    }
  }
  return pruned;
}

const SWEEP_INTERVAL_MS = 5 * 60_000;
let sweepTimer: ReturnType<typeof setInterval> | null = null;

/**
 * Start a periodic sweep. Idempotent — calling twice does not stack
 * timers. Returns a `stop()` function that the server's `onClose` hook
 * uses to release the timer handle. Skipped under `NODE_ENV=test` so
 * the test runner can exit cleanly without waiting on the next tick.
 */
export function startProcedureRateLimitSweeper(): () => void {
  if (process.env.NODE_ENV === 'test' || sweepTimer !== null) {
    return () => {};
  }
  sweepTimer = setInterval(() => {
    sweepExpiredBuckets();
  }, SWEEP_INTERVAL_MS);
  // Allow the Node process to exit even if the sweeper is pending.
  if (typeof sweepTimer.unref === 'function') {
    sweepTimer.unref();
  }
  return () => {
    if (sweepTimer !== null) {
      clearInterval(sweepTimer);
      sweepTimer = null;
    }
  };
}
