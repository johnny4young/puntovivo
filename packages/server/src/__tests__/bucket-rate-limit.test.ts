/**
 * tRPC-aware bucket rate limiting.
 *
 * Pins the classifier (which bucket each procedure shape lands in), the
 * once-per-window audit event, bucket independence (sales-write vs read,
 * two tenants), and that the middleware throws TOO_MANY_REQUESTS on a
 * saturated bucket. The underlying store self-bypasses under Vitest, so
 * these tests opt into enforcement explicitly.
 */

import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { createServer, type PuntovivoServer } from '../index.js';
import { getDatabase } from '../db/index.js';
import { systemAuditLogs } from '../db/schema.js';
import {
  __resetProcedureRateLimitForTest,
  consumeRateLimitBucket,
} from '../trpc/middleware/procedureRateLimit.js';
import {
  __setBucketRateLimitEnforceForTest,
  bucketRateLimitFn,
  classifyBucket,
} from '../trpc/middleware/bucketRateLimit.js';
import type { Context } from '../trpc/context.js';

let server: PuntovivoServer;

beforeAll(async () => {
  server = await createServer({ dbPath: ':memory:', verbose: false });
});

afterAll(async () => {
  await server.close();
});

afterEach(() => {
  __resetProcedureRateLimitForTest();
  __setBucketRateLimitEnforceForTest(false);
  getDatabase().delete(systemAuditLogs).run();
});

function mockCtx(args: {
  ip: string | null;
  userId: string | null;
  tenantId: string | null;
  siteId?: string | null;
}): Context {
  return {
    req: { ip: args.ip } as unknown as Context['req'],
    res: {} as Context['res'],
    db: getDatabase(),
    user: args.userId
      ? {
          id: args.userId,
          email: `${args.userId}@x`,
          role: 'cashier',
          tenantId: args.tenantId ?? '',
        }
      : null,
    tenantId: args.tenantId,
    siteId: args.siteId ?? null,
  };
}

describe('classifyBucket', () => {
  it('skips the auth family (its own strict limits apply)', () => {
    expect(classifyBucket('auth.login', 'mutation', false)).toBeNull();
    expect(classifyBucket('auth.refresh', 'query', true)).toBeNull();
  });

  it('routes each shape to its own bucket', () => {
    expect(classifyBucket('publicApi.products', 'query', false)?.name).toBe('rl.public-api');
    expect(classifyBucket('observability.reportWebVital', 'query', false)?.name).toBe('rl.public');
    expect(classifyBucket('sales.complete', 'mutation', true)?.name).toBe('rl.sales-write');
    expect(classifyBucket('products.update', 'mutation', true)?.name).toBe('rl.write');
    expect(classifyBucket('products.list', 'query', true)?.name).toBe('rl.read');
  });
});

describe('bucket independence', () => {
  it('exhausting sales-write does not deny read, and tenant/site buckets are independent', () => {
    const sales = classifyBucket('sales.complete', 'mutation', true)!;
    const read = classifyBucket('products.list', 'query', true)!;
    const consume = (b: typeof sales, tenantId: string, siteId: string | null = null) =>
      consumeRateLimitBucket({
        name: b.name,
        max: 2,
        windowMs: 60_000,
        keyBy: b.keyBy,
        tenantId,
        siteId,
        userId: 'u-1',
        enforceInTest: true,
      }).outcome;

    // Saturate sales-write for tenant t-1 (cap forced to 2 here).
    expect(consume(sales, 't-1', 's-1')).toBe('allowed');
    expect(consume(sales, 't-1', 's-1')).toBe('allowed');
    expect(consume(sales, 't-1', 's-1')).toBe('denied');
    // The read bucket for the same tenant/user is untouched.
    expect(consume(read, 't-1')).toBe('allowed');
    // Another site in the same tenant has an independent sales-write bucket.
    expect(consume(sales, 't-1', 's-2')).toBe('allowed');
    // Another tenant's sales-write bucket is independent too.
    expect(consume(sales, 't-2', 's-1')).toBe('allowed');
  });
});

describe('bucketRateLimitFn middleware', () => {
  it('throws TOO_MANY_REQUESTS on a saturated bucket and audits the hit once', async () => {
    __setBucketRateLimitEnforceForTest(true);
    const bucket = classifyBucket('sales.complete', 'mutation', true)!;

    // Saturate the sales-write bucket for one tenant/site/user through the shared store.
    for (let i = 0; i < bucket.max; i += 1) {
      consumeRateLimitBucket({
        name: bucket.name,
        max: bucket.max,
        windowMs: bucket.windowMs,
        keyBy: bucket.keyBy,
        ip: '9.9.9.9',
        tenantId: 't-1',
        siteId: 's-1',
        userId: 'u-1',
        enforceInTest: true,
      });
    }

    const ctx = mockCtx({ ip: '9.9.9.9', userId: 'u-1', tenantId: 't-1', siteId: 's-1' });
    let nextCalls = 0;
    const next = async () => {
      nextCalls += 1;
      return 'ok';
    };

    // The next call through the middleware is denied.
    await expect(
      bucketRateLimitFn({ ctx, path: 'sales.complete', type: 'mutation', next })
    ).rejects.toThrow(/too many requests/i);
    expect(nextCalls).toBe(0);

    // Exactly one audit row for the first denial of the window.
    const rows = getDatabase()
      .select()
      .from(systemAuditLogs)
      .where(eq(systemAuditLogs.action, 'rate_limit.exceeded'))
      .all();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.resourceType).toBe('rate_limit');
    expect((rows[0]?.metadata as { bucket?: string; siteId?: string | null } | null)?.bucket).toBe(
      'rl.sales-write'
    );
    expect((rows[0]?.metadata as { bucket?: string; siteId?: string | null } | null)?.siteId).toBe(
      's-1'
    );

    // A second denial in the same window throws again but writes NO new
    // audit row (once-per-window).
    await expect(
      bucketRateLimitFn({ ctx, path: 'sales.complete', type: 'mutation', next })
    ).rejects.toThrow(/too many requests/i);
    const after = getDatabase()
      .select()
      .from(systemAuditLogs)
      .where(eq(systemAuditLogs.action, 'rate_limit.exceeded'))
      .all();
    expect(after).toHaveLength(1);
  });

  it('lets a call through when the bucket has capacity (and skips auth.*)', async () => {
    __setBucketRateLimitEnforceForTest(true);
    const ctx = mockCtx({ ip: '5.5.5.5', userId: 'u-9', tenantId: 't-9', siteId: 's-9' });
    let nextCalls = 0;
    const next = async () => {
      nextCalls += 1;
      return 'ok';
    };

    // Authenticated query with capacity → passes.
    await bucketRateLimitFn({ ctx, path: 'products.list', type: 'query', next });
    // auth.* is skipped entirely by this middleware.
    await bucketRateLimitFn({ ctx, path: 'auth.refresh', type: 'mutation', next });
    expect(nextCalls).toBe(2);
  });
});
