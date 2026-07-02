import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { createServer, type PuntovivoServer } from '../index.js';
import { getDatabase } from '../db/index.js';
import { users } from '../db/schema.js';
import { appRouter } from '../trpc/router.js';
import type { Context } from '../trpc/context.js';

let server: PuntovivoServer;
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

  it('backfills dimension + standard code + reference factor from the catalog on create', async () => {
    const caller = appRouter.createCaller(createTestContext());

    // Plain create, no dimension fields supplied → catalog fills them in.
    // ('ML' is not in the dev seed, so it does not collide with the unique
    // (tenant, abbreviation) index.)
    const ml = await caller.units.create({ name: 'Mililitro', abbreviation: 'ML', isActive: true });
    expect(ml.dimension).toBe('volume');
    expect(ml.standardCode).toBe('MLT');
    expect(ml.referenceFactor).toBe(1);

    // An unknown abbreviation stays null on every enrichment field.
    const custom = await caller.units.create({
      name: 'Widget',
      abbreviation: 'WDG',
      isActive: true,
    });
    expect(custom.dimension).toBeNull();
    expect(custom.standardCode).toBeNull();
    expect(custom.referenceFactor).toBeNull();
  });

  it('honours explicit dimension fields over the catalog and updates them', async () => {
    const caller = appRouter.createCaller(createTestContext());

    const created = await caller.units.create({
      name: 'Media libra',
      abbreviation: 'MLB',
      dimension: 'mass',
      standardCode: 'GRM',
      referenceFactor: 226.796,
      isActive: true,
    });
    expect(created.dimension).toBe('mass');
    expect(created.standardCode).toBe('GRM');
    expect(created.referenceFactor).toBeCloseTo(226.796, 3);

    const updated = await caller.units.update({
      id: created.id,
      standardCode: 'KGM',
      referenceFactor: 500,
    });
    expect(updated.standardCode).toBe('KGM');
    expect(updated.referenceFactor).toBe(500);

    // Nulling a field is allowed (operator clears a wrong mapping).
    const cleared = await caller.units.update({ id: created.id, dimension: null });
    expect(cleared.dimension).toBeNull();
  });
});
