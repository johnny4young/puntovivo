import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { createServer, type PuntovivoServer } from '../index.js';
import { getDatabase } from '../db/index.js';
import { customers, products, saleItems, sales, users } from '../db/schema.js';
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

    const today = new Date();
    const todayIso = new Date(
      Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate(), 14)
    ).toISOString();
    const sixDaysAgoIso = new Date(
      Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() - 6, 16)
    ).toISOString();
    const thirtyFiveDaysAgoIso = new Date(
      Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() - 35, 12)
    ).toISOString();

    const customerId = nanoid();
    const productOneId = nanoid();
    const productTwoId = nanoid();
    const productThreeId = nanoid();
    const refundedProductId = nanoid();
    const todaySaleId = nanoid();
    const weekSaleId = nanoid();
    const oldSaleId = nanoid();
    const refundedSaleId = nanoid();

    await db.insert(customers).values([
      {
        id: customerId,
        tenantId,
        name: 'Jane Buyer',
        email: 'jane@example.com',
        isActive: true,
        createdAt: todayIso,
        updatedAt: todayIso,
      },
      {
        id: nanoid(),
        tenantId,
        name: 'Dormant Buyer',
        email: 'dormant@example.com',
        isActive: false,
        createdAt: todayIso,
        updatedAt: todayIso,
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
        stock: 3,
        minStock: 5,
        isActive: true,
        createdAt: todayIso,
        updatedAt: todayIso,
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
        createdAt: sixDaysAgoIso,
        updatedAt: sixDaysAgoIso,
      },
      {
        id: productThreeId,
        tenantId,
        name: 'Sugar Pack',
        sku: 'SUG-001',
        price: 8,
        cost: 4,
        taxRate: 0,
        stock: 1,
        minStock: 2,
        isActive: true,
        createdAt: thirtyFiveDaysAgoIso,
        updatedAt: todayIso,
      },
      {
        id: refundedProductId,
        tenantId,
        name: 'Refunded Product',
        sku: 'REF-001',
        price: 200,
        cost: 40,
        taxRate: 0,
        stock: 10,
        minStock: 1,
        isActive: true,
        createdAt: todayIso,
        updatedAt: todayIso,
      },
    ]);

    await db.insert(sales).values([
      {
        id: todaySaleId,
        tenantId,
        saleNumber: 'SALE-000100',
        customerId,
        subtotal: 50,
        taxAmount: 9.5,
        discountAmount: 0,
        total: 59.5,
        paymentMethod: 'cash',
        paymentStatus: 'paid',
        status: 'completed',
        createdBy: userId,
        createdAt: todayIso,
        updatedAt: todayIso,
      },
      {
        id: weekSaleId,
        tenantId,
        saleNumber: 'SALE-000090',
        customerId,
        subtotal: 15,
        taxAmount: 0.75,
        discountAmount: 0,
        total: 15.75,
        paymentMethod: 'cash',
        paymentStatus: 'paid',
        status: 'completed',
        createdBy: userId,
        createdAt: sixDaysAgoIso,
        updatedAt: sixDaysAgoIso,
      },
      {
        id: oldSaleId,
        tenantId,
        saleNumber: 'SALE-000010',
        customerId,
        subtotal: 8,
        taxAmount: 0,
        discountAmount: 0,
        total: 8,
        paymentMethod: 'cash',
        paymentStatus: 'paid',
        status: 'completed',
        createdBy: userId,
        createdAt: thirtyFiveDaysAgoIso,
        updatedAt: thirtyFiveDaysAgoIso,
      },
      {
        id: refundedSaleId,
        tenantId,
        saleNumber: 'SALE-000080',
        customerId,
        subtotal: 200,
        taxAmount: 0,
        discountAmount: 0,
        total: 200,
        paymentMethod: 'cash',
        paymentStatus: 'refunded',
        status: 'completed',
        createdBy: userId,
        createdAt: new Date(
          Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate(), 10)
        ).toISOString(),
        updatedAt: todayIso,
      },
    ]);

    await db.insert(saleItems).values([
      {
        id: nanoid(),
        saleId: todaySaleId,
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
        saleId: weekSaleId,
        productId: productTwoId,
        quantity: 1,
        unitPrice: 15,
        discount: 0,
        taxRate: 5,
        taxAmount: 0.75,
        costAtSale: 7,
        total: 15.75,
      },
      {
        id: nanoid(),
        saleId: oldSaleId,
        productId: productThreeId,
        quantity: 1,
        unitPrice: 8,
        discount: 0,
        taxRate: 0,
        taxAmount: 0,
        costAtSale: 4,
        total: 8,
      },
      {
        id: nanoid(),
        saleId: refundedSaleId,
        productId: refundedProductId,
        quantity: 1,
        unitPrice: 200,
        discount: 0,
        taxRate: 0,
        taxAmount: 0,
        costAtSale: 40,
        total: 200,
      },
    ]);
  });

  afterAll(async () => {
    await server.close();
  });

  it('returns live dashboard aggregates for the current tenant', async () => {
    const caller = appRouter.createCaller(createTestContext());

    const result = await caller.dashboard.summary();

    expect(result.stats.todayRevenue.value).toBe(59.5);
    expect(result.stats.todayOrders.value).toBe(1);
    expect(result.stats.lowStockCount.value).toBe(2);
    expect(result.stats.revenueThirtyDays.value).toBe(75.25);
    expect(result.stats.customers.value).toBe(1);

    expect(result.recentSales[0]?.saleNumber).toBe('SALE-000100');
    expect(result.topProducts[0]?.name).toBe('Coffee Beans');
    expect(result.topProducts[1]?.name).toBe('Tea Box');
    expect(result.lowStockItems[0]?.name).toBe('Sugar Pack');

    expect(result.revenueChart).toHaveLength(30);
    expect(result.revenueChart[result.revenueChart.length - 1]?.revenue).toBe(59.5);
    expect(result.revenueChart[result.revenueChart.length - 7]?.revenue).toBe(15.75);
  });
});
