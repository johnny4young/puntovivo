import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { createServer, type OpenYojobServer } from '../index.js';
import { getDatabase } from '../db/index.js';
import { categories, providers, users, vatRates } from '../db/schema.js';
import { appRouter } from '../trpc/router.js';
import type { Context } from '../trpc/context.js';

let server: OpenYojobServer;
let tenantId: string;
let userId: string;
let categoryId: string;
let providerId: string;
let vatRateId: string;

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

describe('Products tRPC Router', () => {
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

    const seededVatRate = await db
      .select()
      .from(vatRates)
      .where(and(eq(vatRates.tenantId, seededUser.tenantId), eq(vatRates.name, 'IVA 19%')))
      .get();
    if (!seededVatRate) {
      throw new Error('Expected seeded VAT rate');
    }

    tenantId = seededUser.tenantId;
    userId = seededUser.id;
    vatRateId = seededVatRate.id;
    categoryId = nanoid();
    providerId = nanoid();

    await db.insert(categories).values({
      id: categoryId,
      tenantId,
      name: 'Beverages',
      description: null,
      parentId: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    await db.insert(providers).values({
      id: providerId,
      tenantId,
      name: 'Acme Supply',
      taxId: null,
      phone: null,
      email: null,
      address: null,
      cityId: null,
      contactName: 'Main Vendor',
      isActive: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
  });

  afterAll(async () => {
    await server.close();
  });

  it('creates, lists, updates, and soft deletes products with normalized pricing', async () => {
    const caller = appRouter.createCaller(createTestContext());

    const created = await caller.products.create({
      name: 'Orange Juice',
      sku: 'OJ-001',
      description: 'Fresh juice',
      categoryId,
      providerId,
      vatRateId,
      locationId: 'A-01',
      barcode: '1234567890',
      imageUrl: null,
      cost: 100,
      initialCost: 90,
      price: 120,
      price2: 140,
      price3: 160,
      marginPercent1: 0,
      marginPercent2: 0,
      marginPercent3: 0,
      marginAmount1: 0,
      marginAmount2: 0,
      marginAmount3: 0,
      taxRate: 0,
      stock: 20,
      minStock: 5,
      isActive: true,
    });

    expect(created.taxRate).toBe(19);
    expect(created.marginAmount1).toBe(20);
    expect(created.marginPercent2).toBe(40);
    expect(created.categoryName).toBe('Beverages');
    expect(created.providerName).toBe('Acme Supply');
    expect(created.vatRateName).toBe('IVA 19%');

    const listed = await caller.products.list({ page: 1, perPage: 20, search: 'Orange' });
    expect(listed.items.some(item => item.id === created.id)).toBe(true);

    const updated = await caller.products.update({
      id: created.id,
      cost: 110,
      marginPercent1: 25,
      marginPercent2: 40,
      marginPercent3: 55,
      price: 120,
      price2: 140,
      price3: 160,
      marginAmount1: 0,
      marginAmount2: 0,
      marginAmount3: 0,
      stock: 18,
    });

    expect(updated.cost).toBe(110);
    expect(updated.price).toBe(120);
    expect(updated.marginAmount1).toBe(10);
    expect(updated.marginPercent1).toBeCloseTo(9.09, 2);

    const removed = await caller.products.delete({ id: created.id });
    expect(removed.success).toBe(true);

    const fetched = await caller.products.getById({ id: created.id });
    expect(fetched.isActive).toBe(false);
  });
});
