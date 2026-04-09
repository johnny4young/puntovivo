import { TRPCError } from '@trpc/server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { createServer, type OpenYojobServer } from '../index.js';
import { getDatabase } from '../db/index.js';
import { companies, sites, users } from '../db/schema.js';
import { appRouter } from '../trpc/router.js';
import type { Context } from '../trpc/context.js';

let server: OpenYojobServer;
let tenantId: string;
let userId: string;
let siteId: string;

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

  return {
    req: mockReq,
    res: {} as Context['res'],
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

describe('Locations tRPC Router', () => {
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

    const company = await db.select().from(companies).where(eq(companies.tenantId, tenantId)).get();
    if (!company) {
      throw new Error('Expected seeded company');
    }

    siteId = nanoid();
    await db.insert(sites).values({
      id: siteId,
      tenantId,
      companyId: company.id,
      name: 'Assigned Site',
      address: null,
      phone: null,
      isActive: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
  });

  afterAll(async () => {
    await server.close();
  });

  it('creates, lists, updates, searches, and deletes locations', async () => {
    const caller = appRouter.createCaller(createTestContext());

    const created = await caller.locations.create({
      code: 'A-01',
      name: 'Front Shelf',
      description: 'Primary display shelf',
      isActive: true,
    });

    expect(created?.code).toBe('A-01');

    const listed = await caller.locations.list({ page: 1, perPage: 20 });
    expect(listed.items.some(location => location.id === created?.id)).toBe(true);

    const updated = await caller.locations.update({
      id: created!.id,
      name: 'Front Shelf Updated',
      description: 'Updated description',
    });
    expect(updated?.name).toBe('Front Shelf Updated');

    const searched = await caller.locations.search({ q: 'Front', limit: 10 });
    expect(searched.items.map(location => location.id)).toContain(created!.id);

    const removed = await caller.locations.delete({ id: created!.id });
    expect(removed.success).toBe(true);
  });

  it('rejects duplicate location codes within the same tenant', async () => {
    const caller = appRouter.createCaller(createTestContext());

    await caller.locations.create({
      code: 'B-02',
      name: 'Reserve Rack',
      description: null,
      isActive: true,
    });

    await expect(
      caller.locations.create({
        code: 'B-02',
        name: 'Another Rack',
        description: null,
        isActive: true,
      })
    ).rejects.toMatchObject<Partial<TRPCError>>({
      code: 'CONFLICT',
      message: 'A location with this code already exists',
    });
  });

  it('blocks deleting a location that is assigned to a site', async () => {
    const caller = appRouter.createCaller(createTestContext());

    const created = await caller.locations.create({
      code: 'C-03',
      name: 'Assigned Location',
      description: null,
      isActive: true,
    });

    await caller.sites.replaceLocationAssignments({
      siteId,
      locationIds: [created!.id],
    });

    await expect(caller.locations.delete({ id: created!.id })).rejects.toMatchObject<Partial<TRPCError>>({
      code: 'CONFLICT',
      message: 'This location is assigned to one or more sites',
    });
  });
});
