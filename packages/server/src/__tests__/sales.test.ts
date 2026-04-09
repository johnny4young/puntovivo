import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { createServer, type OpenYojobServer } from '../index.js';
import { getDatabase } from '../db/index.js';
import {
  customers,
  inventoryMovements,
  products,
  saleItems,
  saleReturns,
  sales,
  sequentials,
  sites,
  unitXProduct,
  units,
  users,
} from '../db/schema.js';
import { appRouter } from '../trpc/router.js';
import type { Context } from '../trpc/context.js';

let server: OpenYojobServer;
let tenantId: string;
let userId: string;
let siteId: string;
let baseUnitId: string;
let boxUnitId: string;

function createTestContext(): Context {
  const db = getDatabase();
  const mockReq = {
    server: server.app,
    headers: {
      'x-site-id': siteId,
    },
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
    siteId,
  };
}

describe('Sales tRPC Router', () => {
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

    const seededSite = await db
      .select()
      .from(sites)
      .where(and(eq(sites.tenantId, tenantId), eq(sites.isActive, true)))
      .get();
    if (!seededSite) {
      throw new Error('Expected seeded site');
    }
    siteId = seededSite.id;

    const seededUnits = await db
      .select()
      .from(units)
      .where(eq(units.tenantId, tenantId))
      .all();
    const baseUnit = seededUnits.find(unit => unit.abbreviation === 'UND');
    const boxUnit = seededUnits.find(unit => unit.abbreviation === 'CJ');

    if (!baseUnit || !boxUnit) {
      throw new Error('Expected seeded units');
    }

    baseUnitId = baseUnit.id;
    boxUnitId = boxUnit.id;

    const now = new Date();
    const today = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 12)
    ).toISOString();
    const yesterday = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 1, 12)
    ).toISOString();

    await db.insert(sales).values([
      {
        id: nanoid(),
        tenantId,
        saleNumber: 'SALE-100001',
        subtotal: 100,
        taxAmount: 19,
        discountAmount: 0,
        total: 119,
        paymentMethod: 'cash',
        paymentStatus: 'paid',
        status: 'completed',
        createdBy: userId,
        createdAt: today,
        updatedAt: today,
      },
      {
        id: nanoid(),
        tenantId,
        saleNumber: 'SALE-100002',
        subtotal: 50,
        taxAmount: 9.5,
        discountAmount: 0,
        total: 59.5,
        paymentMethod: 'transfer',
        paymentStatus: 'pending',
        status: 'completed',
        createdBy: userId,
        createdAt: today,
        updatedAt: today,
      },
      {
        id: nanoid(),
        tenantId,
        saleNumber: 'SALE-100003',
        subtotal: 20,
        taxAmount: 3.8,
        discountAmount: 0,
        total: 23.8,
        paymentMethod: 'cash',
        paymentStatus: 'paid',
        status: 'completed',
        createdBy: userId,
        createdAt: yesterday,
        updatedAt: yesterday,
      },
    ]);
  });

  afterAll(async () => {
    await server.close();
  });

  it('returns aggregate sales KPIs for the current tenant', async () => {
    const caller = appRouter.createCaller(createTestContext());

    const result = await caller.sales.summary();

    expect(result.todaySalesTotal).toBeCloseTo(178.5);
    expect(result.transactionCount).toBe(3);
    expect(result.averageOrder).toBeCloseTo(67.4333333333);
    expect(result.pendingPaymentsTotal).toBeCloseTo(59.5);
  });

  it('creates a sale using the site sequential, VAT extraction, and normalized stock movement', async () => {
    const db = getDatabase();
    const customerId = nanoid();
    const productId = nanoid();

    await db.insert(customers).values({
      id: customerId,
      tenantId,
      name: 'Acme Retail',
      isActive: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    await db.insert(products).values({
      id: productId,
      tenantId,
      name: 'Sparkling Water Box',
      sku: 'SALE-BOX-01',
      price: 11.9,
      price2: 11.9,
      price3: 11.9,
      cost: 5,
      marginPercent1: 0,
      marginPercent2: 0,
      marginPercent3: 0,
      marginAmount1: 0,
      marginAmount2: 0,
      marginAmount3: 0,
      taxRate: 19,
      initialCost: 5,
      stock: 20,
      minStock: 0,
      isActive: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    const now = new Date().toISOString();
    await db.insert(unitXProduct).values([
      {
        id: nanoid(),
        productId,
        unitId: baseUnitId,
        equivalence: 1,
        price: 5.95,
        isBase: true,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: nanoid(),
        productId,
        unitId: boxUnitId,
        equivalence: 2,
        price: 11.9,
        isBase: false,
        createdAt: now,
        updatedAt: now,
      },
    ]);

    const caller = appRouter.createCaller(createTestContext());
    const result = await caller.sales.create({
      customerId,
      items: [
        {
          productId,
          unitId: boxUnitId,
          quantity: 2,
          unitPrice: 11.9,
          discount: 0,
        },
      ],
      paymentMethod: 'cash',
      paymentStatus: 'pending',
      status: 'completed',
      amountReceived: 30,
      discountAmount: 0,
      notes: 'Counter sale',
    });

    expect(result.saleNumber).toBe('VTA-000001');
    expect(result.customerId).toBe(customerId);
    expect(result.paymentStatus).toBe('paid');
    expect(result.subtotal).toBeCloseTo(20);
    expect(result.taxAmount).toBeCloseTo(3.8);
    expect(result.total).toBeCloseTo(23.8);
    expect(result.change).toBeCloseTo(6.2);
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({
      productId,
      unitId: boxUnitId,
      unitEquivalence: 2,
      costAtSale: 5,
      quantity: 2,
      total: 23.8,
    });

    const updatedProduct = await db.select().from(products).where(eq(products.id, productId)).get();
    expect(updatedProduct?.stock).toBe(16);

    const storedSaleItems = await db.select().from(saleItems).where(eq(saleItems.saleId, result.id)).all();
    expect(storedSaleItems).toHaveLength(1);
    expect(storedSaleItems[0]?.taxAmount).toBeCloseTo(3.8);

    const movement = await db
      .select()
      .from(inventoryMovements)
      .where(eq(inventoryMovements.reference, result.id))
      .get();
    expect(movement).toMatchObject({
      productId,
      type: 'sale',
      quantity: 4,
      previousStock: 20,
      newStock: 16,
    });

    const sequential = await db
      .select()
      .from(sequentials)
      .where(
        and(
          eq(sequentials.tenantId, tenantId),
          eq(sequentials.siteId, siteId),
          eq(sequentials.documentType, 'sale')
        )
      )
      .get();
    expect(sequential?.currentValue).toBe(1);
  });

  it('rejects sales that exceed available stock across repeated lines for the same product', async () => {
    const db = getDatabase();
    const productId = nanoid();
    const now = new Date().toISOString();

    await db.insert(products).values({
      id: productId,
      tenantId,
      name: 'Low Stock Product',
      sku: 'LOW-STOCK-01',
      price: 10,
      price2: 10,
      price3: 10,
      cost: 4,
      marginPercent1: 0,
      marginPercent2: 0,
      marginPercent3: 0,
      marginAmount1: 0,
      marginAmount2: 0,
      marginAmount3: 0,
      taxRate: 0,
      initialCost: 4,
      stock: 3,
      minStock: 0,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });

    await db.insert(unitXProduct).values({
      id: nanoid(),
      productId,
      unitId: baseUnitId,
      equivalence: 1,
      price: 10,
      isBase: true,
      createdAt: now,
      updatedAt: now,
    });

    const caller = appRouter.createCaller(createTestContext());

    await expect(
      caller.sales.create({
        items: [
          {
            productId,
            unitId: baseUnitId,
            quantity: 2,
            unitPrice: 10,
            discount: 0,
          },
          {
            productId,
            unitId: baseUnitId,
            quantity: 2,
            unitPrice: 10,
            discount: 0,
          },
        ],
        paymentMethod: 'cash',
        paymentStatus: 'pending',
        status: 'completed',
        discountAmount: 0,
      })
    ).rejects.toThrow(/Insufficient stock/);
  });

  it('voids a completed sale, restores stock, and removes it from completed sales KPIs', async () => {
    const db = getDatabase();
    const productId = nanoid();
    const now = new Date().toISOString();

    await db.insert(products).values({
      id: productId,
      tenantId,
      name: 'Voidable Product',
      sku: 'VOID-01',
      price: 10,
      price2: 10,
      price3: 10,
      cost: 4,
      marginPercent1: 0,
      marginPercent2: 0,
      marginPercent3: 0,
      marginAmount1: 0,
      marginAmount2: 0,
      marginAmount3: 0,
      taxRate: 0,
      initialCost: 4,
      stock: 10,
      minStock: 0,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });

    await db.insert(unitXProduct).values({
      id: nanoid(),
      productId,
      unitId: boxUnitId,
      equivalence: 2,
      price: 10,
      isBase: true,
      createdAt: now,
      updatedAt: now,
    });

    const caller = appRouter.createCaller(createTestContext());
    const summaryBeforeCreate = await caller.sales.summary();
    const created = await caller.sales.create({
      items: [
        {
          productId,
          unitId: boxUnitId,
          quantity: 2,
          unitPrice: 10,
          discount: 0,
        },
      ],
      paymentMethod: 'cash',
      paymentStatus: 'pending',
      status: 'completed',
      amountReceived: 20,
      discountAmount: 0,
    });

    const summaryBeforeVoid = await caller.sales.summary();
    expect(summaryBeforeVoid.transactionCount).toBe(summaryBeforeCreate.transactionCount + 1);
    expect(summaryBeforeVoid.todaySalesTotal).toBeCloseTo(summaryBeforeCreate.todaySalesTotal + created.total);

    const voided = await caller.sales.void({
      id: created.id,
      reason: 'Customer cancellation',
    });

    expect(voided.status).toBe('voided');
    expect(voided.notes).toContain('Voided: Customer cancellation');

    const restoredProduct = await db.select().from(products).where(eq(products.id, productId)).get();
    expect(restoredProduct?.stock).toBe(10);

    const reversalMovements = await db
      .select()
      .from(inventoryMovements)
      .where(eq(inventoryMovements.reference, created.id))
      .all();
    expect(reversalMovements).toHaveLength(2);
    const returnMovement = reversalMovements.find(movement => movement.type === 'return');
    expect(returnMovement).toMatchObject({
      productId,
      type: 'return',
      quantity: 4,
      previousStock: 6,
      newStock: 10,
    });

    const summaryAfterVoid = await caller.sales.summary();
    expect(summaryAfterVoid.transactionCount).toBe(summaryBeforeCreate.transactionCount);
    expect(summaryAfterVoid.todaySalesTotal).toBeCloseTo(summaryBeforeCreate.todaySalesTotal);
  });

  it('refunds a completed sale, restores stock, and excludes it from revenue KPIs', async () => {
    const db = getDatabase();
    const productId = nanoid();
    const now = new Date().toISOString();

    await db.insert(products).values({
      id: productId,
      tenantId,
      name: 'Refundable Product',
      sku: 'REFUND-01',
      price: 12,
      price2: 12,
      price3: 12,
      cost: 5,
      marginPercent1: 0,
      marginPercent2: 0,
      marginPercent3: 0,
      marginAmount1: 0,
      marginAmount2: 0,
      marginAmount3: 0,
      taxRate: 0,
      initialCost: 5,
      stock: 8,
      minStock: 0,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });

    await db.insert(unitXProduct).values({
      id: nanoid(),
      productId,
      unitId: baseUnitId,
      equivalence: 1,
      price: 12,
      isBase: true,
      createdAt: now,
      updatedAt: now,
    });

    const caller = appRouter.createCaller(createTestContext());
    const summaryBeforeCreate = await caller.sales.summary();
    const created = await caller.sales.create({
      items: [
        {
          productId,
          unitId: baseUnitId,
          quantity: 3,
          unitPrice: 12,
          discount: 0,
        },
      ],
      paymentMethod: 'cash',
      paymentStatus: 'pending',
      status: 'completed',
      amountReceived: 36,
      discountAmount: 0,
    });

    const summaryBeforeRefund = await caller.sales.summary();
    expect(summaryBeforeRefund.transactionCount).toBe(summaryBeforeCreate.transactionCount + 1);
    expect(summaryBeforeRefund.todaySalesTotal).toBeCloseTo(summaryBeforeCreate.todaySalesTotal + created.total);

    const refunded = await caller.sales.returnSale({
      id: created.id,
      reason: 'Items returned',
    });

    expect(refunded.paymentStatus).toBe('refunded');
    expect(refunded.returnReason).toBe('Items returned');
    expect(refunded.refundAmount).toBeCloseTo(created.total);
    expect(refunded.notes).toContain('Refunded: Items returned');

    const storedRefund = await db
      .select()
      .from(saleReturns)
      .where(eq(saleReturns.saleId, created.id))
      .get();
    expect(storedRefund).toMatchObject({
      saleId: created.id,
      refundAmount: created.total,
      reason: 'Items returned',
    });

    const restoredProduct = await db.select().from(products).where(eq(products.id, productId)).get();
    expect(restoredProduct?.stock).toBe(8);

    const reversalMovements = await db
      .select()
      .from(inventoryMovements)
      .where(eq(inventoryMovements.reference, created.id))
      .all();
    expect(reversalMovements).toHaveLength(2);
    const refundMovement = reversalMovements.find(movement => movement.type === 'return');
    expect(refundMovement).toMatchObject({
      productId,
      type: 'return',
      quantity: 3,
      previousStock: 5,
      newStock: 8,
    });

    const summaryAfterRefund = await caller.sales.summary();
    expect(summaryAfterRefund.transactionCount).toBe(summaryBeforeCreate.transactionCount);
    expect(summaryAfterRefund.todaySalesTotal).toBeCloseTo(summaryBeforeCreate.todaySalesTotal);
  });
});
