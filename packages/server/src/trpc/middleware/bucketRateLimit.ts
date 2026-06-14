/**
 * ENG-165 — tRPC-aware rate limiting with per-tenant/site/user buckets.
 *
 * The Fastify global limit (`@fastify/rate-limit`, 100/min/IP) stays as
 * the coarse cross-route DOS backstop. This middleware runs on the base
 * `publicProcedure` (so EVERY tRPC call passes through it) and applies a
 * DIFFERENTIATED bucket per procedure shape, so a busy store behind one
 * NAT is throttled per (tenant, site, user) for sales — not per IP —
 * and read traffic is isolated from write traffic.
 *
 * Buckets (env-tunable; defaults are deliberately generous — the goal is
 * per-tenant/site isolation, not tight caps):
 *   - `auth.*`        → SKIPPED. The strict auth buckets already exist
 *                       (`procedureRateLimit` + `security/loginRateLimit`).
 *   - `publicApi.*`   → public-api bucket (for ENG-118; no routes yet).
 *   - authed `sales.*` mutation → sales-write bucket (tenant + site + user).
 *   - authed other mutation     → write bucket (tenant + user).
 *   - authed query              → read bucket (tenant + user).
 *   - unauthenticated non-auth  → public bucket (IP).
 *
 * A bucket hit writes ONE `systemAuditLogs` row per window (the offending
 * tenant / site / user / ip live in metadata) and throws `TOO_MANY_REQUESTS`.
 * The check reuses `procedureRateLimit`'s in-memory store + test bypass,
 * so the full suite + Playwright stay green unless enforcement is opted
 * in.
 *
 * @module trpc/middleware/bucketRateLimit
 */

import { nanoid } from 'nanoid';
import type { Context } from '../context.js';
import { throwServerError } from '../../lib/errorCodes.js';
import { createModuleLogger } from '../../logging/logger.js';
import { systemAuditLogs } from '../../db/schema.js';
import { consumeRateLimitBucket, type RateLimitKeyDimension } from './procedureRateLimit.js';

const log = createModuleLogger('rate-limit');

/** A configured bucket: cap, window, and the dimensions it keys on. */
interface BucketConfig {
  /** Stable label folded into the bucket key. */
  name: string;
  max: number;
  windowMs: number;
  keyBy: ReadonlyArray<RateLimitKeyDimension>;
}

const ONE_MINUTE = 60_000;

/** Read a positive integer env override, falling back to `fallback`. */
function envInt(name: string, fallback: number): number {
  const raw = Number.parseInt(process.env[name] ?? '', 10);
  return Number.isFinite(raw) && raw > 0 ? raw : fallback;
}

/**
 * ENG-165 — the bucket taxonomy, resolved once at module load from env.
 * Defaults: sales-write 240/min (per tenant+site+user), write
 * 120/min and read 600/min (per tenant+user), public 60/min (per
 * IP), public-api 120/min (per tenant+ip, ready for ENG-118).
 */
const BUCKETS = {
  salesWrite: {
    name: 'rl.sales-write',
    max: envInt('PUNTOVIVO_RATE_LIMIT_SALES_WRITE_MAX', 240),
    windowMs: envInt('PUNTOVIVO_RATE_LIMIT_SALES_WRITE_WINDOW_MS', ONE_MINUTE),
    keyBy: ['tenantId', 'siteId', 'userId'],
  },
  write: {
    name: 'rl.write',
    max: envInt('PUNTOVIVO_RATE_LIMIT_WRITE_MAX', 120),
    windowMs: envInt('PUNTOVIVO_RATE_LIMIT_WRITE_WINDOW_MS', ONE_MINUTE),
    keyBy: ['tenantId', 'userId'],
  },
  read: {
    name: 'rl.read',
    max: envInt('PUNTOVIVO_RATE_LIMIT_READ_MAX', 600),
    windowMs: envInt('PUNTOVIVO_RATE_LIMIT_READ_WINDOW_MS', ONE_MINUTE),
    keyBy: ['tenantId', 'userId'],
  },
  public: {
    name: 'rl.public',
    max: envInt('PUNTOVIVO_RATE_LIMIT_PUBLIC_MAX', 60),
    windowMs: envInt('PUNTOVIVO_RATE_LIMIT_PUBLIC_WINDOW_MS', ONE_MINUTE),
    keyBy: ['ip'],
  },
  publicApi: {
    name: 'rl.public-api',
    max: envInt('PUNTOVIVO_RATE_LIMIT_PUBLIC_API_MAX', 120),
    windowMs: envInt('PUNTOVIVO_RATE_LIMIT_PUBLIC_API_WINDOW_MS', ONE_MINUTE),
    keyBy: ['tenantId', 'ip'],
  },
} as const satisfies Record<string, BucketConfig>;

