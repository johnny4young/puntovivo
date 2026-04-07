import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { createServer, type OpenYojobServer } from '../index.js';
import { getDatabase } from '../db/index.js';
import { users } from '../db/schema.js';
import { appRouter } from '../trpc/router.js';
import type { Context } from '../trpc/context.js';

let server: OpenYojobServer;
let tenantId: string;
let userId: string;

function createTestContext(): Context {
  const db = getDatabase();
  const mockReq = {
    server: server.app,
    headers: {},
    user: {
      userId,
      email: 'admin@localhost',
      role: 'admin',
      tenantId,
    },
    jwtVerify: async () => {},
  } as unknown as Context['req'];

  const mockRes = {} as unknown as Context['res'];

  return {
    req: mockReq,
    res: mockRes,
    db,
    user: {
      id: userId,
      email: 'admin@localhost',
      role: 'admin',
      tenantId,
    },
    tenantId,
    siteId: null,
  };
}

describe('Units tRPC Router', () => {
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

  it('creates, lists, updates, searches, and deletes units', async () => {
    const caller = appRouter.createCaller(createTestContext());

    const created = await caller.units.create({
      name: 'Pack',
      abbreviation: 'PK',
      isActive: true,
    });

    expect(created.name).toBe('Pack');
    expect(created.abbreviation).toBe('PK');

    const listed = await caller.units.list({ page: 1, perPage: 50 });
    expect(listed.items.some(unit => unit.id === created.id)).toBe(true);

    const updated = await caller.units.update({
      id: created.id,
      name: 'Package',
      abbreviation: 'PKG',
    });
    expect(updated.name).toBe('Package');
    expect(updated.abbreviation).toBe('PKG');

    const searched = await caller.units.search({ q: 'Package', limit: 10 });
    expect(searched.items.map(unit => unit.id)).toContain(created.id);

    const removed = await caller.units.delete({ id: created.id });
    expect(removed.success).toBe(true);

    const afterDelete = await caller.units.list({ page: 1, perPage: 50 });
    expect(afterDelete.items.some(unit => unit.id === created.id)).toBe(false);
  });
});
