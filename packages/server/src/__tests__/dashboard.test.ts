import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { createServer, type OpenYojobServer } from '../index.js';
import { getDatabase } from '../db/index.js';
import { customers, products, saleItems, sales, users } from '../db/schema.js';
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

describe('Dashboard tRPC Router', () => {
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

    const now = new Date();
    const currentMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 10)).toISOString();
    const previousMonth = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 10)
    ).toISOString();

    const customerId = nanoid();
    const previousCustomerId = nanoid();
    const productOneId = nanoid();
    const productTwoId = nanoid();
    const currentSaleId = nanoid();
    const previousSaleId = nanoid();

    await db.insert(customers).values([
      {
        id: customerId,
        tenantId,
        name: 'Jane Buyer',
        email: 'jane@example.com',
        isActive: true,
        createdAt: currentMonth,
        updatedAt: currentMonth,
      },
      {
        id: previousCustomerId,
        tenantId,
        name: 'John Prior',
        email: 'john@example.com',
        isActive: true,
        createdAt: previousMonth,
        updatedAt: previousMonth,
      },
    ]);

    await db.insert(products).values([
      {
        id: productOneId,
        tenantId,
        name: 'Coffee Beans',
        sku: 'COF-001',
        price: 25,
        cost: 10,
        taxRate: 19,
        stock: 25,
        minStock: 5,
        isActive: true,
        createdAt: currentMonth,
        updatedAt: currentMonth,
      },
      {
        id: productTwoId,
        tenantId,
        name: 'Tea Box',
        sku: 'TEA-001',
        price: 15,
        cost: 7,
        taxRate: 5,
        stock: 12,
        minStock: 4,
        isActive: true,
        createdAt: previousMonth,
        updatedAt: previousMonth,
      },
    ]);

    await db.insert(sales).values([
      {
        id: currentSaleId,
        tenantId,
        saleNumber: 'SALE-000001',
        customerId,
        subtotal: 50,
        taxAmount: 9.5,
        discountAmount: 0,
        total: 59.5,
        paymentMethod: 'cash',
        paymentStatus: 'paid',
        status: 'completed',
        createdBy: userId,
        createdAt: currentMonth,
        updatedAt: currentMonth,
      },
      {
        id: previousSaleId,
        tenantId,
        saleNumber: 'SALE-000000',
        customerId: previousCustomerId,
        subtotal: 15,
        taxAmount: 0.75,
        discountAmount: 0,
        total: 15.75,
        paymentMethod: 'cash',
        paymentStatus: 'paid',
        status: 'completed',
        createdBy: userId,
        createdAt: previousMonth,
        updatedAt: previousMonth,
      },
    ]);

    await db.insert(saleItems).values([
      {
        id: nanoid(),
        saleId: currentSaleId,
        productId: productOneId,
        quantity: 2,
        unitPrice: 25,
        discount: 0,
        taxRate: 19,
        taxAmount: 9.5,
        costAtSale: 10,
        total: 59.5,
      },
      {
        id: nanoid(),
        saleId: previousSaleId,
        productId: productTwoId,
        quantity: 1,
        unitPrice: 15,
        discount: 0,
        taxRate: 5,
        taxAmount: 0.75,
        costAtSale: 7,
        total: 15.75,
      },
    ]);
  });

  afterAll(async () => {
    await server.close();
  });

  it('returns live dashboard aggregates for the current tenant', async () => {
    const caller = appRouter.createCaller(createTestContext());

    const result = await caller.dashboard.summary();

    expect(result.stats.revenue.value).toBe(59.5);
    expect(result.stats.orders.value).toBe(1);
    expect(result.stats.customers.value).toBe(2);
    expect(result.stats.products.value).toBe(2);
    expect(result.recentSales[0]?.saleNumber).toBe('SALE-000001');
    expect(result.topProducts[0]?.name).toBe('Coffee Beans');
    expect(result.topProducts[0]?.sales).toBe(2);
  });
});
