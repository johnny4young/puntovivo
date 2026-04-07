/**
 * Auth tRPC Router Tests
 *
 * Tests auth procedures via appRouter.createCaller() for type-safe testing.
 *
 * @module __tests__/auth.test
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { TRPCError } from '@trpc/server';
import { createServer, type OpenYojobServer } from '../index.js';
import { getDatabase } from '../db/index.js';
import { users, tenants } from '../db/schema.js';
import { hash, verify } from 'argon2';
import { nanoid } from 'nanoid';
import { eq } from 'drizzle-orm';
import { appRouter } from '../trpc/router.js';
import type { Context } from '../trpc/context.js';

let server: OpenYojobServer;
let testTenantId: string;
let testUserId: string;
const testDbPath = ':memory:';

/**
 * Build a tRPC context for use with createCaller.
 * For public procedures, pass no user.
 * For protected procedures, pass user payload.
 */
function createTestContext(userPayload?: {
  id: string;
  email: string;
  role: string;
  tenantId: string;
}): Context {
  const db = getDatabase();

  // Build a minimal mock request that has server.jwt.sign()
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

describe('Auth tRPC Router', () => {
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
      name: 'Test Tenant',
      slug: 'test-tenant-trpc',
      settings: {},
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    // Create test user
    testUserId = nanoid();
    const passwordHash = await hash('TestPassword123!');
    await db.insert(users).values({
      id: testUserId,
      tenantId: testTenantId,
      email: 'trpctest@example.com',
      passwordHash,
      name: 'tRPC Test User',
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

  describe('auth.login', () => {
    it('should login with valid credentials', async () => {
      const caller = appRouter.createCaller(createTestContext());

      const result = await caller.auth.login({
        email: 'trpctest@example.com',
        password: 'TestPassword123!',
      });

      expect(result.token).toBeDefined();
      expect(result.token).toBeTypeOf('string');
      expect(result.user.email).toBe('trpctest@example.com');
      expect(result.user.name).toBe('tRPC Test User');
      expect(result.user.role).toBe('admin');
      expect(result.tenant.id).toBe(testTenantId);
      expect(result.tenant.name).toBe('Test Tenant');
    });

    it('should reject invalid password', async () => {
      const caller = appRouter.createCaller(createTestContext());

      await expect(
        caller.auth.login({
          email: 'trpctest@example.com',
          password: 'wrongpassword',
        })
      ).rejects.toThrow(TRPCError);

      try {
        await caller.auth.login({
          email: 'trpctest@example.com',
          password: 'wrongpassword',
        });
      } catch (err) {
        expect(err).toBeInstanceOf(TRPCError);
        expect((err as TRPCError).code).toBe('UNAUTHORIZED');
        expect((err as TRPCError).message).toBe('Email or password is incorrect');
      }
    });

    it('should reject non-existent user', async () => {
      const caller = appRouter.createCaller(createTestContext());

      await expect(
        caller.auth.login({
          email: 'nonexistent@example.com',
          password: 'password',
        })
      ).rejects.toThrow(TRPCError);
    });

    it('should reject with Zod validation error for missing fields', async () => {
      const caller = appRouter.createCaller(createTestContext());

      await expect(
        caller.auth.login({
          email: '',
          password: '',
        })
      ).rejects.toThrow();
    });

    it('should reject disabled user', async () => {
      const db = getDatabase();
      const disabledUserId = nanoid();
      const passwordHash = await hash('TestPassword123!');
      await db.insert(users).values({
        id: disabledUserId,
        tenantId: testTenantId,
        email: 'disabled@example.com',
        passwordHash,
        name: 'Disabled User',
        role: 'cashier',
        isActive: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });

      const caller = appRouter.createCaller(createTestContext());

      try {
        await caller.auth.login({
          email: 'disabled@example.com',
          password: 'TestPassword123!',
        });
        expect.unreachable('Should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(TRPCError);
        expect((err as TRPCError).code).toBe('UNAUTHORIZED');
        expect((err as TRPCError).message).toContain('disabled');
      }
    });
  });

  describe('auth.logout', () => {
    it('should return success', async () => {
      const caller = appRouter.createCaller(createTestContext());
      const result = await caller.auth.logout();

      expect(result.success).toBe(true);
      expect(result.message).toBe('Logged out successfully');
    });
  });

  describe('auth.me', () => {
    it('should return current user with valid context', async () => {
      const ctx = createTestContext({
        id: testUserId,
        email: 'trpctest@example.com',
        role: 'admin',
        tenantId: testTenantId,
      });
      const caller = appRouter.createCaller(ctx);

      const result = await caller.auth.me();

      expect(result.user.email).toBe('trpctest@example.com');
      expect(result.user.name).toBe('tRPC Test User');
      expect(result.user.role).toBe('admin');
      expect(result.tenant).not.toBeNull();
      expect(result.tenant!.id).toBe(testTenantId);
    });

    it('should reject unauthenticated request', async () => {
      const caller = appRouter.createCaller(createTestContext());

      await expect(caller.auth.me()).rejects.toThrow(TRPCError);

      try {
        await caller.auth.me();
      } catch (err) {
        expect(err).toBeInstanceOf(TRPCError);
        expect((err as TRPCError).code).toBe('UNAUTHORIZED');
      }
    });
  });

  describe('auth.refresh', () => {
    it('should return a new token', async () => {
      const ctx = createTestContext({
        id: testUserId,
        email: 'trpctest@example.com',
        role: 'admin',
        tenantId: testTenantId,
      });
      const caller = appRouter.createCaller(ctx);

      const result = await caller.auth.refresh();

      expect(result.token).toBeDefined();
      expect(result.token).toBeTypeOf('string');
    });

    it('should reject unauthenticated request', async () => {
      const caller = appRouter.createCaller(createTestContext());

      await expect(caller.auth.refresh()).rejects.toThrow(TRPCError);
    });
  });

  describe('auth.changePassword', () => {
    it('should change password with correct current password', async () => {
      const ctx = createTestContext({
        id: testUserId,
        email: 'trpctest@example.com',
        role: 'admin',
        tenantId: testTenantId,
      });
      const caller = appRouter.createCaller(ctx);

      const result = await caller.auth.changePassword({
        currentPassword: 'TestPassword123!',
        newPassword: 'NewPassword456!',
      });

      expect(result.success).toBe(true);
      expect(result.message).toBe('Password changed successfully');

      // Verify new password was stored correctly
      const db = getDatabase();
      const updatedUser = await db.select().from(users).where(eq(users.id, testUserId)).get();
      expect(updatedUser).toBeDefined();
      const isNewPasswordValid = await verify(updatedUser!.passwordHash, 'NewPassword456!');
      expect(isNewPasswordValid).toBe(true);

      // Reset password for other tests
      const passwordHash = await hash('TestPassword123!');
      await db.update(users).set({ passwordHash }).where(eq(users.id, testUserId));
    });

    it('should reject incorrect current password', async () => {
      const ctx = createTestContext({
        id: testUserId,
        email: 'trpctest@example.com',
        role: 'admin',
        tenantId: testTenantId,
      });
      const caller = appRouter.createCaller(ctx);

      try {
        await caller.auth.changePassword({
          currentPassword: 'WrongPassword99!',
          newPassword: 'AnotherStrong123!',
        });
        expect.unreachable('Should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(TRPCError);
        expect((err as TRPCError).code).toBe('UNAUTHORIZED');
      }
    });

    it('should reject weak password', async () => {
      const ctx = createTestContext({
        id: testUserId,
        email: 'trpctest@example.com',
        role: 'admin',
        tenantId: testTenantId,
      });
      const caller = appRouter.createCaller(ctx);

      try {
        await caller.auth.changePassword({
          currentPassword: 'TestPassword123!',
          newPassword: 'weakpassword1',
        });
        expect.unreachable('Should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(TRPCError);
        expect((err as TRPCError).code).toBe('BAD_REQUEST');
        expect((err as TRPCError).message).toContain('security requirements');
      }
    });

    it('should reject unauthenticated request', async () => {
      const caller = appRouter.createCaller(createTestContext());

      await expect(
        caller.auth.changePassword({
          currentPassword: 'TestPassword123!',
          newPassword: 'NewPassword456!',
        })
      ).rejects.toThrow(TRPCError);
    });
  });
});
