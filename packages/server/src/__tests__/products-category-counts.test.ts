import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { createServer, type PuntovivoServer } from '../index.js';
import { getDatabase } from '../db/index.js';
import { categories, products, tenants, users } from '../db/schema.js';
import { appRouter } from '../trpc/router.js';
import type { Context } from '../trpc/context.js';

let server: PuntovivoServer;
let tenantId: string;
let userId: string;
const now = () => new Date().toISOString();

function caller() {
  return appRouter.createCaller({
    req: {
      server: server.app,
      headers: {},
      user: { userId, email: 'admin@localhost', role: 'cashier', tenantId },
      jwtVerify: async () => {},
    } as unknown as Context['req'],
    res: {} as Context['res'],
    db: getDatabase(),
    user: { id: userId, email: 'admin@localhost', role: 'cashier', tenantId },
    tenantId,
    siteId: null,
  } as Context);
}

function insertCategory(ownerTenantId: string, name: string) {
  const id = nanoid();
  getDatabase()
    .insert(categories)
    .values({ id, tenantId: ownerTenantId, name, createdAt: now(), updatedAt: now() })
    .run();
  return id;
}

function insertProduct(
  ownerTenantId: string,
  categoryId: string | null,
  overrides: { isActive?: boolean; catalogType?: 'standard' | 'variant_parent' } = {}
) {
  const id = nanoid();
  getDatabase()
    .insert(products)
    .values({
      id,
      tenantId: ownerTenantId,
      name: `Product ${id}`,
      sku: `SKU-${id}`,
      categoryId,
      price: 100,
      cost: 50,
      createdAt: now(),
      updatedAt: now(),
      ...overrides,
    })
    .run();
}

describe('products.categoryCounts', () => {
  beforeAll(async () => {
    server = await createServer({ dbPath: ':memory:', verbose: false });
    const seededUser = getDatabase()
      .select()
      .from(users)
      .where(eq(users.email, 'admin@localhost'))
      .get();
    if (!seededUser) throw new Error('Expected seeded admin user');
    tenantId = seededUser.tenantId;
    userId = seededUser.id;
  });

  afterAll(async () => {
    await server.close();
  });

  it('counts active sellable products beyond a single page, scoped to the tenant', async () => {
    const before = await caller().products.categoryCounts();

    const drinks = insertCategory(tenantId, 'Drinks');
    for (let index = 0; index < 205; index += 1) insertProduct(tenantId, drinks);
    insertProduct(tenantId, drinks, { isActive: false });
    insertProduct(tenantId, drinks, { catalogType: 'variant_parent' });
    insertProduct(tenantId, null);

    const foreignTenantId = nanoid();
    getDatabase()
      .insert(tenants)
      .values({
        id: foreignTenantId,
        name: 'Foreign',
        slug: foreignTenantId.toLowerCase(),
        createdAt: now(),
        updatedAt: now(),
      })
      .run();
    const foreign = insertCategory(foreignTenantId, 'Foreign');
    insertProduct(foreignTenantId, foreign);

    const counts = await caller().products.categoryCounts();

    expect(counts.total).toBe(before.total + 206);
    expect(counts.categories).toContainEqual({ categoryId: drinks, count: 205 });
    expect(counts.categories.map(entry => entry.categoryId)).not.toContain(foreign);
    expect(counts.categories.map(entry => entry.categoryId)).not.toContain(null);
  });
});
