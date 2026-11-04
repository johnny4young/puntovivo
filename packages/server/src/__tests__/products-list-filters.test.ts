import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { createServer, type PuntovivoServer } from '../index.js';
import { getDatabase } from '../db/index.js';
import { inventoryBalances, products, sites, users } from '../db/schema.js';
import { appRouter } from '../trpc/router.js';
import type { Context } from '../trpc/context.js';

let server: PuntovivoServer;
let tenantId: string;
let userId: string;
let siteId: string;
const now = () => new Date().toISOString();

function callerAs(role: 'admin' | 'cashier') {
  const context = {
    req: {
      server: server.app,
      headers: {},
      user: { userId, email: 'admin@localhost', role, tenantId },
      jwtVerify: async () => {},
    } as unknown as Context['req'],
    res: {} as Context['res'],
    db: getDatabase(),
    user: { id: userId, email: 'admin@localhost', role, tenantId },
    tenantId,
    siteId,
  } as Context;
  return appRouter.createCaller(context);
}

function insertProduct(
  name: string,
  values: { price: number; cost: number; minStock: number; onHand: number; tracksStock?: boolean }
) {
  const id = nanoid();
  const { onHand, ...columns } = values;
  getDatabase()
    .insert(products)
    .values({
      id,
      tenantId,
      name,
      sku: `F-${id.slice(0, 6)}`,
      createdAt: now(),
      updatedAt: now(),
      ...columns,
    })
    .run();
  getDatabase()
    .insert(inventoryBalances)
    .values({
      id: nanoid(),
      tenantId,
      siteId,
      productId: id,
      onHand,
      reserved: 0,
      createdAt: now(),
      updatedAt: now(),
    })
    .run();
  return id;
}

describe('products.list filters', () => {
  let lowStockId: string;
  let lowMarginId: string;
  let healthyId: string;
  let untrackedId: string;

  beforeAll(async () => {
    server = await createServer({ dbPath: ':memory:', verbose: false });
    const db = getDatabase();
    const user = db.select().from(users).where(eq(users.email, 'admin@localhost')).get();
    if (!user) throw new Error('Expected seeded admin user');
    tenantId = user.tenantId;
    userId = user.id;
    const site = db.select().from(sites).where(eq(sites.tenantId, tenantId)).get();
    if (!site) throw new Error('Expected seeded site');
    siteId = site.id;

    lowStockId = insertProduct('At minimum', { price: 100, cost: 50, minStock: 5, onHand: 5 });
    lowMarginId = insertProduct('Thin margin', { price: 100, cost: 90, minStock: 1, onHand: 20 });
    healthyId = insertProduct('Healthy', { price: 100, cost: 50, minStock: 1, onHand: 20 });
    untrackedId = insertProduct('Service', {
      price: 100,
      cost: 50,
      minStock: 5,
      onHand: 0,
      tracksStock: false,
    });
  });

  afterAll(async () => {
    await server.close();
  });

  const ids = (result: { items: Array<{ id: string }> }) => result.items.map(item => item.id);

  it('finds products at or below their minimum and skips those without stock tracking', async () => {
    const found = ids(
      await callerAs('admin').products.list({ page: 1, perPage: 200, lowStock: true })
    );

    expect(found).toContain(lowStockId);
    expect(found).not.toContain(healthyId);
    expect(found).not.toContain(untrackedId);
  });

  it('finds products under the catalog margin and counts them', async () => {
    const result = await callerAs('admin').products.list({
      page: 1,
      perPage: 200,
      maxMarginPercent: 20,
    });

    expect(ids(result)).toContain(lowMarginId);
    expect(ids(result)).not.toContain(healthyId);
    expect(result.totalItems).toBe(result.items.length);
  });

  it('ignores the margin filter for roles that cannot see cost', async () => {
    const found = ids(
      await callerAs('cashier').products.list({ page: 1, perPage: 200, maxMarginPercent: 20 })
    );

    expect(found).toContain(healthyId);
  });
});
