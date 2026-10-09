import { __withExpectedTestLogs } from '../logging/logger.js';
import { enqueueSync } from '../services/sync/enqueue.js';
/**
 * Sync tRPC Router Tests
 *
 * Tests sync procedures via appRouter.createCaller() for type-safe testing.
 *
 * @module __tests__/sync.test
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { TRPCError } from '@trpc/server';
import { createServer, type PuntovivoServer } from '../index.js';
import { getDatabase } from '../db/index.js';
import {
  appSettings,
  companies,
  inventoryLots,
  products,
  sites,
  syncConflicts,
  syncOutbox,
  tenants,
  users,
} from '../db/schema.js';
import { and, eq, sql } from 'drizzle-orm';
import { hash } from 'argon2';
import { nanoid } from 'nanoid';
import { appRouter } from '../trpc/router.js';
import { getLastSyncKey, saveLastSyncAt } from '../trpc/routers/sync/helpers.js';
import type { Context } from '../trpc/context.js';

let server: PuntovivoServer;
let testTenantId: string;
let testUserId: string;
const testDbPath = ':memory:';

/**
 * Build a tRPC context for use with createCaller.
 * For protected tenant procedures, pass user payload.
 */
function createTestContext(userPayload?: {
  id: string;
  email: string;
  role: string;
  tenantId: string;
}): Context {
  const db = getDatabase();

  const mockReq = {
    server: server.app,
    headers: {},
    user: userPayload
      ? {
          userId: userPayload.id,
          email: userPayload.email,
          role: userPayload.role,
          tenantId: userPayload.tenantId,
        }
      : null,
    jwtVerify: async () => {
      if (!userPayload) throw new Error('No token');
    },
  } as unknown as Context['req'];

  const mockRes = {} as unknown as Context['res'];

  return {
    req: mockReq,
    res: mockRes,
    db,
    user: userPayload
      ? {
          id: userPayload.id,
          email: userPayload.email,
          role: userPayload.role,
          tenantId: userPayload.tenantId,
        }
      : null,
    tenantId: userPayload?.tenantId ?? null,
    siteId: null,
  };
}

