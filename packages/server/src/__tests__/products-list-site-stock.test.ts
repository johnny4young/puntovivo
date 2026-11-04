import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { createServer, type PuntovivoServer } from '../index.js';
import { getDatabase } from '../db/index.js';
import { inventoryBalances, products, sites, tenants, users } from '../db/schema.js';
import { appRouter } from '../trpc/router.js';
import type { Context } from '../trpc/context.js';

let server: PuntovivoServer;
let tenantId: string;
let userId: string;
let primarySiteId: string;
let secondarySiteId: string;
let foreignSiteId: string;
let stockedProductId: string;
let unstockedProductId: string;
const now = () => new Date().toISOString();

function cashierCaller() {
  const context = {
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
    siteId: primarySiteId,
  } as Context;
  return appRouter.createCaller(context);
}

function insertProduct(name: string) {
  const id = nanoid();
  getDatabase()
    .insert(products)
    .values({
      id,
      tenantId,
      name,
      sku: `SKU-${id.slice(0, 6)}`,
      price: 200,
      cost: 100,
      createdAt: now(),
      updatedAt: now(),
    })
    .run();
  return id;
}

function insertBalance(siteId: string, productId: string, onHand: number) {
  getDatabase()
    .insert(inventoryBalances)
    .values({
      id: nanoid(),
      tenantId,
      siteId,
      productId,
      onHand,
      reserved: 0,
      createdAt: now(),
      updatedAt: now(),
    })
    .run();
}

describe('products.list site stock', () => {
  beforeAll(async () => {
    server = await createServer({ dbPath: ':memory:', verbose: false });
    const db = getDatabase();
    const seededUser = db.select().from(users).where(eq(users.email, 'admin@localhost')).get();
    if (!seededUser) throw new Error('Expected seeded admin user');
    tenantId = seededUser.tenantId;
    userId = seededUser.id;
    const seededSite = db.select().from(sites).where(eq(sites.tenantId, tenantId)).get();
    if (!seededSite) throw new Error('Expected seeded site');
    primarySiteId = seededSite.id;

    secondarySiteId = nanoid();
    db.insert(sites)
      .values({
        id: secondarySiteId,
        tenantId,
        companyId: seededSite.companyId,
        name: 'Second site',
        isActive: true,
        createdAt: now(),
        updatedAt: now(),
      })
      .run();

    const foreignTenantId = nanoid();
    db.insert(tenants)
      .values({
        id: foreignTenantId,
        name: 'Foreign',
        slug: foreignTenantId.toLowerCase(),
        createdAt: now(),
        updatedAt: now(),
      })
      .run();
    foreignSiteId = nanoid();
    db.insert(sites)
      .values({
        id: foreignSiteId,
        tenantId: foreignTenantId,
        companyId: seededSite.companyId,
        name: 'Foreign site',
        isActive: true,
        createdAt: now(),
        updatedAt: now(),
      })
      .run();

    stockedProductId = insertProduct('Stocked in both sites');
    insertBalance(primarySiteId, stockedProductId, 3);
    insertBalance(secondarySiteId, stockedProductId, 40);
    unstockedProductId = insertProduct('Stocked elsewhere only');
    insertBalance(secondarySiteId, unstockedProductId, 7);
  });

  afterAll(async () => {
    await server.close();
  });

  const findItem = (
    items: Array<{ id: string; stock: number; siteStock: number | null }>,
    id: string
  ) => items.find(item => item.id === id);

  it('returns the balance of the requested site next to the tenant total', async () => {
    const { items } = await cashierCaller().products.list({
      page: 1,
      perPage: 200,
      siteId: primarySiteId,
    });

    expect(findItem(items, stockedProductId)).toMatchObject({ stock: 43, siteStock: 3 });
    expect(findItem(items, unstockedProductId)).toMatchObject({ stock: 7, siteStock: 0 });
  });

  it('leaves site stock empty when no site is requested', async () => {
    const { items } = await cashierCaller().products.list({ page: 1, perPage: 200 });

    expect(findItem(items, stockedProductId)).toMatchObject({ stock: 43, siteStock: null });
  });

  it('rejects a site from another tenant', async () => {
    await expect(
      cashierCaller().products.list({ page: 1, perPage: 200, siteId: foreignSiteId })
    ).rejects.toThrow();
  });
});
