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
import { products, syncConflicts, syncOutbox, tenants, users } from '../db/schema.js';
import { and, eq } from 'drizzle-orm';
import { hash } from 'argon2';
import { nanoid } from 'nanoid';
import { appRouter } from '../trpc/router.js';
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

  async function insertSyncProduct(entityId: string, name = 'Sync Product') {
    const now = new Date().toISOString();
    await getDatabase().insert(products).values({
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

      const result = await caller.sync.addToQueue({
        entityType: 'products',
        entityId,
        operation: 'create',
        data: { name: 'Test Product', price: 100 },
      });

      expect(result.id).toBeDefined();
      expect(result.id).toBeTypeOf('string');
      expect(result.entityType).toBe('products');
      expect(result.entityId).toBe(entityId);
      expect(result.operation).toBe('create');
      expect(result.createdAt).toBeDefined();
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

      const added = await caller.sync.addToQueue({
        entityType: 'products',
        entityId: nanoid(),
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

      // ENG-064b: sync_outbox preserves rows post-push as `status='synced'`
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

    it('creates a conflict when a queued entity no longer exists locally', async () => {
      const caller = appRouter.createCaller(userCtx());
      const missingEntityId = nanoid();

      const queued = await caller.sync.addToQueue({
        entityType: 'products',
        entityId: missingEntityId,
        operation: 'update',
        data: { id: missingEntityId, name: 'Missing Product' },
      });

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
      // ENG-064b: lastError is now a JSON `NormalizedOutboxError` object
      // ({ kind, message }) instead of a plain string.
      const lastErrorJson = queueRow?.lastError as { kind?: string; message?: string } | null;
      expect(lastErrorJson?.message).toContain('local record is missing');

      const conflictRow = await db
        .select()
        .from(syncConflicts)
        .where(and(eq(syncConflicts.id, result.conflictIds[0]!), eq(syncConflicts.tenantId, testTenantId)))
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
        remoteData: { id: entityId, name: 'Remote Name', stock: 5 },
        status: 'pending',
        createdAt: now,
      });

      const result = await caller.sync.resolve({
        id: conflictId,
        resolution: 'merged',
        mergedData: { id: entityId, name: 'Merged Name', price: 10, stock: 5 },
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
        stock: 5,
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
          // ENG-042 close-out — assert the stable errorCode the web layer
          // resolves to a localized string. The English message is a
          // developer-facing fallback that may change without notice.
          const cause = (err as TRPCError).cause as
            | { errorCode?: string }
            | undefined;
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

    it('rejects local_wins with SYNC_LOCAL_RECORD_MISSING without partially resolving the conflict when the local record is missing', async () => {
      // ENG-042 close-out — verifies both the new errorCode shape AND
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
      const cause = (caught as TRPCError).cause as
        | { errorCode?: string }
        | undefined;
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
      // ENG-042 close-out — same path as local_wins above; merged
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
      const cause = (caught as TRPCError).cause as
        | { errorCode?: string }
        | undefined;
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

      // Ensure at least one item is in the queue (previous tests may have removed some)
      await caller.sync.addToQueue({
        entityType: 'products',
        entityId: nanoid(),
        operation: 'create',
        data: { name: 'Status Check Product' },
      });

      const result = await caller.sync.status();

      expect(result.pendingCount).toBeGreaterThan(0);
      expect(result.status).toBe('pending');
    });
  });
});
