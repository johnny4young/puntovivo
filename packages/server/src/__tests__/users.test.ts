import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { TRPCError } from '@trpc/server';
import { createServer, type OpenYojobServer } from '../index.js';
import { getDatabase } from '../db/index.js';
import { users } from '../db/schema.js';
import { appRouter } from '../trpc/router.js';
import type { Context } from '../trpc/context.js';

let server: OpenYojobServer;
let tenantId: string;
let userId: string;

function createTestContext(
  role: 'admin' | 'manager' | 'cashier' = 'admin'
): Context {
  const db = getDatabase();
  const mockReq = {
    server: server.app,
    headers: {},
    user: {
      userId,
      email: `${role}@localhost`,
      role,
      tenantId,
    },
    jwtVerify: async () => {},
  } as unknown as Context['req'];

  return {
    req: mockReq,
    res: {} as Context['res'],
    db,
    user: {
      id: userId,
      email: `${role}@localhost`,
      role,
      tenantId,
    },
    tenantId,
    siteId: null,
  };
}

describe('Users tRPC Router', () => {
  beforeAll(async () => {
    server = await createServer({
      dbPath: ':memory:',
      verbose: false,
    });

    const db = getDatabase();
    const seededUser = await db.select().from(users).where(eq(users.email, 'admin@localhost')).get();
    if (!seededUser) {
      throw new Error('Expected seeded admin user');
    }

    tenantId = seededUser.tenantId;
    userId = seededUser.id;
  });

  afterAll(async () => {
    await server.close();
  });

  it('creates, lists, updates, and resets passwords for users', async () => {
    const caller = appRouter.createCaller(createTestContext());

    const created = await caller.users.create({
      email: 'cashier@example.com',
      name: 'Cashier User',
      password: 'TempPass123',
      role: 'cashier',
      isActive: true,
    });

    expect(created.email).toBe('cashier@example.com');

    const listed = await caller.users.list({ page: 1, perPage: 20, search: 'Cashier' });
    expect(listed.items.some(user => user.id === created.id)).toBe(true);

    const updated = await caller.users.update({
      id: created.id,
      name: 'Cashier Updated',
      role: 'manager',
      isActive: false,
    });

    expect(updated.name).toBe('Cashier Updated');
    expect(updated.role).toBe('manager');
    expect(updated.isActive).toBe(false);

    const reset = await caller.users.resetPassword({
      id: created.id,
      newPassword: 'NewTempPass123',
    });

    expect(reset.success).toBe(true);
  });

  it('rejects non-admin user listing', async () => {
    const caller = appRouter.createCaller(createTestContext('cashier'));

    try {
      await caller.users.list({ page: 1, perPage: 20 });
      expect.unreachable('Should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(TRPCError);
      expect((err as TRPCError).code).toBe('FORBIDDEN');
    }
  });
});
