import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { createServer, type PuntovivoServer } from '../index.js';
import { getDatabase } from '../db/index.js';
import {
  cashSessions,
  customers,
  inventoryBalances,
  products,
  saleItems,
  saleReturnItems,
  saleReturns,
  sales,
  sites,
  users,
} from '../db/schema.js';
import { seedCommittedSaleSession } from './utils/cashSessionFixture.js';
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
    const seededUser = await db
      .select()
      .from(users)
      .where(eq(users.email, 'admin@localhost'))
      .get();
    if (!seededUser) {
      throw new Error('Expected seeded admin user');
    }

    tenantId = seededUser.tenantId;
    userId = seededUser.id;

    const seededSite = await db
      .select()
      .from(sites)
      .where(and(eq(sites.tenantId, tenantId), eq(sites.isActive, true)))
      .get();
    if (!seededSite) {
      throw new Error('Expected seeded site');
    }
    const siteId = seededSite.id;

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
        minStock: 1,
        isActive: true,
        createdAt: todayIso,
        updatedAt: todayIso,
      },
    ]);

    // Stock is derived from inventory_balances now (products.stock removed).
    // Seed each product's on_hand at the active site so the dashboard's
    // low-stock derivation (Σ on_hand ≤ minStock) reproduces the original
    // per-product stock levels.
    await db.insert(inventoryBalances).values([
      {
        id: nanoid(),
        tenantId,
        siteId,
        productId: productOneId,
        onHand: 3,
        reserved: 0,
        createdAt: todayIso,
        updatedAt: todayIso,
      },
      {
        id: nanoid(),
        tenantId,
        siteId,
        productId: productTwoId,
        onHand: 12,
        reserved: 0,
        createdAt: todayIso,
        updatedAt: todayIso,
      },
      {
        id: nanoid(),
        tenantId,
        siteId,
        productId: productThreeId,
        onHand: 1,
        reserved: 0,
        createdAt: todayIso,
        updatedAt: todayIso,
      },
      {
        id: nanoid(),
        tenantId,
        siteId,
        productId: refundedProductId,
        onHand: 10,
        reserved: 0,
        createdAt: todayIso,
        updatedAt: todayIso,
      },
    ]);

    // committed sales need a cash session; one shared closed
    // session satisfies the CHECK without affecting any dashboard metric
    // (the aggregates sum sales, never sessions).
    const dashSessionId = await seedCommittedSaleSession({ tenantId, cashierId: userId });
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
        cashSessionId: dashSessionId,
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
        cashSessionId: dashSessionId,
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
        cashSessionId: dashSessionId,
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
        returnState: 'refunded',
        status: 'completed',
        cashSessionId: dashSessionId,
        createdBy: userId,
        createdAt: new Date(
          Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate(), 10)
        ).toISOString(),
        updatedAt: todayIso,
      },
    ]);

    // A returned sale is only a returned sale because a dated sale_returns
    // row exists; returnState alone is a denormalized mirror of it. Revenue
    // now subtracts that dated event, so the fixture has to carry it.
    const refundedReturnId = nanoid();
    const refundedSaleItemId = nanoid();
    await db.insert(saleReturns).values({
      id: refundedReturnId,
      tenantId,
      saleId: refundedSaleId,
      destination: 'original',
      subtotal: 200,
      tipAmount: 0,
      serviceChargeAmount: 0,
      discountAmount: 0,
      taxAmount: 0,
      refundAmount: 200,
      currencyCode: 'COP',
      createdBy: userId,
      createdAt: new Date(
        Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate(), 11)
      ).toISOString(),
    });

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
        id: refundedSaleItemId,
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

    // The production writer inserts the return header AND its lines in one
    // transaction, so a header without lines describes a sale that cannot
    // exist. Per-product period figures read the LINES, so omitting them left
    // a fully refunded product still ranking as a top seller.
    await db.insert(saleReturnItems).values({
      id: nanoid(),
      tenantId,
      saleReturnId: refundedReturnId,
      saleItemId: refundedSaleItemId,
      productId: refundedProductId,
      productNameSnapshot: 'Refunded Product',
      productSkuSnapshot: 'REF-001',
      quantity: 1,
      baseQuantity: 1,
      unitPrice: 200,
      unitEquivalence: 1,
      discountRate: 0,
      taxKind: 'iva',
      taxRate: 0,
      subtotal: 200,
      discountAmount: 0,
      taxAmount: 0,
      total: 200,
      costAmount: 40,
      currencyCode: 'COP',
      createdAt: new Date(
        Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate(), 11)
      ).toISOString(),
    });
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

  it('uses the payment completion instant for a parked draft', async () => {
    const db = getDatabase();
    const existing = await db
      .select({ cashSessionId: sales.cashSessionId })
      .from(sales)
      .where(and(eq(sales.tenantId, tenantId), eq(sales.saleNumber, 'SALE-000100')))
      .get();
    if (!existing?.cashSessionId) throw new Error('Expected dashboard cash session');

    const today = new Date();
    const completedAt = new Date(
      Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate(), 20)
    ).toISOString();
    const openedAt = new Date(
      Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() - 35, 12)
    ).toISOString();
    await db.insert(sales).values({
      id: nanoid(),
      tenantId,
      saleNumber: 'SALE-PARKED-001',
      subtotal: 10,
      taxAmount: 0,
      discountAmount: 0,
      total: 10,
      paymentMethod: 'cash',
      paymentStatus: 'paid',
      status: 'completed',
      cashSessionId: existing.cashSessionId,
      createdBy: userId,
      createdAt: openedAt,
      updatedAt: completedAt,
      checkoutCompletedAt: completedAt,
    });

    const result = await appRouter.createCaller(createTestContext()).dashboard.summary();
    expect(result.stats.todayRevenue.value).toBe(69.5);
    expect(result.stats.todayOrders.value).toBe(2);
    expect(result.stats.revenueThirtyDays.value).toBe(85.25);
    expect(result.recentSales[0]?.saleNumber).toBe('SALE-PARKED-001');
    expect(result.recentSales[0]?.createdAt).toBe(completedAt);
  });

  it('books a return in the window against a sale made before it', async () => {
    // The old top-products query correlated LIFETIME returns onto sale rows
    // and then windowed on the sale date. That shape cannot express this case
    // at all: the refund belongs to this week, but its sale row is outside the
    // window, so there was nothing to correlate it against. The sale it
    // shrank instead was the one in the closed period that earned it.
    const db = getDatabase();
    const site = await db.select().from(sites).where(eq(sites.tenantId, tenantId)).get();
    const session = await db
      .select()
      .from(cashSessions)
      .where(eq(cashSessions.tenantId, tenantId))
      .get();
    const productId = nanoid();
    const saleId = nanoid();
    const saleItemId = nanoid();
    const returnId = nanoid();
    const now = new Date();
    const utcDay = (offsetDays: number, hour: number) =>
      new Date(
        Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + offsetDays, hour)
      ).toISOString();
    // Sold well outside the seven-day window, refunded inside it.
    const soldAt = utcDay(-20, 10);
    const refundedAt = utcDay(-1, 10);

    await db.insert(products).values({
      id: productId,
      tenantId,
      name: 'Late Return Product',
      sku: `LATE-${nanoid(5)}`,
      price: 500,
      cost: 100,
      taxRate: 0,
      minStock: 0,
      isActive: true,
      createdAt: soldAt,
      updatedAt: soldAt,
    });
    await db.insert(sales).values({
      id: saleId,
      tenantId,
      saleNumber: `VTA-LATE-${nanoid(5)}`,
      siteId: site!.id,
      subtotal: 500,
      taxAmount: 0,
      discountAmount: 0,
      total: 500,
      paymentMethod: 'cash',
      paymentStatus: 'paid',
      status: 'completed',
      cashSessionId: session!.id,
      checkoutCompletedAt: soldAt,
      createdBy: userId,
      createdAt: soldAt,
      updatedAt: soldAt,
    });
    await db.insert(saleItems).values({
      id: saleItemId,
      saleId,
      productId,
      quantity: 1,
      unitPrice: 500,
      discount: 0,
      taxRate: 0,
      taxAmount: 0,
      costAtSale: 100,
      total: 500,
    });

    try {
      const beforeReturn = await appRouter.createCaller(createTestContext()).dashboard.summary();
      // Sold outside the window: it is not a top seller this week.
      expect(beforeReturn.topProducts.some(entry => entry.productId === productId)).toBe(false);

      await db.insert(saleReturns).values({
        id: returnId,
        tenantId,
        saleId,
        destination: 'original',
        subtotal: 500,
        tipAmount: 0,
        serviceChargeAmount: 0,
        discountAmount: 0,
        taxAmount: 0,
        refundAmount: 500,
        currencyCode: 'COP',
        createdBy: userId,
        createdAt: refundedAt,
      });
      await db.insert(saleReturnItems).values({
        id: nanoid(),
        tenantId,
        saleReturnId: returnId,
        saleItemId,
        productId,
        quantity: 1,
        baseQuantity: 1,
        unitPrice: 500,
        unitEquivalence: 1,
        discountRate: 0,
        taxKind: 'iva',
        taxRate: 0,
        subtotal: 500,
        discountAmount: 0,
        taxAmount: 0,
        total: 500,
        costAmount: 100,
        currencyCode: 'COP',
        createdAt: refundedAt,
      });

      const afterReturn = await appRouter.createCaller(createTestContext()).dashboard.summary();
      // The refund lands in THIS week as a negative event, so the product is
      // still not a top seller -- and, critically, the week it was sold in is
      // outside this window and was never restated to produce that result.
      expect(afterReturn.topProducts.some(entry => entry.productId === productId)).toBe(false);
      // The other products' standings are untouched by a refund that belongs
      // to a different ticket entirely.
      expect(afterReturn.topProducts.map(entry => entry.name)).toEqual(
        beforeReturn.topProducts.map(entry => entry.name)
      );
    } finally {
      await db.delete(saleReturnItems).where(eq(saleReturnItems.saleReturnId, returnId));
      await db.delete(saleReturns).where(eq(saleReturns.id, returnId));
      await db.delete(saleItems).where(eq(saleItems.id, saleItemId));
      await db.delete(sales).where(eq(sales.id, saleId));
      await db.delete(products).where(eq(products.id, productId));
    }
  });
});
