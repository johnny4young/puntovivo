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

describe('Providers tRPC Router', () => {
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

  it('creates, lists, updates, searches, and deletes providers', async () => {
    const caller = appRouter.createCaller(createTestContext());
    const country = await caller.countries.create({
      code: 'CO',
      name: 'Colombia',
      isActive: true,
    });
    const department = await caller.departments.create({
      countryId: country!.id,
      code: 'ANT',
      name: 'Antioquia',
      isActive: true,
    });
    const city = await caller.cities.create({
      departmentId: department!.id,
      code: 'MED',
      name: 'Medellin',
      isActive: true,
    });

    const created = await caller.providers.create({
      name: 'Acme Supplies',
      email: 'sales@acme.test',
      phone: '555-0101',
      contactName: 'Maria Buyer',
      taxId: '900123456',
      cityId: city!.id,
      isActive: true,
    });

    expect(created.name).toBe('Acme Supplies');
    expect(created.cityName).toBe('Medellin');
    expect(created.departmentName).toBe('Antioquia');
    expect(created.countryName).toBe('Colombia');

    const listed = await caller.providers.list({ page: 1, perPage: 20 });
    expect(listed.items.some(provider => provider.id === created.id)).toBe(true);

    const updated = await caller.providers.update({
      id: created.id,
      phone: '555-0102',
      contactName: 'Maria Updated',
    });
    expect(updated.phone).toBe('555-0102');
    expect(updated.contactName).toBe('Maria Updated');

    const searched = await caller.providers.search({ q: 'Acme', limit: 10 });
    expect(searched.items.map(provider => provider.id)).toContain(created.id);

    const searchedByCity = await caller.providers.search({ q: 'Medellin', limit: 10 });
    expect(searchedByCity.items.map(provider => provider.id)).toContain(created.id);

    const searchedByCountry = await caller.providers.search({ q: 'Colombia', limit: 10 });
    expect(searchedByCountry.items.map(provider => provider.id)).toContain(created.id);

    const removed = await caller.providers.delete({ id: created.id });
    expect(removed.success).toBe(true);

    const afterDelete = await caller.providers.list({ page: 1, perPage: 20 });
    expect(afterDelete.items.some(provider => provider.id === created.id)).toBe(false);
  });

  it('rejects providers with an unknown city', async () => {
    const caller = appRouter.createCaller(createTestContext());

    await expect(
      caller.providers.create({
        name: 'Broken Geography Supplier',
        cityId: 'missing-city',
        isActive: true,
      })
    ).rejects.toMatchObject({
      code: 'BAD_REQUEST',
      message: 'Selected city was not found or is inactive',
    });
  });

  it('manages category assignments per provider and blocks invalid deletes', async () => {
    const caller = appRouter.createCaller(createTestContext());
    const provider = await caller.providers.create({
      name: 'Category Supplier',
      isActive: true,
    });
    const beverages = await caller.categories.create({
      name: 'Beverages',
      description: 'Drinks and juices',
    });
    const snacks = await caller.categories.create({
      name: 'Snacks',
      description: 'Packaged snacks',
    });

    const assigned = await caller.providers.replaceCategoryAssignments({
      providerId: provider.id,
      categoryIds: [beverages.id, snacks.id, beverages.id],
    });
    expect(assigned.categoryIds.sort()).toEqual([beverages.id, snacks.id].sort());

    const listedAssignments = await caller.providers.listCategoryAssignments({
      providerId: provider.id,
    });
    expect(listedAssignments.categoryIds.sort()).toEqual([beverages.id, snacks.id].sort());
    expect(listedAssignments.items.map(item => item.name).sort()).toEqual(['Beverages', 'Snacks']);

    const listedProviders = await caller.providers.list({ page: 1, perPage: 20 });
    const listedProvider = listedProviders.items.find(item => item.id === provider.id);
    expect(listedProvider?.assignedCategoryCount).toBe(2);

    await expect(caller.providers.delete({ id: provider.id })).rejects.toMatchObject({
      code: 'BAD_REQUEST',
      message: 'Provider has assigned categories. Remove them before deleting the provider.',
    });

    await expect(caller.categories.delete({ id: beverages.id })).rejects.toMatchObject({
      code: 'BAD_REQUEST',
      message: 'Remove provider assignments before deleting this category',
    });

    const replaced = await caller.providers.replaceCategoryAssignments({
      providerId: provider.id,
      categoryIds: [snacks.id],
    });
    expect(replaced.categoryIds).toEqual([snacks.id]);

    const afterReplace = await caller.providers.listCategoryAssignments({
      providerId: provider.id,
    });
    expect(afterReplace.categoryIds).toEqual([snacks.id]);

    await caller.providers.replaceCategoryAssignments({
      providerId: provider.id,
      categoryIds: [],
    });

    const afterClear = await caller.providers.listCategoryAssignments({
      providerId: provider.id,
    });
    expect(afterClear.categoryIds).toEqual([]);

    const removed = await caller.providers.delete({ id: provider.id });
    expect(removed.success).toBe(true);
  });
});