/**
 * ENG-165 — pick the bucket for a procedure by its path + type +
 * authentication state. Returns `null` for procedures this middleware
 * does not throttle (the `auth.*` family, which carries its own strict
 * limits). Exported pure for unit testing.
 */
export function classifyBucket(
  path: string,
  type: 'query' | 'mutation' | 'subscription',
  authenticated: boolean
): BucketConfig | null {
  if (path.startsWith('auth.')) {
    return null;
  }
  if (path.startsWith('publicApi.')) {
    return BUCKETS.publicApi;
  }
  if (!authenticated) {
    return BUCKETS.public;
  }
  if (type === 'mutation') {
    return path.startsWith('sales.') ? BUCKETS.salesWrite : BUCKETS.write;
  }
  return BUCKETS.read;
}

// Test seam: lets the bucket-rate-limit suite force enforcement through
// the real middleware (the underlying store bypasses under the test
// runner by default so the broader suite is never throttled).
let enforceInTestOverride = false;
export function __setBucketRateLimitEnforceForTest(value: boolean): void {
  enforceInTestOverride = value;
}

/**
 * Best-effort: record a single rate-limit hit to `system_audit_logs`.
 * Never throws — an audit-write failure must not mask the
 * TOO_MANY_REQUESTS the caller is about to receive.
 */
function recordRateLimitHit(
  ctx: Context,
  args: {
    bucket: string;
    path: string;
    ip: string | null;
    siteId: string | null;
    max: number;
    windowMs: number;
  }
): void {
  try {
    ctx.db
      .insert(systemAuditLogs)
      .values({
        id: nanoid(),
        action: 'rate_limit.exceeded',
        resourceType: 'rate_limit',
        resourceId: args.path,
        status: 'error',
        metadata: {
          bucket: args.bucket,
          path: args.path,
          tenantId: ctx.tenantId,
          userId: ctx.user?.id ?? null,
          siteId: args.siteId,
          ip: args.ip,
          max: args.max,
          windowMs: args.windowMs,
        },
      })
      .run();
  } catch (err) {
    log.warn({ err, path: args.path }, 'failed to record rate-limit audit event');
  }
}

/**
 * The bare middleware function — exported so `init.ts` can wrap it with
 * `t.middleware` without `bucketRateLimit` importing `init` (mirrors the
 * tracing middleware and avoids a circular module load).
 */
export async function bucketRateLimitFn({
  ctx,
  path,
  type,
  next,
}: {
  ctx: Context;
  path: string;
  type: 'query' | 'mutation' | 'subscription';
  next: () => Promise<unknown>;
}): Promise<unknown> {
  const bucket = classifyBucket(path, type, ctx.user !== null);
  if (!bucket) {
    return next();
  }

  const ip = typeof ctx.req?.ip === 'string' ? ctx.req.ip : null;
  const decision = consumeRateLimitBucket({
    name: bucket.name,
    max: bucket.max,
    windowMs: bucket.windowMs,
    keyBy: bucket.keyBy,
    ip,
    userId: ctx.user?.id ?? null,
    tenantId: ctx.tenantId ?? null,
    siteId: ctx.siteId ?? null,
    enforceInTest: enforceInTestOverride,
  });

  if (decision.outcome === 'denied') {
    if (decision.firstDenial) {
      recordRateLimitHit(ctx, {
        bucket: bucket.name,
        path,
        ip,
        siteId: ctx.siteId ?? null,
        max: bucket.max,
        windowMs: bucket.windowMs,
      });
    }
    throwServerError({
      trpcCode: 'TOO_MANY_REQUESTS',
      errorCode: 'AUTH_RATE_LIMIT_EXCEEDED',
      message: 'Too many requests. Please slow down and try again shortly.',
    });
  }

  return next();
}