describe('Sync tRPC Router', () => {
  beforeAll(async () => {
    server = await createServer({
      dbPath: testDbPath,
      verbose: false,
    });

    const db = getDatabase();

    // Create test tenant
    testTenantId = nanoid();
    await db.insert(tenants).values({
      id: testTenantId,
      name: 'Sync Test Tenant',
      slug: `sync-test-${nanoid(6)}`,
      settings: {},
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    // Create test user
    testUserId = nanoid();
    const passwordHash = await hash('SyncPass123!');
    await db.insert(users).values({
      id: testUserId,
      tenantId: testTenantId,
      email: 'synctest@example.com',
      passwordHash,
      name: 'Sync Test User',
      role: 'admin',
      isActive: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
  });

  beforeEach(async () => {
    const db = getDatabase();

    await db.delete(syncConflicts).where(eq(syncConflicts.tenantId, testTenantId)).run();
    await db.delete(syncOutbox).where(eq(syncOutbox.tenantId, testTenantId)).run();
    await db
      .delete(appSettings)
      .where(eq(appSettings.key, getLastSyncKey(testTenantId)))
      .run();
  });

  afterAll(async () => {
    if (server) {
      await server.close();
    }
  });

  const userCtx = (role = 'admin') =>
    createTestContext({
      id: testUserId,
      email: 'synctest@example.com',
      role,
      tenantId: testTenantId,
    });

  function contextWithInterleavedPushBatch(id: string, onRead: () => void): Context {
    const context = userCtx();
    let intercepted = false;
    function interceptAll<T extends object>(query: T): T {
      return new Proxy(query, {
        get(target, property, receiver) {
          const value = Reflect.get(target, property, receiver);
          if (typeof value !== 'function') return value;
          if (property === 'all') {
            return async (...args: unknown[]) => {
              const rows: unknown = await Reflect.apply(value, target, args);
              if (
                !intercepted &&
                Array.isArray(rows) &&
                rows.some(row => row !== null && typeof row === 'object' && row.id === id)
              ) {
                intercepted = true;
                onRead();
              }
              return rows;
            };
          }
          return (...args: unknown[]) => {
            const result: unknown = Reflect.apply(value, target, args);
            return result !== null && typeof result === 'object' ? interceptAll(result) : result;
          };
        },
      });
    }
    const racedDb = new Proxy(context.db, {
      get(target, property, receiver) {
        const value = Reflect.get(target, property, receiver);
        if (property === 'select' && typeof value === 'function') {
          return (...args: unknown[]) => {
            const builder: unknown = Reflect.apply(value, target, args);
            return builder !== null && typeof builder === 'object'
              ? interceptAll(builder)
              : builder;
          };
        }
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
    return { ...context, db: racedDb };
  }

  async function insertSyncProduct(entityId: string, name = 'Sync Product') {
    const now = new Date().toISOString();
    await getDatabase()
      .insert(products)
      .values({
        id: entityId,
        tenantId: testTenantId,
        name,
        sku: `sync-${nanoid(6)}`,
        syncStatus: 'pending',
        syncVersion: 0,
        createdAt: now,
        updatedAt: now,
      });
  }

  describe('sync.status', () => {
    it('returns synced status with zero counts when queue is empty', async () => {
      const caller = appRouter.createCaller(userCtx());
      const result = await caller.sync.status();

      expect(result.pendingCount).toBe(0);
      expect(result.retryingCount).toBe(0);
      expect(result.failedCount).toBe(0);
      expect(result.conflictsCount).toBe(0);
      expect(result.externalSyncEnabled).toBe(true);
      expect(result.oldestPendingAt).toBeNull();
      expect(result.status).toBe('synced');
    });
  });

  describe('sync.addToQueue', () => {
    it('requires manager or admin role for manual queue controls and payload reads', async () => {
      const cashierCaller = appRouter.createCaller(userCtx('cashier'));

      await expect(cashierCaller.sync.listQueue({ limit: 50 })).rejects.toMatchObject({
        code: 'FORBIDDEN',
      });
      await expect(
        cashierCaller.sync.addToQueue({
          entityType: 'products',
          entityId: nanoid(),
          operation: 'create',
          data: { name: 'Unauthorized Product' },
        })
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });
      await expect(
        cashierCaller.sync.removeFromQueue({ id: 'sync-outbox-any' })
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });
      await expect(cashierCaller.sync.listConflicts({ limit: 50 })).rejects.toMatchObject({
        code: 'FORBIDDEN',
      });
      await expect(
        cashierCaller.sync.pull({ queueLimit: 10, conflictLimit: 10 })
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    });

    it('adds an item and returns id, entityType, entityId, operation, createdAt', async () => {
      const caller = appRouter.createCaller(userCtx());
      const entityId = nanoid();

      await insertSyncProduct(entityId);
      const result = await caller.sync.addToQueue({
        entityType: 'products',
        entityId,
        operation: 'update',
        data: { name: 'Test Product', price: 100 },
      });

      expect(result.id).toBeDefined();
      expect(result.id).toBeTypeOf('string');
      expect(result.entityType).toBe('products');
      expect(result.entityId).toBe(entityId);
      expect(result.operation).toBe('update');
      expect(result.createdAt).toBeDefined();
    });

    it('rejects an entityType outside the SYNC_ENTITY_TYPES whitelist at the schema boundary', async () => {
      const caller = appRouter.createCaller(userCtx());

      await expect(
        caller.sync.addToQueue({
          // Cast: the typed client can no longer express this, but a raw
          // HTTP caller could still send it — the zod enum must reject it
          // with BAD_REQUEST instead of reaching resolveConflictPolicy.
          entityType: 'not_a_real_entity' as never,
          entityId: nanoid(),
          operation: 'create',
          data: {},
        })
      ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    });
  });

  describe('sync.listQueue', () => {
    it('returns items added to the queue', async () => {
      const caller = appRouter.createCaller(userCtx());

      // Add two more items so we have items to list
      await caller.sync.addToQueue({
        entityType: 'customers',
        entityId: nanoid(),
        operation: 'update',
        data: { name: 'Updated Customer' },
      });
      await caller.sync.addToQueue({
        entityType: 'categories',
        entityId: nanoid(),
        operation: 'delete',
        data: {},
      });

      const result = await caller.sync.listQueue({ limit: 50 });

      expect(result.items).toBeDefined();
      expect(Array.isArray(result.items)).toBe(true);
      expect(result.count).toBeGreaterThanOrEqual(2);
    });

    it('respects the limit parameter', async () => {
      const caller = appRouter.createCaller(userCtx());
      const result = await caller.sync.listQueue({ limit: 1 });

      expect(result.items.length).toBeLessThanOrEqual(1);
    });
  });

  describe('sync.removeFromQueue', () => {
    it('removes an existing item and returns { success: true, id }', async () => {
      const caller = appRouter.createCaller(userCtx());

      const entityId = nanoid();
      await insertSyncProduct(entityId);
      const added = await caller.sync.addToQueue({
        entityType: 'products',
        entityId,
        operation: 'update',
        data: { price: 99 },
      });

      const result = await caller.sync.removeFromQueue({ id: added.id });

      expect(result.success).toBe(true);
      expect(result.id).toBe(added.id);
    });

    it('throws NOT_FOUND for an unknown queue item id', async () => {
      const caller = appRouter.createCaller(userCtx());

      try {
        await caller.sync.removeFromQueue({ id: 'nonexistent-queue-item' });
        expect.unreachable('Should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(TRPCError);
        expect((err as TRPCError).code).toBe('NOT_FOUND');
      }
    });
  });

  describe('sync.listConflicts', () => {
    it('returns an empty list when there are no conflicts', async () => {
      const caller = appRouter.createCaller(userCtx());
      const result = await caller.sync.listConflicts({ limit: 50 });

      expect(result.items).toBeDefined();
      expect(Array.isArray(result.items)).toBe(true);
      expect(result.count).toBe(0);
    });
  });

  describe('sync.push', () => {
    it.each(['synced', 'deleted'] as const)(
      'does not process a row %s after batch selection',
      async transition => {
        const db = getDatabase();
        const entityId = nanoid();
        const queued = await enqueueSync(
          { db, tenantId: testTenantId },
          {
            entityType: 'products',
            entityId,
            operation: 'update',
            data: { id: entityId },
          }
        );
        let completedAfterRead = false;
        const context = contextWithInterleavedPushBatch(queued.id, () => {
          completedAfterRead = true;
          const scope = and(eq(syncOutbox.id, queued.id), eq(syncOutbox.tenantId, testTenantId));
          if (transition === 'deleted') {
            db.delete(syncOutbox).where(scope).run();
          } else {
            db.update(syncOutbox).set({ status: 'synced' }).where(scope).run();
          }
        });
        const caller = appRouter.createCaller(context);
        const result = await caller.sync.push({ limit: 50 });
        expect(completedAfterRead).toBe(true);
        const row = await db.select().from(syncOutbox).where(eq(syncOutbox.id, queued.id)).get();
        if (transition === 'deleted') expect(row).toBeUndefined();
        else expect(row?.status).toBe('synced');
        expect(result.synced).toBe(0);
        expect(result.processedIds).toEqual([]);
        expect(result.lastSyncAt).toBeNull();
        expect(result.conflictIds).toEqual([]);
      }
    );

    it('uses a coalesced payload even when its timestamp remains in the same millisecond', async () => {
      const db = getDatabase();
      const entityId = nanoid();
      const queued = await enqueueSync(
        { db, tenantId: testTenantId },
        {
          entityType: 'products',
          entityId,
          operation: 'update',
          data: { id: entityId, revision: 1 },
        }
      );
      const original = await db.select().from(syncOutbox).where(eq(syncOutbox.id, queued.id)).get();
      if (!original) throw new Error('Expected queued outbox row');

      let coalescedAfterRead = false;
      const context = contextWithInterleavedPushBatch(queued.id, () => {
        coalescedAfterRead = true;
        db.update(syncOutbox)
          .set({ payload: { id: entityId, revision: 2 }, updatedAt: original.updatedAt })
          .where(and(eq(syncOutbox.id, queued.id), eq(syncOutbox.tenantId, testTenantId)))
          .run();
      });
      const result = await appRouter.createCaller(context).sync.push({ limit: 50 });
      expect(coalescedAfterRead).toBe(true);
      expect(result.conflictIds).toHaveLength(1);
      const conflict = await db
        .select()
        .from(syncConflicts)
        .where(eq(syncConflicts.id, result.conflictIds[0]!))
        .get();
      expect(conflict?.localData).toMatchObject({ id: entityId, revision: 2 });
    });

    it('rolls back entity metadata when the outbox completion write fails', async () => {
      const db = getDatabase();
      const productId = nanoid();
      const now = new Date().toISOString();
      await db.insert(products).values({
        id: productId,
        tenantId: testTenantId,
        name: 'Rollback Sync Product',
        sku: `sync-${nanoid(6)}`,
        syncStatus: 'pending',
        syncVersion: 0,
        createdAt: now,
        updatedAt: now,
      });
      const queued = await enqueueSync(
        { db, tenantId: testTenantId },
        {
          entityType: 'products',
          entityId: productId,
          operation: 'update',
          data: { id: productId },
        }
      );
      db.run(
        sql.raw(`CREATE TEMP TRIGGER reject_sync_completion
        BEFORE UPDATE OF status ON sync_outbox
        WHEN NEW.id = '${queued.id}' AND NEW.status = 'synced'
        BEGIN SELECT RAISE(ABORT, 'forced sync completion failure'); END`)
      );

      try {
        const caller = appRouter.createCaller(userCtx());
        await expect(caller.sync.push({ limit: 50 })).rejects.toThrow();
        const product = await db.select().from(products).where(eq(products.id, productId)).get();
        const row = await db.select().from(syncOutbox).where(eq(syncOutbox.id, queued.id)).get();
        expect(product).toMatchObject({ syncStatus: 'pending', syncVersion: 0 });
        expect(row?.status).toBe('queued');
      } finally {
        db.run(sql.raw('DROP TRIGGER reject_sync_completion'));
      }
    });

    it('rolls back a new conflict when marking the outbox failure is rejected', async () => {
      const db = getDatabase();
      const entityId = nanoid();
      const queued = await enqueueSync(
        { db, tenantId: testTenantId },
        { entityType: 'products', entityId, operation: 'update', data: { id: entityId } }
      );
      const before = db.select().from(syncOutbox).where(eq(syncOutbox.id, queued.id)).get();
      db.run(
        sql.raw(`CREATE TEMP TRIGGER reject_sync_failure
        BEFORE UPDATE OF status ON sync_outbox
        WHEN NEW.id = '${queued.id}' AND NEW.status = 'retrying'
        BEGIN SELECT RAISE(ABORT, 'forced sync failure write'); END`)
      );
      try {
        await expect(appRouter.createCaller(userCtx()).sync.push({ limit: 50 })).rejects.toThrow();
        expect(db.select().from(syncOutbox).where(eq(syncOutbox.id, queued.id)).get()).toEqual(
          before
        );
        expect(
          db
            .select()
            .from(syncConflicts)
            .where(
              and(eq(syncConflicts.tenantId, testTenantId), eq(syncConflicts.entityId, entityId))
            )
            .all()
        ).toEqual([]);
        expect(
          db
            .select()
            .from(appSettings)
            .where(eq(appSettings.key, getLastSyncKey(testTenantId)))
            .get()
        ).toBeUndefined();
      } finally {
        db.run(sql.raw('DROP TRIGGER reject_sync_failure'));
      }
    });

    it.each(['INSERT', 'UPDATE'] as const)(
      'rolls back completion when last sync %s fails',
      async action => {
        const db = getDatabase();
        const productId = nanoid();
        const now = new Date().toISOString();
        await db.insert(products).values({
          id: productId,
          tenantId: testTenantId,
          name: 'Last Sync Rollback Product',
          sku: `sync-${nanoid(6)}`,
          syncStatus: 'pending',
          syncVersion: 0,
          createdAt: now,
          updatedAt: now,
        });
        const queued = await enqueueSync(
          { db, tenantId: testTenantId },
          {
            entityType: 'products',
            entityId: productId,
            operation: 'update',
            data: { id: productId },
          }
        );
        const key = getLastSyncKey(testTenantId);
        if (action === 'UPDATE') {
          db.insert(appSettings)
            .values({ key, value: '2020-01-01T00:00:00.000Z', updatedAt: now })
            .run();
        }
        const before = await db.select().from(appSettings).where(eq(appSettings.key, key)).get();
        db.run(
          sql.raw(`CREATE TEMP TRIGGER reject_last_sync_update
        BEFORE ${action} ON app_settings
        WHEN NEW.key = '${key}'
        BEGIN SELECT RAISE(ABORT, 'forced last sync failure'); END`)
        );

        try {
          await expect(
            appRouter.createCaller(userCtx()).sync.push({ limit: 50 })
          ).rejects.toThrow();
          const product = await db.select().from(products).where(eq(products.id, productId)).get();
          const row = await db.select().from(syncOutbox).where(eq(syncOutbox.id, queued.id)).get();
          const after = await db.select().from(appSettings).where(eq(appSettings.key, key)).get();
          expect(product).toMatchObject({ syncStatus: 'pending', syncVersion: 0 });
          expect(row?.status).toBe('queued');
          expect(after).toEqual(before);
        } finally {
          db.run(sql.raw('DROP TRIGGER reject_last_sync_update'));
        }
      }
    );

    it('ignores another tenant conflict and leaves its outbox and marker unchanged', async () => {
      const db = getDatabase();
      const foreignTenantId = nanoid();
      const entityId = nanoid();
      const now = new Date().toISOString();
      await db.insert(tenants).values({
        id: foreignTenantId,
        name: 'Foreign sync tenant',
        slug: `foreign-${nanoid()}`,
        settings: {},
        createdAt: now,
        updatedAt: now,
      });
      await insertSyncProduct(entityId);
      const queued = await enqueueSync(
        { db, tenantId: testTenantId },
        {
          entityType: 'products',
          entityId,
          operation: 'update',
          data: { id: entityId },
        }
      );
      const foreign = await enqueueSync(
        { db, tenantId: foreignTenantId },
        {
          entityType: 'products',
          entityId,
          operation: 'update',
          data: { id: entityId },
        }
      );
      const conflictId = nanoid();
      await db.insert(syncConflicts).values({
        id: conflictId,
        tenantId: foreignTenantId,
        entityType: 'products',
        entityId,
        localData: { id: entityId },
        remoteData: {},
        status: 'pending',
        createdAt: now,
      });
      const before = db.select().from(syncOutbox).where(eq(syncOutbox.id, foreign.id)).get();
      try {
        const result = await appRouter.createCaller(userCtx()).sync.push({ limit: 50 });
        expect(result.processedIds).toEqual([queued.id]);
        expect(result.conflictIds).toEqual([]);
        expect(result.synced).toBe(1);
        expect(db.select().from(syncOutbox).where(eq(syncOutbox.id, foreign.id)).get()).toEqual(
          before
        );
        expect(
          db.select().from(syncConflicts).where(eq(syncConflicts.id, conflictId)).get()
        ).toMatchObject({ status: 'pending' });
        expect(
          db
            .select()
            .from(appSettings)
            .where(eq(appSettings.key, getLastSyncKey(foreignTenantId)))
            .get()
        ).toBeUndefined();
      } finally {
        db.delete(syncConflicts).where(eq(syncConflicts.tenantId, foreignTenantId)).run();
        db.delete(syncOutbox).where(eq(syncOutbox.tenantId, foreignTenantId)).run();
        db.delete(appSettings)
          .where(eq(appSettings.key, getLastSyncKey(foreignTenantId)))
          .run();
        db.delete(tenants).where(eq(tenants.id, foreignTenantId)).run();
      }
    });

    it('does not regress the last-sync marker when an older timestamp commits later', async () => {
      const db = getDatabase();
      const newer = '2099-01-02T00:00:00.000Z';
      const older = '2099-01-01T00:00:00.000Z';
      db.transaction(() => saveLastSyncAt(db, testTenantId, newer), { behavior: 'immediate' });
      db.transaction(() => saveLastSyncAt(db, testTenantId, older), { behavior: 'immediate' });
      const row = await db
        .select({ value: appSettings.value })
        .from(appSettings)
        .where(eq(appSettings.key, getLastSyncKey(testTenantId)))
        .get();
      expect(row?.value).toBe(newer);
    });

    it('processes queued product changes and records the last successful sync', async () => {
      const caller = appRouter.createCaller(userCtx());
      const db = getDatabase();
      const productId = nanoid();
      const now = new Date().toISOString();

      await db.insert(products).values({
        id: productId,
        tenantId: testTenantId,
        name: 'Queued Sync Product',
        sku: `sync-${nanoid(6)}`,
        syncStatus: 'pending',
        syncVersion: 0,
        createdAt: now,
        updatedAt: now,
      });

      const queued = await caller.sync.addToQueue({
        entityType: 'products',
        entityId: productId,
        operation: 'update',
        data: { name: 'Queued Sync Product' },
      });

      const result = await caller.sync.push({ limit: 50 });

      expect(result.success).toBe(true);
      expect(result.processedIds).toContain(queued.id);
      expect(result.synced).toBeGreaterThanOrEqual(1);
      expect(result.lastSyncAt).not.toBeNull();

      // : sync_outbox preserves rows post-push as `status='synced'`
      // (mirrors `fiscal_outbox.status='accepted'` and
      // `hardware_outbox.status='printed'`). The legacy `sync_queue`
      // shape deleted the row outright; the new shape keeps it for
      // audit / Operations Center visibility.
      const queueRow = await db
        .select()
        .from(syncOutbox)
        .where(and(eq(syncOutbox.id, queued.id), eq(syncOutbox.tenantId, testTenantId)))
        .get();
      expect(queueRow?.status).toBe('synced');

      const product = await db
        .select()
        .from(products)
        .where(and(eq(products.id, productId), eq(products.tenantId, testTenantId)))
        .get();
      expect(product?.syncStatus).toBe('synced');
      expect(product?.syncVersion).toBeGreaterThan(0);

      const status = await caller.sync.status();
      expect(status.lastSyncAt).not.toBeNull();
    });

    it('processes queued inventory lot receipts instead of marking them unsupported', async () => {
      const caller = appRouter.createCaller(userCtx());
      const db = getDatabase();
      const now = new Date().toISOString();
      const companyId = nanoid();
      const siteId = nanoid();
      const productId = nanoid();
      const lotId = nanoid();

      await db.insert(companies).values({
        id: companyId,
        tenantId: testTenantId,
        name: `Sync Lot Company ${companyId.slice(0, 6)}`,
        createdAt: now,
        updatedAt: now,
      });
      await db.insert(sites).values({
        id: siteId,
        tenantId: testTenantId,
        companyId,
        name: `Sync Lot Site ${siteId.slice(0, 6)}`,
        createdAt: now,
        updatedAt: now,
      });
      await db.insert(products).values({
        id: productId,
        tenantId: testTenantId,
        name: 'Queued Sync Lot Product',
        sku: `sync-lot-${nanoid(6)}`,
        tracksLots: true,
        createdAt: now,
        updatedAt: now,
      });
      await db.insert(inventoryLots).values({
        id: lotId,
        tenantId: testTenantId,
        siteId,
        productId,
        lotNumber: 'SYNC-LOT-001',
        onHand: 12,
        unitCost: 4.5,
        syncStatus: 'pending',
        syncVersion: 0,
        receivedAt: now,
        createdAt: now,
        updatedAt: now,
      });

      const queued = await enqueueSync(
        { db, tenantId: testTenantId },
        {
          entityType: 'inventory_lots',
          entityId: lotId,
          operation: 'update',
          data: { id: lotId, onHand: 12 },
        }
      );

      const result = await caller.sync.push({ limit: 50 });

      expect(result.success).toBe(true);
      expect(result.processedIds).toContain(queued.id);
      expect(result.errors).not.toContain(`Unsupported sync entity type: inventory_lots`);

      const queueRow = await db
        .select()
        .from(syncOutbox)
        .where(and(eq(syncOutbox.id, queued.id), eq(syncOutbox.tenantId, testTenantId)))
        .get();
      expect(queueRow?.status).toBe('synced');

      const lot = await db
        .select()
        .from(inventoryLots)
        .where(and(eq(inventoryLots.id, lotId), eq(inventoryLots.tenantId, testTenantId)))
        .get();
      expect(lot?.syncStatus).toBe('synced');
      expect(lot?.syncVersion).toBeGreaterThan(0);
    });

    it('creates a conflict when a queued entity no longer exists locally', async () => {
      const caller = appRouter.createCaller(userCtx());
      const missingEntityId = nanoid();

      const queued = await enqueueSync(
        { db: getDatabase(), tenantId: testTenantId },
        {
          entityType: 'products',
          entityId: missingEntityId,
          operation: 'update',
          data: { id: missingEntityId, name: 'Missing Product' },
        }
      );

      const result = await caller.sync.push({ limit: 50 });

      expect(result.success).toBe(false);
      expect(result.synced).toBe(0);
      expect(result.conflictIds.length).toBe(1);
      expect(result.errors[0]).toContain(missingEntityId);

      const db = getDatabase();
      const queueRow = await db
        .select()
        .from(syncOutbox)
        .where(and(eq(syncOutbox.id, queued.id), eq(syncOutbox.tenantId, testTenantId)))
        .get();
      expect(queueRow?.attempts).toBe(1);
      // : lastError is now a JSON `NormalizedOutboxError` object
      // ({ kind, message }) instead of a plain string.
      const lastErrorJson = queueRow?.lastError as { kind?: string; message?: string } | null;
      expect(lastErrorJson?.message).toContain('local record is missing');

      const conflictRow = await db
        .select()
        .from(syncConflicts)
        .where(
          and(
            eq(syncConflicts.id, result.conflictIds[0]!),
            eq(syncConflicts.tenantId, testTenantId)
          )
        )
        .get();
      expect(conflictRow?.status).toBe('pending');
      expect(conflictRow?.entityId).toBe(missingEntityId);

      const status = await caller.sync.status();
      expect(status.pendingCount).toBe(1);
      expect(status.retryingCount).toBe(1);
      expect(status.failedCount).toBe(1);
      expect(status.oldestPendingAt).not.toBeNull();

      const snapshot = await caller.sync.pull({ queueLimit: 10, conflictLimit: 10 });
      expect(snapshot.conflicts[0]?.localRecordExists).toBe(false);

      const listedConflicts = await caller.sync.listConflicts({ limit: 10 });
      expect(listedConflicts.items[0]?.localRecordExists).toBe(false);
    });
  });

  describe('sync.pull', () => {
    it('returns a sync snapshot with queue items, conflicts, and retry observability', async () => {
      const caller = appRouter.createCaller(userCtx());
      const db = getDatabase();
      const now = new Date().toISOString();

      await db.insert(syncOutbox).values({
        id: nanoid(),
        tenantId: testTenantId,
        status: 'retrying',
        entityType: 'products',
        entityId: nanoid(),
        operation: 'update',
        conflictPolicy: 'auto_lww',
        payload: { name: 'Retrying product' },
        payloadVersion: 1,
        attempts: 2,
        lastError: { kind: 'UNKNOWN', message: 'Remote endpoint unavailable' },
        createdAt: now,
        updatedAt: now,
      });

      const result = await caller.sync.pull({ queueLimit: 10, conflictLimit: 10 });

      expect(Array.isArray(result.queue)).toBe(true);
      expect(Array.isArray(result.conflicts)).toBe(true);
      expect(result.pendingCount).toBeGreaterThanOrEqual(0);
      expect(result.retryingCount).toBeGreaterThanOrEqual(1);
      expect(result.failedCount).toBeGreaterThanOrEqual(1);
      expect(result.conflictsCount).toBeGreaterThanOrEqual(0);
      expect(result.oldestPendingAt).not.toBeNull();
      expect(result.queue[0]?.attempts).toBeGreaterThanOrEqual(0);
    });
  });

  describe('sync.resolve', () => {
    it('resolves a conflict in favor of local data and requeues an update', async () => {
      const caller = appRouter.createCaller(userCtx());
      const db = getDatabase();
      const entityId = nanoid();
      const conflictId = nanoid();
      const now = new Date().toISOString();
      await insertSyncProduct(entityId, 'Keep Local');

      await db.insert(syncConflicts).values({
        id: conflictId,
        tenantId: testTenantId,
        entityType: 'products',
        entityId,
        localData: { id: entityId, name: 'Keep Local' },
        remoteData: { id: entityId, name: 'Remote Value' },
        status: 'pending',
        createdAt: now,
      });

      await db.insert(syncOutbox).values({
        id: nanoid(),
        tenantId: testTenantId,
        status: 'queued',
        entityType: 'products',
        entityId,
        operation: 'update',
        conflictPolicy: 'auto_lww',
        payload: { id: entityId, name: 'Outdated Local Value' },
        payloadVersion: 1,
        attempts: 0,
        createdAt: now,
        updatedAt: now,
      });

      const result = await caller.sync.resolve({
        id: conflictId,
        resolution: 'local_wins',
      });

      expect(result.success).toBe(true);
      expect(result.resolution).toBe('local_wins');

      const conflict = await db
        .select()
        .from(syncConflicts)
        .where(and(eq(syncConflicts.id, conflictId), eq(syncConflicts.tenantId, testTenantId)))
        .get();
      expect(conflict?.status).toBe('resolved');
      expect(conflict?.resolution).toBe('local_wins');
      expect(conflict?.resolvedAt).not.toBeNull();

      const queuedItems = await db
        .select()
        .from(syncOutbox)
        .where(
          and(
            eq(syncOutbox.tenantId, testTenantId),
            eq(syncOutbox.entityType, 'products'),
            eq(syncOutbox.entityId, entityId)
          )
        )
        .all();
      expect(queuedItems).toHaveLength(1);
      expect(queuedItems[0]?.operation).toBe('update');
      expect(queuedItems[0]?.payload).toEqual({ id: entityId, name: 'Keep Local' });
    });

    it('resolves a conflict with merged data and requeues the merged payload', async () => {
      const caller = appRouter.createCaller(userCtx());
      const db = getDatabase();
      const entityId = nanoid();
      const conflictId = nanoid();
      const now = new Date().toISOString();
      await insertSyncProduct(entityId, 'Local Name');

      await db.insert(syncConflicts).values({
        id: conflictId,
        tenantId: testTenantId,
        entityType: 'products',
        entityId,
        localData: { id: entityId, name: 'Local Name', price: 10 },
        remoteData: { id: entityId, name: 'Remote Name', price: 5 },
        status: 'pending',
        createdAt: now,
      });

      const result = await caller.sync.resolve({
        id: conflictId,
        resolution: 'merged',
        mergedData: { id: entityId, name: 'Merged Name', price: 10 },
      });

      expect(result.success).toBe(true);
      expect(result.resolution).toBe('merged');

      const conflict = await db
        .select()
        .from(syncConflicts)
        .where(and(eq(syncConflicts.id, conflictId), eq(syncConflicts.tenantId, testTenantId)))
        .get();
      expect(conflict?.status).toBe('resolved');
      expect(conflict?.resolution).toBe('merged');

      const queuedItems = await db
        .select()
        .from(syncOutbox)
        .where(
          and(
            eq(syncOutbox.tenantId, testTenantId),
            eq(syncOutbox.entityType, 'products'),
            eq(syncOutbox.entityId, entityId)
          )
        )
        .all();
      expect(queuedItems).toHaveLength(1);
      expect(queuedItems[0]?.operation).toBe('update');
      expect(queuedItems[0]?.payload).toEqual({
        id: entityId,
        name: 'Merged Name',
        price: 10,
      });
    });

    it('rejects local or merged resolutions when the local record is missing', async () => {
      const caller = appRouter.createCaller(userCtx());
      const db = getDatabase();
      const entityId = nanoid();
      const conflictId = nanoid();
      const now = new Date().toISOString();

      await db.insert(syncConflicts).values({
        id: conflictId,
        tenantId: testTenantId,
        entityType: 'products',
        entityId,
        localData: { id: entityId, name: 'Deleted locally' },
        remoteData: {},
        status: 'pending',
        createdAt: now,
      });

      await db.insert(syncOutbox).values({
        id: nanoid(),
        tenantId: testTenantId,
        status: 'retrying',
        entityType: 'products',
        entityId,
        operation: 'update',
        conflictPolicy: 'auto_lww',
        payload: { id: entityId, name: 'Deleted locally' },
        payloadVersion: 1,
        attempts: 1,
        createdAt: now,
        updatedAt: now,
      });

      for (const resolution of ['local_wins', 'merged'] as const) {
        try {
          await caller.sync.resolve({
            id: conflictId,
            resolution,
            ...(resolution === 'merged' ? { mergedData: { id: entityId, name: 'Merged' } } : {}),
          });
          expect.unreachable(`Should have rejected ${resolution}`);
        } catch (err) {
          expect(err).toBeInstanceOf(TRPCError);
          expect((err as TRPCError).code).toBe('BAD_REQUEST');
          // close-out — assert the stable errorCode the web layer
          // resolves to a localized string. The English message is a
          // developer-facing fallback that may change without notice.
          const cause = (err as TRPCError).cause as { errorCode?: string } | undefined;
          expect(cause?.errorCode).toBe('SYNC_LOCAL_RECORD_MISSING');
        }
      }

      const conflict = await db
        .select()
        .from(syncConflicts)
        .where(and(eq(syncConflicts.id, conflictId), eq(syncConflicts.tenantId, testTenantId)))
        .get();
      expect(conflict?.status).toBe('pending');

      const queuedItems = await db
        .select()
        .from(syncOutbox)
        .where(
          and(
            eq(syncOutbox.tenantId, testTenantId),
            eq(syncOutbox.entityType, 'products'),
            eq(syncOutbox.entityId, entityId)
          )
        )
        .all();
      expect(queuedItems).toHaveLength(1);
    });

    it('accepts remote data to clear a missing-local conflict and stale queue item', async () => {
      const caller = appRouter.createCaller(userCtx());
      const db = getDatabase();
      const entityId = nanoid();
      const conflictId = nanoid();
      const now = new Date().toISOString();

      await db.insert(syncConflicts).values({
        id: conflictId,
        tenantId: testTenantId,
        entityType: 'products',
        entityId,
        localData: { id: entityId, name: 'Deleted locally' },
        remoteData: {},
        status: 'pending',
        createdAt: now,
      });

      await db.insert(syncOutbox).values({
        id: nanoid(),
        tenantId: testTenantId,
        status: 'retrying',
        entityType: 'products',
        entityId,
        operation: 'update',
        conflictPolicy: 'auto_lww',
        payload: { id: entityId, name: 'Deleted locally' },
        payloadVersion: 1,
        attempts: 1,
        createdAt: now,
        updatedAt: now,
      });

      const result = await caller.sync.resolve({
        id: conflictId,
        resolution: 'remote_wins',
      });

      expect(result.success).toBe(true);
      expect(result.resolution).toBe('remote_wins');
      expect(result.pendingCount).toBe(0);
      expect(result.conflictsCount).toBe(0);

      const queuedItems = await db
        .select()
        .from(syncOutbox)
        .where(
          and(
            eq(syncOutbox.tenantId, testTenantId),
            eq(syncOutbox.entityType, 'products'),
            eq(syncOutbox.entityId, entityId)
          )
        )
        .all();
      expect(queuedItems).toHaveLength(0);
    });

    it.each([
      'inventory_movements',
      'inventory_balances',
      'inventory_lots',
      'product_serials',
      'sale_item_serials',
      'purchases',
    ] as const)(
      'rejects independent %s remote/merged values and preserves pending evidence',
      async entityType => {
        const db = getDatabase();
        const caller = appRouter.createCaller(userCtx());
        for (const resolution of ['remote_wins', 'merged'] as const) {
          const id = nanoid();
          const entityId = nanoid();
          await db.insert(syncConflicts).values({
            id,
            tenantId: testTenantId,
            entityType,
            entityId,
            localData: { id: entityId, quantity: 3.001 },
            remoteData: { quantity: 1, carryingValueCents: 0 },
            status: 'pending',
          });
          const before = await db
            .select()
            .from(syncConflicts)
            .where(eq(syncConflicts.id, id))
            .get();
          await expect(
            caller.sync.resolve({
              id,
              resolution,
              ...(resolution === 'merged'
                ? { mergedData: { quantity: 1, carryingValueCents: 0 } }
                : {}),
            })
          ).rejects.toMatchObject({ cause: { errorCode: 'SYNC_REMOTE_APPLY_BLOCKED' } });
          expect(
            await db.select().from(syncConflicts).where(eq(syncConflicts.id, id)).get()
          ).toEqual(before);
        }
      }
    );

    it.each([
      'stock',
      'initialCost',
      'cost',
      'inventoryValueCents',
      'cogsValueCents',
      'valuationQuantity',
      'valuationVersion',
      'tracksLots',
      'tracksSerials',
      'unitAssignments',
      'carrying_value_cents',
    ])('rejects unverified product %s in merged and manual queue recovery', async field => {
      const db = getDatabase();
      const caller = appRouter.createCaller(userCtx());
      const entityId = nanoid();
      await insertSyncProduct(entityId, 'Exact local inventory');
      const id = nanoid();
      await db.insert(syncConflicts).values({
        id,
        tenantId: testTenantId,
        entityType: 'products',
        entityId,
        localData: { id: entityId, name: 'Original' },
        remoteData: { [field]: 0 },
        status: 'pending',
      });
      const productBefore = await db.select().from(products).where(eq(products.id, entityId)).get();
      const conflictBefore = await db
        .select()
        .from(syncConflicts)
        .where(eq(syncConflicts.id, id))
        .get();
      for (const resolution of ['remote_wins', 'merged'] as const) {
        await expect(
          caller.sync.resolve({
            id,
            resolution,
            ...(resolution === 'merged'
              ? { mergedData: { id: entityId, name: 'Forged', [field]: 0 } }
              : {}),
          })
        ).rejects.toMatchObject({ cause: { errorCode: 'SYNC_REMOTE_APPLY_BLOCKED' } });
      }
      await expect(
        caller.sync.addToQueue({
          entityType: 'products',
          entityId,
          operation: 'update',
          data: { id: entityId, [field]: 0 },
        })
      ).rejects.toMatchObject({ cause: { errorCode: 'SYNC_REMOTE_APPLY_BLOCKED' } });
      expect(await db.select().from(products).where(eq(products.id, entityId)).get()).toEqual(
        productBefore
      );
      expect(await db.select().from(syncConflicts).where(eq(syncConflicts.id, id)).get()).toEqual(
        conflictBefore
      );
      expect(
        await db.select().from(syncOutbox).where(eq(syncOutbox.entityId, entityId)).all()
      ).toHaveLength(0);
    });

    it('preserves original value-bearing intent even if a conflict contains only metadata', async () => {
      const db = getDatabase();
      const entityId = nanoid();
      await insertSyncProduct(entityId);
      const id = nanoid();
      await db.insert(syncConflicts).values({
        id,
        tenantId: testTenantId,
        entityType: 'products',
        entityId,
        localData: { name: 'Old name' },
        remoteData: { name: 'Remote name' },
        status: 'pending',
      });
      await enqueueSync(
        { db, tenantId: testTenantId },
        {
          entityType: 'products',
          entityId,
          operation: 'update',
          data: { id: entityId, stock: 3.001, inventoryValueCents: 100 },
        }
      );
      const before = await db
        .select()
        .from(syncOutbox)
        .where(eq(syncOutbox.entityId, entityId))
        .all();
      await expect(
        appRouter.createCaller(userCtx()).sync.removeFromQueue({ id: before[0]!.id })
      ).rejects.toMatchObject({ cause: { errorCode: 'SYNC_REMOTE_APPLY_BLOCKED' } });
      for (const read of [
        appRouter.createCaller(userCtx()).sync.pull({}),
        appRouter.createCaller(userCtx()).sync.listConflicts({}),
      ]) {
        const snapshot = await read;
        const rows = 'conflicts' in snapshot ? snapshot.conflicts : snapshot.items;
        expect(rows.find(row => row.id === id)).toMatchObject({
          resolutionAvailability: { local: false, remote: false, merged: false },
        });
      }
      for (const resolution of ['local_wins', 'remote_wins', 'merged'] as const) {
        await expect(
          appRouter.createCaller(userCtx()).sync.resolve({
            id,
            resolution,
            ...(resolution === 'merged' ? { mergedData: { name: 'Merged' } } : {}),
          })
        ).rejects.toMatchObject({ cause: { errorCode: 'SYNC_REMOTE_APPLY_BLOCKED' } });
      }
      expect(
        await db.select().from(syncOutbox).where(eq(syncOutbox.entityId, entityId)).all()
      ).toEqual(before);
      expect(
        await db.select().from(syncConflicts).where(eq(syncConflicts.id, id)).get()
      ).toMatchObject({ status: 'pending' });
    });

    it('rolls back metadata conflict resolution and queue replacement on a late enqueue failure', async () => {
      const db = getDatabase();
      const entityId = nanoid();
      await insertSyncProduct(entityId);
      const id = nanoid();
      await db.insert(syncConflicts).values({
        id,
        tenantId: testTenantId,
        entityType: 'products',
        entityId,
        localData: { id: entityId, name: 'Keep' },
        remoteData: { name: 'Remote' },
        status: 'pending',
      });
      await enqueueSync(
        { db, tenantId: testTenantId },
        {
          entityType: 'products',
          entityId,
          operation: 'update',
          data: { id: entityId, name: 'Original queued name' },
        }
      );
      const before = await db
        .select()
        .from(syncOutbox)
        .where(eq(syncOutbox.entityId, entityId))
        .all();
      const sqlite = (db as unknown as { $client: { exec: (sql: string) => void } }).$client;
      sqlite.exec(
        `CREATE TEMP TRIGGER fail_sync_value_recovery BEFORE INSERT ON sync_outbox WHEN NEW.entity_id = '${entityId}' BEGIN SELECT RAISE(ABORT, 'forced sync recovery failure'); END;`
      );
      try {
        await expect(
          __withExpectedTestLogs(
            [
              { level: 'error', module: 'trpc-tracing', message: 'trpc procedure error' },
              { level: 'error', module: 'observability', message: 'captured exception' },
            ],
            () => appRouter.createCaller(userCtx()).sync.resolve({ id, resolution: 'local_wins' })
          )
        ).rejects.toThrow(/forced sync recovery failure/);
      } finally {
        sqlite.exec('DROP TRIGGER fail_sync_value_recovery');
      }
      expect(
        await db.select().from(syncOutbox).where(eq(syncOutbox.entityId, entityId)).all()
      ).toEqual(before);
      expect(
        await db.select().from(syncConflicts).where(eq(syncConflicts.id, id)).get()
      ).toMatchObject({ status: 'pending' });
      const outcomes = await Promise.allSettled(
        [0, 1].map(() =>
          appRouter.createCaller(userCtx()).sync.resolve({ id, resolution: 'local_wins' })
        )
      );
      expect(outcomes.filter(r => r.status === 'fulfilled')).toHaveLength(1);
      expect(outcomes.filter(r => r.status === 'rejected')).toHaveLength(1);
      expect(
        await db.select().from(syncOutbox).where(eq(syncOutbox.entityId, entityId)).all()
      ).toHaveLength(1);
    });

    it.each(['localData', 'remoteData'] as const)(
      'reports and enforces identity mismatch in %s consistently',
      async source => {
        const db = getDatabase();
        const entityId = nanoid();
        await insertSyncProduct(entityId);
        const id = nanoid();
        await db.insert(syncConflicts).values({
          id,
          tenantId: testTenantId,
          entityType: 'products',
          entityId,
          localData: { id: entityId, name: 'Local' },
          remoteData: { id: entityId, name: 'Remote' },
          [source]: { id: nanoid(), name: 'Wrong identity' },
          status: 'pending',
        });
        const snapshot = await appRouter.createCaller(userCtx()).sync.pull({});
        expect(snapshot.conflicts.find(row => row.id === id)?.resolutionAvailability).toEqual({
          local: source !== 'localData',
          remote: false,
          merged: false,
        });
        await expect(
          appRouter.createCaller(userCtx()).sync.resolve({ id, resolution: 'remote_wins' })
        ).rejects.toMatchObject({ cause: { errorCode: 'SYNC_REMOTE_APPLY_BLOCKED' } });
      }
    );

    it('blocks remote or merged apply for audit and normalized transformation aggregates', async () => {
      const caller = appRouter.createCaller(userCtx());
      const db = getDatabase();
      const now = new Date().toISOString();

      for (const entityType of [
        'audit_logs',
        'inventory_transformations',
        'inventory_transformation_recipes',
        'transfer_orders',
      ]) {
        for (const resolution of ['remote_wins', 'merged'] as const) {
          const conflictId = nanoid();
          await db.insert(syncConflicts).values({
            id: conflictId,
            tenantId: testTenantId,
            entityType,
            entityId: nanoid(),
            localData: {},
            remoteData: { untrusted: true },
            status: 'pending',
            createdAt: now,
          });

          await expect(
            caller.sync.resolve({
              id: conflictId,
              resolution,
              ...(resolution === 'merged' ? { mergedData: { merged: true } } : {}),
            })
          ).rejects.toMatchObject({
            code: 'BAD_REQUEST',
            cause: { errorCode: 'SYNC_REMOTE_APPLY_BLOCKED' },
          });
          const conflict = await db
            .select({ status: syncConflicts.status })
            .from(syncConflicts)
            .where(eq(syncConflicts.id, conflictId))
            .get();
          expect(conflict?.status).toBe('pending');
        }
      }
    });

    it('rejects local_wins with SYNC_LOCAL_RECORD_MISSING without partially resolving the conflict when the local record is missing', async () => {
      // close-out — verifies both the new errorCode shape AND
      // the no-partial-write semantics. The findEntity guard now runs
      // INSIDE the transaction before any write, so a throw from there
      // must leave the row `pending` and the queue untouched.
      const caller = appRouter.createCaller(userCtx());
      const db = getDatabase();
      const entityId = nanoid();
      const conflictId = nanoid();
      const queueItemId = nanoid();
      const now = new Date().toISOString();

      await db.insert(syncConflicts).values({
        id: conflictId,
        tenantId: testTenantId,
        entityType: 'products',
        entityId,
        localData: { id: entityId, name: 'Deleted locally' },
        remoteData: { id: entityId, name: 'Remote version' },
        status: 'pending',
        createdAt: now,
      });

      await db.insert(syncOutbox).values({
        id: queueItemId,
        tenantId: testTenantId,
        status: 'retrying',
        entityType: 'products',
        entityId,
        operation: 'update',
        conflictPolicy: 'auto_lww',
        payload: { id: entityId, name: 'Deleted locally' },
        payloadVersion: 1,
        attempts: 1,
        createdAt: now,
        updatedAt: now,
      });

      // Intentionally do NOT insert a `products` row — findEntity will
      // return undefined and the inner guard must throw before writes.
      let caught: unknown;
      try {
        await caller.sync.resolve({
          id: conflictId,
          resolution: 'local_wins',
        });
      } catch (error) {
        caught = error;
      }

      expect(caught).toBeInstanceOf(TRPCError);
      const cause = (caught as TRPCError).cause as { errorCode?: string } | undefined;
      expect(cause?.errorCode).toBe('SYNC_LOCAL_RECORD_MISSING');

      // No-partial-write proof: the inner throw must leave the conflict
      // unresolved.
      const conflictRow = await db
        .select()
        .from(syncConflicts)
        .where(eq(syncConflicts.id, conflictId))
        .get();
      expect(conflictRow?.status).toBe('pending');
      expect(conflictRow?.resolution).toBeNull();
      expect(conflictRow?.resolvedAt).toBeNull();

      // The queue item must also still be present.
      const queueRows = await db
        .select()
        .from(syncOutbox)
        .where(eq(syncOutbox.id, queueItemId))
        .all();
      expect(queueRows).toHaveLength(1);
    });

    it('rejects merged with SYNC_LOCAL_RECORD_MISSING when the local record is missing', async () => {
      // close-out — same path as local_wins above; merged
      // resolution also reads nextData and so triggers the inner guard.
      const caller = appRouter.createCaller(userCtx());
      const db = getDatabase();
      const entityId = nanoid();
      const conflictId = nanoid();
      const now = new Date().toISOString();

      await db.insert(syncConflicts).values({
        id: conflictId,
        tenantId: testTenantId,
        entityType: 'products',
        entityId,
        localData: { id: entityId, name: 'Deleted locally' },
        remoteData: { id: entityId, name: 'Remote version' },
        status: 'pending',
        createdAt: now,
      });

      let caught: unknown;
      try {
        await caller.sync.resolve({
          id: conflictId,
          resolution: 'merged',
          mergedData: { id: entityId, name: 'Merged version' },
        });
      } catch (error) {
        caught = error;
      }

      expect(caught).toBeInstanceOf(TRPCError);
      const cause = (caught as TRPCError).cause as { errorCode?: string } | undefined;
      expect(cause?.errorCode).toBe('SYNC_LOCAL_RECORD_MISSING');

      const conflictRow = await db
        .select()
        .from(syncConflicts)
        .where(eq(syncConflicts.id, conflictId))
        .get();
      expect(conflictRow?.status).toBe('pending');
    });
  });

  describe('sync.status after adding items', () => {
    it('pendingCount is greater than 0 and status is pending', async () => {
      const caller = appRouter.createCaller(userCtx());

      const entityId = nanoid();
      await insertSyncProduct(entityId);
      // Ensure at least one item is in the queue (previous tests may have removed some)
      await caller.sync.addToQueue({
        entityType: 'products',
        entityId,
        operation: 'update',
        data: { name: 'Status Check Product' },
      });

      const result = await caller.sync.status();

      expect(result.pendingCount).toBeGreaterThan(0);
      expect(result.status).toBe('pending');
    });
  });
});
