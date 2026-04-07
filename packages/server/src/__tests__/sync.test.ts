/**
 * Sync tRPC Router Tests
 *
 * Tests sync procedures via appRouter.createCaller() for type-safe testing.
 *
 * @module __tests__/sync.test
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { TRPCError } from '@trpc/server';
import { createServer, type OpenYojobServer } from '../index.js';
import { getDatabase } from '../db/index.js';
import { users, tenants } from '../db/schema.js';
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
      expect(result.externalSyncEnabled).toBe(false);
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

  describe('sync.push (Phase 2 stub)', () => {
    it('throws TRPCError with code METHOD_NOT_SUPPORTED', async () => {
      const caller = appRouter.createCaller(userCtx());

      try {
        await caller.sync.push();
        expect.unreachable('Should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(TRPCError);
        expect((err as TRPCError).code).toBe('METHOD_NOT_SUPPORTED');
      }
    });
  });

  describe('sync.pull (Phase 2 stub)', () => {
    it('throws TRPCError with code METHOD_NOT_SUPPORTED', async () => {
      const caller = appRouter.createCaller(userCtx());

      try {
        await caller.sync.pull();
        expect.unreachable('Should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(TRPCError);
        expect((err as TRPCError).code).toBe('METHOD_NOT_SUPPORTED');
      }
    });
  });

  describe('sync.resolve (Phase 2 stub)', () => {
    it('throws TRPCError with code METHOD_NOT_SUPPORTED', async () => {
      const caller = appRouter.createCaller(userCtx());

      try {
        await caller.sync.resolve();
        expect.unreachable('Should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(TRPCError);
        expect((err as TRPCError).code).toBe('METHOD_NOT_SUPPORTED');
      }
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
