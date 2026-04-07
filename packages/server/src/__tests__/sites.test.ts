import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { createServer, type OpenYojobServer } from '../index.js';
import { getDatabase } from '../db/index.js';
import { companies, sites, users } from '../db/schema.js';
import { appRouter } from '../trpc/router.js';
import { createContext, type Context } from '../trpc/context.js';

let server: OpenYojobServer;
let tenantId: string;
let userId: string;
let mainSiteId: string;
let warehouseSiteId: string;

async function createTestContext(siteIdHeader?: string): Promise<Context> {
  const db = getDatabase();
  const mockReq = {
    server: server.app,
    headers: siteIdHeader ? { 'x-site-id': siteIdHeader } : {},
    user: {
      userId,
      email: 'admin@localhost',
      role: 'admin',
      tenantId,
    },
    jwtVerify: async () => {},
  } as unknown as Context['req'];

  const mockRes = {} as unknown as Context['res'];
  const ctx = await createContext({
    req: mockReq,
    res: mockRes,
  });

  return {
    ...ctx,
    db,
  };
}

describe('Sites tRPC Router', () => {
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

    userId = seededUser.id;
    tenantId = seededUser.tenantId;

    const company = await db
      .select()
      .from(companies)
      .where(eq(companies.tenantId, tenantId))
      .get();

    if (!company) {
      throw new Error('Expected seeded default company');
    }

    const mainSite = await db
      .select()
      .from(sites)
      .where(and(eq(sites.tenantId, tenantId), eq(sites.name, 'Main Site')))
      .get();

    if (!mainSite) {
      throw new Error('Expected seeded main site');
    }

    mainSiteId = mainSite.id;
    warehouseSiteId = nanoid();

    await db.insert(sites).values({
      id: warehouseSiteId,
      tenantId,
      companyId: company.id,
      name: 'Warehouse',
      address: 'Warehouse address',
      phone: '1111111111',
      isActive: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
  });

  afterAll(async () => {
    await server.close();
  });

  it('lists active tenant sites ordered by name', async () => {
    const caller = appRouter.createCaller(await createTestContext());

    const result = await caller.sites.list();

    expect(result.items.map(site => site.name)).toEqual(['Main Site', 'Warehouse']);
  });

  it('reflects the selected active site from context', async () => {
    const caller = appRouter.createCaller(await createTestContext(warehouseSiteId));

    const result = await caller.sites.list();

    expect(result.activeSiteId).toBe(warehouseSiteId);
    expect(result.items.some(site => site.id === warehouseSiteId)).toBe(true);
  });

  it('falls back to the default active site when no site is provided', async () => {
    const caller = appRouter.createCaller(await createTestContext());

    const result = await caller.sites.list();

    expect(result.activeSiteId).toBe(mainSiteId);
  });

  it('creates, updates, filters, and deletes an unreferenced site', async () => {
    const caller = appRouter.createCaller(await createTestContext());
    const db = getDatabase();
    const company = await db
      .select()
      .from(companies)
      .where(eq(companies.tenantId, tenantId))
      .get();

    if (!company) {
      throw new Error('Expected seeded company');
    }

    const created = await caller.sites.create({
      companyId: company.id,
      name: 'Back Office',
      address: 'Office block',
      phone: '2222222222',
      isActive: true,
    });

    expect(created.name).toBe('Back Office');

    const filtered = await caller.sites.list({ search: 'Back', isActive: true });
    expect(filtered.items.some(site => site.id === created.id)).toBe(true);

    const updated = await caller.sites.update({
      id: created.id,
      name: 'Back Office Updated',
      isActive: false,
    });

    expect(updated.name).toBe('Back Office Updated');
    expect(updated.isActive).toBe(false);

    const inactive = await caller.sites.list({ isActive: false });
    expect(inactive.items.some(site => site.id === created.id)).toBe(true);

    const removed = await caller.sites.delete({ id: created.id });
    expect(removed.success).toBe(true);
  });
});
