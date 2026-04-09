/**
 * Sync tRPC Router Tests
 *
 * Tests sync procedures via appRouter.createCaller() for type-safe testing.
 *
 * @module __tests__/sync.test
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { TRPCError } from '@trpc/server';
import { createServer, type OpenYojobServer } from '../index.js';
import { getDatabase } from '../db/index.js';
import { products, syncConflicts, syncQueue, tenants, users } from '../db/schema.js';
import { and, eq } from 'drizzle-orm';
import { hash } from 'argon2';
import { nanoid } from 'nanoid';
import { appRouter } from '../trpc/router.js';
import type { Context } from '../trpc/context.js';

let server: OpenYojobServer;
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
    await db.delete(syncQueue).where(eq(syncQueue.tenantId, testTenantId)).run();
  });

  afterAll(async () => {
    if (server) {
      await server.close();
    }
  });

  const userCtx = () =>
    createTestContext({
      id: testUserId,
      email: 'synctest@example.com',
      role: 'admin',
      tenantId: testTenantId,
    });

  describe('sync.status', () => {
    it('returns synced status with zero counts when queue is empty', async () => {
      const caller = appRouter.createCaller(userCtx());
      const result = await caller.sync.status();

      expect(result.pendingCount).toBe(0);
      expect(result.conflictsCount).toBe(0);
      expect(result.externalSyncEnabled).toBe(true);
      expect(result.status).toBe('synced');
    });
  });

  describe('sync.addToQueue', () => {
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

      const queueRow = await db
        .select()
        .from(syncQueue)
        .where(and(eq(syncQueue.id, queued.id), eq(syncQueue.tenantId, testTenantId)))
        .get();
      expect(queueRow).toBeUndefined();

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
        .from(syncQueue)
        .where(and(eq(syncQueue.id, queued.id), eq(syncQueue.tenantId, testTenantId)))
        .get();
      expect(queueRow?.attempts).toBe(1);
      expect(queueRow?.lastError).toContain('local record is missing');

      const conflictRow = await db
        .select()
        .from(syncConflicts)
        .where(and(eq(syncConflicts.id, result.conflictIds[0]!), eq(syncConflicts.tenantId, testTenantId)))
        .get();
      expect(conflictRow?.status).toBe('pending');
      expect(conflictRow?.entityId).toBe(missingEntityId);
    });
  });

  describe('sync.pull', () => {
    it('returns a sync snapshot with queue items and conflicts', async () => {
      const caller = appRouter.createCaller(userCtx());
      const result = await caller.sync.pull({ queueLimit: 10, conflictLimit: 10 });

      expect(Array.isArray(result.queue)).toBe(true);
      expect(Array.isArray(result.conflicts)).toBe(true);
      expect(result.pendingCount).toBeGreaterThanOrEqual(0);
      expect(result.conflictsCount).toBeGreaterThanOrEqual(0);
    });
  });

  describe('sync.resolve', () => {
    it('resolves a conflict in favor of local data and requeues an update', async () => {
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
        localData: { id: entityId, name: 'Keep Local' },
        remoteData: { id: entityId, name: 'Remote Value' },
        status: 'pending',
        createdAt: now,
      });

      await db.insert(syncQueue).values({
        id: nanoid(),
        tenantId: testTenantId,
        entityType: 'products',
        entityId,
        operation: 'update',
        data: { id: entityId, name: 'Outdated Local Value' },
        localVersion: 1,
        attempts: 0,
        createdAt: now,
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
        .from(syncQueue)
        .where(
          and(
            eq(syncQueue.tenantId, testTenantId),
            eq(syncQueue.entityType, 'products'),
            eq(syncQueue.entityId, entityId)
          )
        )
        .all();
      expect(queuedItems).toHaveLength(1);
      expect(queuedItems[0]?.operation).toBe('update');
      expect(queuedItems[0]?.data).toEqual({ id: entityId, name: 'Keep Local' });
    });

    it('resolves a conflict with merged data and requeues the merged payload', async () => {
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
        .from(syncQueue)
        .where(
          and(
            eq(syncQueue.tenantId, testTenantId),
            eq(syncQueue.entityType, 'products'),
            eq(syncQueue.entityId, entityId)
          )
        )
        .all();
      expect(queuedItems).toHaveLength(1);
      expect(queuedItems[0]?.operation).toBe('update');
      expect(queuedItems[0]?.data).toEqual({
        id: entityId,
        name: 'Merged Name',
        price: 10,
        stock: 5,
      });
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
