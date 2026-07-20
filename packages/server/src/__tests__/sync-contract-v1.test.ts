/**
 * Sync contract v1 acceptance tests.
 *
 * Covers the four areas the acceptance contract demands:
 *
 * 1. **Ordering** — priority + dependency-blocked rows.
 * 2. **Retry** — manual `sync.retry` resets retryable rows and
 * does not requeue rows that already synced.
 * 3. **Duplicate suppression** — partial unique index collapses
 * idempotent retries when an envelope key is present.
 * 4. **Manual conflict on high-risk** — sales/cash/fiscal/inventory
 * rows always carry `conflict_policy='manual'` so consumer UIs
 * route to operator-driven resolution.
 *
 * Tests drive `enqueueSync` directly (the helper is the contract
 * surface) and read via `sync.peekOutbox`.  cut the 19 router
 * writers + existing `sync.*` procedures over to the same table, so
 * `sync.test.ts` now exercises the canonical `sync_outbox` path too.
 */

import { afterEach, beforeAll, afterAll, describe, expect, it } from 'vitest';
import { TRPCError } from '@trpc/server';
import { and, eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { createServer, type PuntovivoServer } from '../index.js';
import { getDatabase } from '../db/index.js';
import { syncOutbox, tenants, users, type SyncOutboxStatus } from '../db/schema.js';
import { appRouter } from '../trpc/router.js';
import { enqueueSync, resolveDefaultPriority } from '../services/sync/index.js';
import type { Context } from '../trpc/context.js';

let server: PuntovivoServer;
let tenantId: string;
let userId: string;

function buildContext(role: 'admin' | 'manager' | 'cashier' = 'admin'): Context {
  const db = getDatabase();
  return {
    req: {
      server: server.app,
      headers: {},
      log: { warn: () => undefined, info: () => undefined },
      user: {
        userId,
        email: 'admin@localhost',
        role,
        tenantId,
      },
      jwtVerify: async () => {},
    } as unknown as Context['req'],
    res: {} as Context['res'],
    db,
    user: {
      id: userId,
      email: 'admin@localhost',
      role,
      tenantId,
    },
    tenantId,
    siteId: null,
  };
}

beforeAll(async () => {
  server = await createServer({ dbPath: ':memory:', verbose: false });
  const db = getDatabase();
  const seededUser = await db.select().from(users).where(eq(users.email, 'admin@localhost')).get();
  if (!seededUser) throw new Error('Expected seeded admin user');
  tenantId = seededUser.tenantId;
  userId = seededUser.id;
});

afterAll(async () => {
  await server.close();
});

afterEach(async () => {
  await getDatabase().delete(syncOutbox).where(eq(syncOutbox.tenantId, tenantId));
});

describe('sync contract v1 — ordering', () => {
  it('drains rows by priority DESC then created_at ASC via peekOutbox', async () => {
    const db = getDatabase();
    // Three rows: low/middle/high priority. `peekOutbox` orders by
    // priority DESC then createdAt — high priority should appear
    // first regardless of insertion order.
    await enqueueSync(
      { db, tenantId },
      {
        entityType: 'products',
        entityId: 'p1',
        operation: 'create',
        data: { id: 'p1' },
        priority: 0,
      }
    );
    await enqueueSync(
      { db, tenantId },
      {
        entityType: 'audit_logs',
        entityId: 'a1',
        operation: 'create',
        data: { id: 'a1' },
      }
    );
    await enqueueSync(
      { db, tenantId },
      {
        entityType: 'sales',
        entityId: 's1',
        operation: 'create',
        data: { id: 's1' },
      }
    );
    const caller = appRouter.createCaller(buildContext('admin'));
    const rows = await caller.sync.peekOutbox({});
    expect(rows.map(r => r.entityType)).toEqual(['audit_logs', 'sales', 'products']);
  });

  it('audit_logs default priority (10) jumps ahead of money-bound default (5)', () => {
    expect(resolveDefaultPriority('audit_logs')).toBe(10);
    expect(resolveDefaultPriority('sales')).toBe(5);
    expect(resolveDefaultPriority('cash_movements')).toBe(5);
    expect(resolveDefaultPriority('inventory_movements')).toBe(5);
  });

  it('catalog default priority is 0 (drains last by default)', () => {
    expect(resolveDefaultPriority('customers')).toBe(0);
    expect(resolveDefaultPriority('products')).toBe(0);
    expect(resolveDefaultPriority('categories')).toBe(0);
  });

  it('persists dependsOnOperationId so consumers can apply rows topologically', async () => {
    const db = getDatabase();
    const dep = `op-${nanoid()}`;
    await enqueueSync(
      { db, tenantId },
      {
        entityType: 'sales',
        entityId: 'sale-x',
        operation: 'create',
        data: { id: 'sale-x', customerId: 'cust-y' },
        dependsOnOperationId: dep,
      }
    );
    const caller = appRouter.createCaller(buildContext('admin'));
    const rows = await caller.sync.peekOutbox({});
    expect(rows[0]?.dependsOnOperationId).toBe(dep);
  });
});

describe('sync contract v1 — retry', () => {
  it('manual sync.retry resets attempts + clears lastError + status back to queued', async () => {
    const db = getDatabase();
    const id = nanoid();
    const now = new Date().toISOString();
    await db.insert(syncOutbox).values({
      id,
      tenantId,
      status: 'retrying' as SyncOutboxStatus,
      entityType: 'sales',
      entityId: 'sale-stuck',
      operation: 'create',
      conflictPolicy: 'manual',
      payload: { id: 'sale-stuck' },
      payloadVersion: 1,
      attempts: 3,
      nextRetryAt: '2027-01-01T00:00:00.000Z',
      lastError: { errorCode: 'NETWORK_TIMEOUT', providerMessage: 'stuck', recoverable: true },
      priority: 5,
      createdAt: now,
      updatedAt: now,
    });
    const caller = appRouter.createCaller(buildContext('admin'));
    await caller.sync.retry({ id });
    const row = await db.select().from(syncOutbox).where(eq(syncOutbox.id, id)).get();
    expect(row?.status).toBe('queued');
    expect(row?.attempts).toBe(0);
    expect(row?.nextRetryAt).toBeNull();
    expect(row?.lastError).toBeNull();
  });

  it('sync.retry returns NOT_FOUND for unknown row id', async () => {
    const caller = appRouter.createCaller(buildContext('admin'));
    try {
      await caller.sync.retry({ id: 'never-existed' });
      throw new Error('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(TRPCError);
      expect((err as TRPCError).code).toBe('NOT_FOUND');
    }
  });

  it('sync.retry does not requeue rows that already synced', async () => {
    const db = getDatabase();
    const id = nanoid();
    const now = new Date().toISOString();
    await db.insert(syncOutbox).values({
      id,
      tenantId,
      status: 'synced' as SyncOutboxStatus,
      entityType: 'sales',
      entityId: 'sale-synced',
      operation: 'create',
      conflictPolicy: 'manual',
      payload: { id: 'sale-synced' },
      payloadVersion: 1,
      attempts: 1,
      nextRetryAt: null,
      lastError: null,
      priority: 5,
      createdAt: now,
      updatedAt: now,
    });
    const caller = appRouter.createCaller(buildContext('admin'));
    await caller.sync.retry({ id });
    const row = await db.select().from(syncOutbox).where(eq(syncOutbox.id, id)).get();
    expect(row?.status).toBe('synced');
    expect(row?.attempts).toBe(1);
  });

  it('sync.retry rejects cashier with FORBIDDEN', async () => {
    const caller = appRouter.createCaller(buildContext('cashier'));
    try {
      await caller.sync.retry({ id: 'whatever' });
      throw new Error('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(TRPCError);
      expect((err as TRPCError).code).toBe('FORBIDDEN');
    }
  });

  it('sync.peekOutbox surfaces attempts + nextRetryAt for the operator', async () => {
    const db = getDatabase();
    const id = nanoid();
    const nextRetry = '2027-06-01T00:00:00.000Z';
    const now = new Date().toISOString();
    await db.insert(syncOutbox).values({
      id,
      tenantId,
      status: 'retrying' as SyncOutboxStatus,
      entityType: 'sales',
      entityId: 'sale-r',
      operation: 'create',
      conflictPolicy: 'manual',
      payload: {},
      payloadVersion: 1,
      attempts: 2,
      nextRetryAt: nextRetry,
      priority: 5,
      createdAt: now,
      updatedAt: now,
    });
    const caller = appRouter.createCaller(buildContext('manager'));
    const rows = await caller.sync.peekOutbox({});
    const row = rows.find(r => r.id === id);
    expect(row?.attempts).toBe(2);
    expect(row?.nextRetryAt).toBe(nextRetry);
  });
});

describe('sync contract v1 — duplicate suppression', () => {
  it('coalesces idempotent retries when envelope idempotencyKey is present', async () => {
    const db = getDatabase();
    const idempotencyKey = `idem-${nanoid()}`;
    const ctx = {
      db,
      tenantId,
      envelope: { operationId: nanoid(), idempotencyKey },
    };
    const first = await enqueueSync(ctx, {
      entityType: 'sales',
      entityId: 'sale-x',
      operation: 'create',
      data: { id: 'sale-x', total: 100 },
    });
    const second = await enqueueSync(ctx, {
      entityType: 'sales',
      entityId: 'sale-x',
      operation: 'create',
      data: { id: 'sale-x', total: 100 },
    });
    expect(first.deduped).toBe(false);
    expect(second.deduped).toBe(true);
    expect(second.id).toBe(first.id);

    const rows = await db
      .select()
      .from(syncOutbox)
      .where(and(eq(syncOutbox.tenantId, tenantId), eq(syncOutbox.entityId, 'sale-x')))
      .all();
    expect(rows).toHaveLength(1);
  });

  it('does NOT collapse when idempotencyKey is missing (catalog writes are idempotent on consumer side)', async () => {
    const db = getDatabase();
    await enqueueSync(
      { db, tenantId },
      {
        entityType: 'customers',
        entityId: 'cust-x',
        operation: 'update',
        data: { id: 'cust-x', name: 'A' },
      }
    );
    await enqueueSync(
      { db, tenantId },
      {
        entityType: 'customers',
        entityId: 'cust-x',
        operation: 'update',
        data: { id: 'cust-x', name: 'B' },
      }
    );
    const rows = await db.select().from(syncOutbox).where(eq(syncOutbox.tenantId, tenantId)).all();
    expect(rows.length).toBeGreaterThanOrEqual(2);
  });

  it('different idempotency keys produce separate rows even for the same entity', async () => {
    const db = getDatabase();
    const first = await enqueueSync(
      { db, tenantId, envelope: { operationId: nanoid(), idempotencyKey: 'k1' } },
      {
        entityType: 'sales',
        entityId: 'sale-y',
        operation: 'create',
        data: { id: 'sale-y' },
      }
    );
    const second = await enqueueSync(
      { db, tenantId, envelope: { operationId: nanoid(), idempotencyKey: 'k2' } },
      {
        entityType: 'sales',
        entityId: 'sale-y',
        operation: 'create',
        data: { id: 'sale-y' },
      }
    );
    expect(first.deduped).toBe(false);
    expect(second.deduped).toBe(false);
    expect(first.id).not.toBe(second.id);
  });

  it('cross-tenant isolation: tenant B duplicate key does not block tenant A', async () => {
    const db = getDatabase();
    // Seed a foreign tenant + use the SAME idempotencyKey.
    const foreignTenantId = `tenant-${nanoid(8)}`;
    const now = new Date().toISOString();
    await db.insert(tenants).values({
      id: foreignTenantId,
      name: 'Foreign Tenant',
      slug: `foreign-${nanoid(6)}`,
      settings: {},
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });
    const sharedKey = `idem-shared-${nanoid()}`;
    const a = await enqueueSync(
      { db, tenantId, envelope: { operationId: nanoid(), idempotencyKey: sharedKey } },
      { entityType: 'sales', entityId: 'sale-z', operation: 'create', data: {} }
    );
    const b = await enqueueSync(
      {
        db,
        tenantId: foreignTenantId,
        envelope: { operationId: nanoid(), idempotencyKey: sharedKey },
      },
      { entityType: 'sales', entityId: 'sale-z', operation: 'create', data: {} }
    );
    expect(a.deduped).toBe(false);
    expect(b.deduped).toBe(false);
    expect(a.id).not.toBe(b.id);
    // Cleanup: drop the foreign tenant's row.
    await db.delete(syncOutbox).where(eq(syncOutbox.tenantId, foreignTenantId));
  });
});

describe('sync contract v1 — manual conflict on high-risk entities', () => {
  it('tags every high-risk entity as manual via the conflict policy column', async () => {
    const db = getDatabase();
    const highRisk = [
      'sales',
      'sale_items',
      'sale_payments',
      'cash_sessions',
      'cash_movements',
      'fiscal_documents',
      'inventory_movements',
      'audit_logs',
    ] as const;
    for (const entityType of highRisk) {
      await enqueueSync(
        { db, tenantId },
        { entityType, entityId: nanoid(), operation: 'create', data: {} }
      );
    }
    const rows = await db
      .select({ entityType: syncOutbox.entityType, conflictPolicy: syncOutbox.conflictPolicy })
      .from(syncOutbox)
      .where(eq(syncOutbox.tenantId, tenantId))
      .all();
    for (const row of rows) {
      expect(row.conflictPolicy).toBe('manual');
    }
  });

  it('tags catalog entities as auto_lww via the conflict policy column', async () => {
    const db = getDatabase();
    const catalog = ['customers', 'products', 'categories', 'units', 'providers'] as const;
    for (const entityType of catalog) {
      await enqueueSync(
        { db, tenantId },
        { entityType, entityId: nanoid(), operation: 'create', data: {} }
      );
    }
    const rows = await db
      .select({ entityType: syncOutbox.entityType, conflictPolicy: syncOutbox.conflictPolicy })
      .from(syncOutbox)
      .where(eq(syncOutbox.tenantId, tenantId))
      .all();
    for (const row of rows) {
      expect(row.conflictPolicy).toBe('auto_lww');
    }
  });

  it('peekOutbox exposes the conflict policy so the operator UI can route manual rows distinctly', async () => {
    const db = getDatabase();
    await enqueueSync(
      { db, tenantId },
      { entityType: 'sales', entityId: 'sale-policy', operation: 'create', data: {} }
    );
    await enqueueSync(
      { db, tenantId },
      { entityType: 'customers', entityId: 'cust-policy', operation: 'update', data: {} }
    );
    const caller = appRouter.createCaller(buildContext('manager'));
    const rows = await caller.sync.peekOutbox({});
    const sale = rows.find(r => r.entityType === 'sales');
    const customer = rows.find(r => r.entityType === 'customers');
    expect(sale?.conflictPolicy).toBe('manual');
    expect(customer?.conflictPolicy).toBe('auto_lww');
  });

  it('rejects unknown entity types at the helper boundary', async () => {
    const db = getDatabase();
    await expect(
      enqueueSync(
        { db, tenantId },
        {
          // Cast through unknown to bypass TS exhaustiveness — the
          // runtime guard is what we're testing.
          entityType: 'NOT_A_REAL_ENTITY' as unknown as 'sales',
          entityId: 'x',
          operation: 'create',
          data: {},
        }
      )
    ).rejects.toThrow(/Unknown entityType/);
  });

  it('admin can call sync.getContract and sees the manifest', async () => {
    const caller = appRouter.createCaller(buildContext('admin'));
    const manifest = await caller.sync.getContract();
    expect(manifest.payloadVersion).toBeGreaterThanOrEqual(1);
    expect(manifest.entities.length).toBeGreaterThan(0);
    const sales = manifest.entities.find(e => e.entityType === 'sales');
    expect(sales?.conflictPolicy).toBe('manual');
  });

  it('cashier cannot call sync.getContract', async () => {
    const caller = appRouter.createCaller(buildContext('cashier'));
    try {
      await caller.sync.getContract();
      throw new Error('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(TRPCError);
      expect((err as TRPCError).code).toBe('FORBIDDEN');
    }
  });
});
