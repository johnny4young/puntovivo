import { TRPCError } from '@trpc/server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { createServer, type PuntovivoServer } from '../index.js';
import { getDatabase } from '../db/index.js';
import { registerDevice as registerDeviceService } from '../services/devices/devicesService.js';
import { makeEnvelopeHeadersProxy } from './utils/criticalCommandFixture.js';
import {
  cashMovements,
  cashSessions,
  customers,
  fiscalDocuments,
  fiscalNumberingResolutions,
  inventoryMovements,
  products,
  salePayments,
  saleItems,
  saleReturns,
  sales,
  sequentials,
  sites,
  tenantLocaleSettings,
  tenants,
  unitXProduct,
  units,
  users,
} from '../db/schema.js';
import { appRouter } from '../trpc/router.js';
import type { Context } from '../trpc/context.js';

let server: PuntovivoServer;
let tenantId: string;
let userId: string;
let siteId: string;
let baseUnitId: string;
let boxUnitId: string;
let activeCashSessionId: string;
let testDeviceId: string;

function createTestContext(role: 'admin' | 'manager' | 'cashier' | 'viewer' = 'admin'): Context {
  const db = getDatabase();
  const mockReq = {
    server: server.app,
    headers: makeEnvelopeHeadersProxy({
      getDeviceId: () => testDeviceId,
      getSiteId: () => siteId,
    }),
    user: {
      userId,
      email: 'admin@localhost',
      role,
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
      role,
      tenantId,
    },
    tenantId,
    siteId,
  };
}

function createTestContextForSite(overrideSiteId: string): Context {
  const db = getDatabase();
  const mockReq = {
    server: server.app,
    headers: makeEnvelopeHeadersProxy({
      getDeviceId: () => testDeviceId,
      getSiteId: () => overrideSiteId,
    }),
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
    siteId: overrideSiteId,
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

    // ENG-052b — register one device per test file. The id is reused
    // for every critical mutation; envelopes still mint fresh per
    // call via `freshHeaders()`.
    const registration = await registerDeviceService(db, {
      tenantId,
      userId,
      kind: 'web',
      name: 'sales.test',
    });
    testDeviceId = registration.deviceId;

    const caller = appRouter.createCaller(createTestContext());
    const activeCashSession = await caller.cashSessions.open({
      registerName: 'Front register',
      openingFloat: 200,
      denominations: [
        { value: 100, count: 2 },
      ],
    });

    activeCashSessionId = activeCashSession.id;

    // Use local-time noon to match the summary query which filters by local-time midnight boundaries.
    // Using Date.UTC would cause failures in timezones west of UTC when local date != UTC date.
    const now = new Date();
    const todayLocal = new Date(now);
    todayLocal.setHours(12, 0, 0, 0);
    const today = todayLocal.toISOString();
    const yesterdayLocal = new Date(now);
    yesterdayLocal.setDate(yesterdayLocal.getDate() - 1);
    yesterdayLocal.setHours(12, 0, 0, 0);
    const yesterday = yesterdayLocal.toISOString();

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

  it('requires manager or admin role to update sale payment state', async () => {
    const cashierCaller = appRouter.createCaller(createTestContext('cashier'));

    await expect(
      cashierCaller.sales.update({
        id: 'sale-any',
        paymentStatus: 'refunded',
      })
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
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
    const cashSessionBeforeSale = await db
      .select({
        expectedBalance: cashSessions.expectedBalance,
      })
      .from(cashSessions)
      .where(eq(cashSessions.id, activeCashSessionId))
      .get();
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

    const storedSale = await db
      .select({
        cashSessionId: sales.cashSessionId,
      })
      .from(sales)
      .where(eq(sales.id, result.id))
      .get();
    expect(storedSale?.cashSessionId).toBe(activeCashSessionId);

    const cashSessionAfterSale = await db
      .select({
        expectedBalance: cashSessions.expectedBalance,
      })
      .from(cashSessions)
      .where(eq(cashSessions.id, activeCashSessionId))
      .get();
    expect(cashSessionBeforeSale?.expectedBalance).toBeDefined();
    expect(cashSessionAfterSale?.expectedBalance).toBeCloseTo(
      (cashSessionBeforeSale?.expectedBalance ?? 0) + result.total
    );

    const cashMovement = await db
      .select()
      .from(cashMovements)
      .where(eq(cashMovements.referenceId, result.id))
      .get();
    expect(cashMovement).toMatchObject({
      sessionId: activeCashSessionId,
      type: 'sale',
      amount: result.total,
      note: `Sale ${result.saleNumber} · Main Site`,
      createdBy: userId,
    });
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

  it('completes a Mexico-tenant sale without inserting a fiscal document while the pack is parked', async () => {
    const db = getDatabase();
    const caller = appRouter.createCaller(createTestContext());
    const now = new Date().toISOString();
    const productId = nanoid();
    const resolutionId = nanoid();

    const previousTenant = await db
      .select({ settings: tenants.settings })
      .from(tenants)
      .where(eq(tenants.id, tenantId))
      .get();
    const previousLocale = await db
      .select()
      .from(tenantLocaleSettings)
      .where(eq(tenantLocaleSettings.tenantId, tenantId))
      .get();

    try {
      await db
        .update(tenants)
        .set({
          settings: {
            ...(previousTenant?.settings ?? {}),
            fiscal_dian_enabled: true,
          },
        })
        .where(eq(tenants.id, tenantId))
        .run();

      await db
        .delete(tenantLocaleSettings)
        .where(eq(tenantLocaleSettings.tenantId, tenantId))
        .run();
      await db.insert(tenantLocaleSettings).values({
        tenantId,
        countryCode: 'MX',
        localeOverride: null,
        currencyOverride: null,
        timezoneOverride: null,
        firstDayOfWeekOverride: null,
        updatedAt: now,
      });

      await db.insert(fiscalNumberingResolutions).values({
        id: resolutionId,
        tenantId,
        siteId,
        kind: 'DEE',
        resolutionNumber: '18760000001',
        prefix: 'MXP',
        fromNumber: 1,
        toNumber: 10000,
        currentNumber: 0,
        technicalKey: 'fc8eac422eba16e22ffd8c6f94b3f40a6e38162c',
        validFrom: now,
        validUntil: now,
        isActive: true,
        createdAt: now,
        updatedAt: now,
      });

      await db.insert(products).values({
        id: productId,
        tenantId,
        name: 'Mexico Parked Fiscal Product',
        sku: `MX-PARKED-${productId.slice(0, 8)}`,
        price: 20,
        price2: 20,
        price3: 20,
        cost: 8,
        marginPercent1: 0,
        marginPercent2: 0,
        marginPercent3: 0,
        marginAmount1: 0,
        marginAmount2: 0,
        marginAmount3: 0,
        taxRate: 0,
        initialCost: 8,
        stock: 5,
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
        price: 20,
        isBase: true,
        createdAt: now,
        updatedAt: now,
      });

      const result = await caller.sales.create({
        items: [
          { productId, unitId: baseUnitId, quantity: 1, unitPrice: 20, discount: 0 },
        ],
        paymentMethod: 'cash',
        paymentStatus: 'paid',
        status: 'completed',
        amountReceived: 20,
        discountAmount: 0,
      });

      expect(result.status).toBe('completed');
      const emittedDocuments = await db
        .select()
        .from(fiscalDocuments)
        .where(eq(fiscalDocuments.sourceId, result.id))
        .all();
      expect(emittedDocuments).toHaveLength(0);
    } finally {
      await db
        .delete(fiscalNumberingResolutions)
        .where(eq(fiscalNumberingResolutions.id, resolutionId))
        .run();
      await db
        .delete(tenantLocaleSettings)
        .where(eq(tenantLocaleSettings.tenantId, tenantId))
        .run();
      if (previousLocale) {
        await db.insert(tenantLocaleSettings).values(previousLocale).run();
      }
      await db
        .update(tenants)
        .set({ settings: previousTenant?.settings ?? {} })
        .where(eq(tenants.id, tenantId))
        .run();
    }
  });

  it('creates sales with fractional quantities and preserves decimal stock deductions', async () => {
    const db = getDatabase();
    const productId = nanoid();
    const now = new Date().toISOString();

    await db.insert(products).values({
      id: productId,
      tenantId,
      name: 'Bananas by weight',
      sku: 'SALE-FRAC-001',
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
      stock: 2,
      minStock: 0,
      sellByFraction: true,
      fractionStep: 0.25,
      fractionMinimum: 0.5,
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
    const result = await caller.sales.create({
      items: [
        {
          productId,
          unitId: baseUnitId,
          quantity: 0.75,
          unitPrice: 12,
          discount: 0,
        },
      ],
      paymentMethod: 'cash',
      paymentStatus: 'pending',
      status: 'completed',
      amountReceived: 12,
      discountAmount: 0,
    });

    expect(result.total).toBeCloseTo(9);
    expect(result.items[0]?.quantity).toBe(0.75);

    const updatedProduct = await db.select().from(products).where(eq(products.id, productId)).get();
    expect(updatedProduct?.stock).toBeCloseTo(1.25);

    const movement = await db
      .select()
      .from(inventoryMovements)
      .where(eq(inventoryMovements.reference, result.id))
      .get();
    expect(movement?.quantity).toBe(0.75);
    expect(movement?.newStock).toBeCloseTo(1.25);
  });

  it('rejects fractional sale quantities for products that require whole units', async () => {
    const db = getDatabase();
    const productId = nanoid();
    const now = new Date().toISOString();

    await db.insert(products).values({
      id: productId,
      tenantId,
      name: 'Whole-unit soda',
      sku: 'SALE-WHOLE-001',
      price: 5,
      price2: 5,
      price3: 5,
      cost: 2,
      marginPercent1: 0,
      marginPercent2: 0,
      marginPercent3: 0,
      marginAmount1: 0,
      marginAmount2: 0,
      marginAmount3: 0,
      taxRate: 0,
      initialCost: 2,
      stock: 10,
      minStock: 0,
      sellByFraction: false,
      fractionStep: null,
      fractionMinimum: null,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });

    await db.insert(unitXProduct).values({
      id: nanoid(),
      productId,
      unitId: baseUnitId,
      equivalence: 1,
      price: 5,
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
            quantity: 0.5,
            unitPrice: 5,
            discount: 0,
          },
        ],
        paymentMethod: 'cash',
        paymentStatus: 'pending',
        status: 'completed',
        amountReceived: 5,
        discountAmount: 0,
      })
    ).rejects.toThrow(/whole units/);
  });

  it('rejects sale quantities that do not match the product fraction step', async () => {
    const db = getDatabase();
    const productId = nanoid();
    const now = new Date().toISOString();

    await db.insert(products).values({
      id: productId,
      tenantId,
      name: 'Cable reel',
      sku: 'SALE-STEP-001',
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
      stock: 10,
      minStock: 0,
      sellByFraction: true,
      fractionStep: 0.25,
      fractionMinimum: 0.5,
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

    await expect(
      caller.sales.create({
        items: [
          {
            productId,
            unitId: baseUnitId,
            quantity: 0.6,
            unitPrice: 12,
            discount: 0,
          },
        ],
        paymentMethod: 'cash',
        paymentStatus: 'pending',
        status: 'completed',
        amountReceived: 12,
        discountAmount: 0,
      })
    ).rejects.toThrow(/increments of 0.25/);
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
    const cashSessionBeforeCreate = await db
      .select({
        expectedBalance: cashSessions.expectedBalance,
      })
      .from(cashSessions)
      .where(eq(cashSessions.id, activeCashSessionId))
      .get();
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

    const cashSessionAfterCreate = await db
      .select({
        expectedBalance: cashSessions.expectedBalance,
      })
      .from(cashSessions)
      .where(eq(cashSessions.id, activeCashSessionId))
      .get();
    expect(cashSessionAfterCreate?.expectedBalance).toBeCloseTo(
      (cashSessionBeforeCreate?.expectedBalance ?? 0) + created.total
    );

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

    const cashSessionAfterVoid = await db
      .select({
        expectedBalance: cashSessions.expectedBalance,
      })
      .from(cashSessions)
      .where(eq(cashSessions.id, activeCashSessionId))
      .get();
    expect(cashSessionAfterVoid?.expectedBalance).toBeCloseTo(
      cashSessionBeforeCreate?.expectedBalance ?? 0
    );

    const cashReversal = await db
      .select()
      .from(cashMovements)
      .where(and(eq(cashMovements.referenceId, created.id), eq(cashMovements.type, 'refund')))
      .all();
    expect(cashReversal).toHaveLength(1);
    expect(cashReversal[0]).toMatchObject({
      sessionId: activeCashSessionId,
      amount: created.total,
      note: `Voided sale ${created.saleNumber}`,
      createdBy: userId,
    });
  });

  it('voids a sale tied to a closed cash session without touching any cash movement', async () => {
    const db = getDatabase();
    const productId = nanoid();
    const saleId = nanoid();
    const closedSessionId = nanoid();
    const now = new Date().toISOString();

    // Seed a closed cash session with a known expected balance — the void must NOT
    // modify this balance because over/short is already locked for closed sessions.
    await db.insert(cashSessions).values({
      id: closedSessionId,
      tenantId,
      siteId,
      cashierId: userId,
      registerName: 'Closed register',
      openingFloat: 50,
      openingCountDenominations: [{ value: 50, count: 1 }],
      expectedBalance: 70,
      actualCount: 70,
      actualCountDenominations: [{ value: 50, count: 1 }, { value: 20, count: 1 }],
      overShort: 0,
      status: 'closed',
      openedAt: now,
      closedAt: now,
      createdAt: now,
      updatedAt: now,
    });

    await db.insert(products).values({
      id: productId,
      tenantId,
      name: 'Closed Session Voidable',
      sku: 'CLOSED-VOID-01',
      price: 20,
      price2: 20,
      price3: 20,
      cost: 10,
      marginPercent1: 0,
      marginPercent2: 0,
      marginPercent3: 0,
      marginAmount1: 0,
      marginAmount2: 0,
      marginAmount3: 0,
      taxRate: 0,
      initialCost: 10,
      stock: 5,
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
      price: 20,
      isBase: true,
      createdAt: now,
      updatedAt: now,
    });

    // Insert the sale directly to attach it to the already-closed session.
    await db.insert(sales).values({
      id: saleId,
      tenantId,
      saleNumber: 'CLOSED-VOID-0001',
      subtotal: 20,
      taxAmount: 0,
      discountAmount: 0,
      total: 20,
      paymentMethod: 'cash',
      paymentStatus: 'paid',
      status: 'completed',
      cashSessionId: closedSessionId,
      createdBy: userId,
      createdAt: now,
      updatedAt: now,
    });

    await db.insert(saleItems).values({
      id: nanoid(),
      saleId,
      productId,
      quantity: 1,
      unitPrice: 20,
      unitId: baseUnitId,
      unitEquivalence: 1,
      discount: 0,
      taxRate: 0,
      taxAmount: 0,
      costAtSale: 10,
      total: 20,
    });

    const caller = appRouter.createCaller(createTestContext());
    const voided = await caller.sales.void({
      id: saleId,
      reason: 'Admin cleanup from closed shift',
    });

    expect(voided.status).toBe('voided');

    // Closed session's expected balance must stay pristine.
    const closedSessionAfterVoid = await db
      .select({ expectedBalance: cashSessions.expectedBalance })
      .from(cashSessions)
      .where(eq(cashSessions.id, closedSessionId))
      .get();
    expect(closedSessionAfterVoid?.expectedBalance).toBe(70);

    // And no cash movement should be recorded for this void.
    const movements = await db
      .select()
      .from(cashMovements)
      .where(eq(cashMovements.referenceId, saleId))
      .all();
    expect(movements).toHaveLength(0);
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
    const cashSessionBeforeRefund = await db
      .select({
        expectedBalance: cashSessions.expectedBalance,
      })
      .from(cashSessions)
      .where(eq(cashSessions.id, activeCashSessionId))
      .get();
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

    const cashSessionAfterRefund = await db
      .select({
        expectedBalance: cashSessions.expectedBalance,
      })
      .from(cashSessions)
      .where(eq(cashSessions.id, activeCashSessionId))
      .get();
    expect(cashSessionAfterRefund?.expectedBalance).toBeCloseTo(
      cashSessionBeforeRefund?.expectedBalance ?? 0
    );

    const refundCashMovement = await db
      .select()
      .from(cashMovements)
      .where(and(eq(cashMovements.referenceId, created.id), eq(cashMovements.type, 'refund')))
      .all();
    expect(refundCashMovement).toHaveLength(1);
    expect(refundCashMovement[0]).toMatchObject({
      sessionId: activeCashSessionId,
      amount: created.total,
      note: `Refunded sale ${created.saleNumber}`,
      createdBy: userId,
    });
  });

  it('applies per-line discount percentage to both subtotal and VAT extraction', async () => {
    // Validates that a 10% per-line discount reduces the effective price before
    // VAT extraction so the cashier total, subtotal, and tax are all consistent.
    const db = getDatabase();
    const productId = nanoid();
    const now = new Date().toISOString();

    await db.insert(products).values({
      id: productId,
      tenantId,
      name: 'Discounted Water',
      sku: 'DISC-01',
      price: 1190,         // $11.90 price (19% VAT-inclusive)
      price2: 1190,
      price3: 1190,
      cost: 500,
      marginPercent1: 0,
      marginPercent2: 0,
      marginPercent3: 0,
      marginAmount1: 0,
      marginAmount2: 0,
      marginAmount3: 0,
      taxRate: 19,
      initialCost: 500,
      stock: 10,
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
      price: 1190,
      isBase: true,
      createdAt: now,
      updatedAt: now,
    });

    const caller = appRouter.createCaller(createTestContext());
    const result = await caller.sales.create({
      items: [
        {
          productId,
          unitId: baseUnitId,
          quantity: 1,
          unitPrice: 1190,
          discount: 10,      // 10% discount → effective price = $1,071
        },
      ],
      paymentMethod: 'cash',
      paymentStatus: 'pending',
      status: 'completed',
      amountReceived: 1100,
      discountAmount: 0,
    });

    // Effective VAT-inclusive price = 1190 * (1 - 0.10) = 1071
    // Subtotal (ex-VAT) = 1071 / 1.19 ≈ 900
    // Tax = 1071 - 900 ≈ 171
    expect(result.total).toBeCloseTo(1071, 0);
    expect(result.subtotal).toBeCloseTo(900, 0);
    expect(result.taxAmount).toBeCloseTo(171, 0);
    expect(result.change).toBeCloseTo(29, 0);

    // Stock must decrement by 1 (base equivalence)
    const updatedProduct = await db.select().from(products).where(eq(products.id, productId)).get();
    expect(updatedProduct?.stock).toBe(9);

    // Sale item must record the discount
    const storedItems = await db.select().from(saleItems).where(eq(saleItems.saleId, result.id)).all();
    expect(storedItems).toHaveLength(1);
    expect(storedItems[0]?.discount).toBeCloseTo(10);
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Phase 2 API-103 — sales drive `inventory_balances`
  // ──────────────────────────────────────────────────────────────────────────

  describe('inventory_balances integration (Phase 2 API-103)', () => {
    async function createBalanceTrackedProduct(overrides: {
      name: string;
      sku: string;
      barcode: string;
      stock: number;
    }) {
      const db = getDatabase();
      const productId = nanoid();
      const now = new Date().toISOString();
      await db.insert(products).values({
        id: productId,
        tenantId,
        name: overrides.name,
        sku: overrides.sku,
        barcode: overrides.barcode,
        price: 10,
        price2: 10,
        price3: 10,
        cost: 5,
        initialCost: 5,
        marginPercent1: 0,
        marginPercent2: 0,
        marginPercent3: 0,
        marginAmount1: 0,
        marginAmount2: 0,
        marginAmount3: 0,
        taxRate: 0,
        stock: overrides.stock,
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
      return productId;
    }

    it('decrements the active site balance when a sale completes', async () => {
      const caller = appRouter.createCaller(createTestContext());
      const productId = await createBalanceTrackedProduct({
        name: 'Balance Sale Cable',
        sku: 'BAL-SALE-CABLE',
        barcode: 'BAL-SALE-10001',
        stock: 20,
      });

      const before = await caller.inventory.listBalancesBySite({ siteId });
      expect(before.items.find(item => item.productId === productId)?.onHand).toBe(20);

      await caller.sales.create({
        items: [
          { productId, unitId: baseUnitId, quantity: 3, unitPrice: 10, discount: 0 },
        ],
        paymentMethod: 'cash',
        paymentStatus: 'paid',
        status: 'completed',
        amountReceived: 30,
        discountAmount: 0,
      });

      const after = await caller.inventory.listBalancesBySite({ siteId });
      expect(after.items.find(item => item.productId === productId)?.onHand).toBe(17);
    });

    it('credits the site balance back when a sale is refunded', async () => {
      const caller = appRouter.createCaller(createTestContext());
      const productId = await createBalanceTrackedProduct({
        name: 'Balance Refund Bolt',
        sku: 'BAL-REFUND-BOLT',
        barcode: 'BAL-SALE-10002',
        stock: 10,
      });

      const sale = await caller.sales.create({
        items: [
          { productId, unitId: baseUnitId, quantity: 4, unitPrice: 10, discount: 0 },
        ],
        paymentMethod: 'cash',
        paymentStatus: 'paid',
        status: 'completed',
        amountReceived: 40,
        discountAmount: 0,
      });

      const afterSale = await caller.inventory.listBalancesBySite({ siteId });
      expect(afterSale.items.find(item => item.productId === productId)?.onHand).toBe(6);

      await caller.sales.returnSale({ id: sale.id, reason: 'customer return' });

      const afterRefund = await caller.inventory.listBalancesBySite({ siteId });
      expect(afterRefund.items.find(item => item.productId === productId)?.onHand).toBe(10);
    });

    it('credits the site balance back when a sale is voided', async () => {
      const caller = appRouter.createCaller(createTestContext());
      const productId = await createBalanceTrackedProduct({
        name: 'Balance Void Widget',
        sku: 'BAL-VOID-WIDGET',
        barcode: 'BAL-SALE-10003',
        stock: 8,
      });

      const sale = await caller.sales.create({
        items: [
          { productId, unitId: baseUnitId, quantity: 2, unitPrice: 10, discount: 0 },
        ],
        paymentMethod: 'cash',
        paymentStatus: 'paid',
        status: 'completed',
        amountReceived: 20,
        discountAmount: 0,
      });

      const afterSale = await caller.inventory.listBalancesBySite({ siteId });
      expect(afterSale.items.find(item => item.productId === productId)?.onHand).toBe(6);

      await caller.sales.void({ id: sale.id, reason: 'wrong customer' });

      const afterVoid = await caller.inventory.listBalancesBySite({ siteId });
      expect(afterVoid.items.find(item => item.productId === productId)?.onHand).toBe(8);
    });

    it('keeps balance write symmetric with legacy `products.stock` updates', async () => {
      const caller = appRouter.createCaller(createTestContext());
      const productId = await createBalanceTrackedProduct({
        name: 'Balance Parity Part',
        sku: 'BAL-PARITY-PART',
        barcode: 'BAL-SALE-10004',
        stock: 15,
      });

      await caller.sales.create({
        items: [
          { productId, unitId: baseUnitId, quantity: 6, unitPrice: 10, discount: 0 },
        ],
        paymentMethod: 'cash',
        paymentStatus: 'paid',
        status: 'completed',
        amountReceived: 60,
        discountAmount: 0,
      });

      const db = getDatabase();
      const product = await db
        .select({ stock: products.stock })
        .from(products)
        .where(eq(products.id, productId))
        .get();
      expect(product?.stock).toBe(9);

      const result = await caller.inventory.listBalancesBySite({ siteId });
      const balance = result.items.find(item => item.productId === productId);
      expect(balance?.onHand).toBe(9);
    });

    it('debits the cash session site even when the sale sequential falls back to another site', async () => {
      const primaryCaller = appRouter.createCaller(createTestContext());
      const db = getDatabase();
      const secondarySiteId = nanoid();
      const mainSite = await db
        .select()
        .from(sites)
        .where(eq(sites.id, siteId))
        .get();

      if (!mainSite) {
        throw new Error('Expected seeded main site');
      }

      await db.insert(sites).values({
        id: secondarySiteId,
        tenantId,
        companyId: mainSite.companyId,
        name: 'Fallback Sequential Site',
        address: null,
        phone: null,
        isActive: true,
        createdAt: new Date(Date.now() + 60_000).toISOString(),
        updatedAt: new Date(Date.now() + 60_000).toISOString(),
      });

      const productId = await createBalanceTrackedProduct({
        name: 'Balance Fallback Site Part',
        sku: 'BAL-FALLBACK-SITE',
        barcode: 'BAL-SALE-10005',
        stock: 5,
      });

      await primaryCaller.transfers.create({
        fromSiteId: siteId,
        toSiteId: secondarySiteId,
        items: [{ productId, quantity: 2 }],
      });

      const secondaryCaller = appRouter.createCaller(createTestContextForSite(secondarySiteId));
      await secondaryCaller.cashSessions.open({
        registerName: 'Branch register',
        openingFloat: 100,
        denominations: [{ value: 100, count: 1 }],
      });

      await secondaryCaller.sales.create({
        items: [
          { productId, unitId: baseUnitId, quantity: 1, unitPrice: 10, discount: 0 },
        ],
        paymentMethod: 'cash',
        paymentStatus: 'paid',
        status: 'completed',
        amountReceived: 10,
        discountAmount: 0,
      });

      const primaryBalances = await primaryCaller.inventory.listBalancesBySite({ siteId });
      expect(primaryBalances.items.find(item => item.productId === productId)?.onHand).toBe(3);

      const secondaryBalances = await primaryCaller.inventory.listBalancesBySite({
        siteId: secondarySiteId,
      });
      expect(secondaryBalances.items.find(item => item.productId === productId)?.onHand).toBe(1);
    });

    it('rejects a sale when the active site has no balance for the product even if tenant stock exists', async () => {
      const db = getDatabase();
      const secondarySiteId = nanoid();
      const mainSite = await db
        .select()
        .from(sites)
        .where(eq(sites.id, siteId))
        .get();

      if (!mainSite) {
        throw new Error('Expected seeded main site');
      }

      await db.insert(sites).values({
        id: secondarySiteId,
        tenantId,
        companyId: mainSite.companyId,
        name: 'No Balance Sale Site',
        address: null,
        phone: null,
        isActive: true,
        createdAt: new Date(Date.now() + 120_000).toISOString(),
        updatedAt: new Date(Date.now() + 120_000).toISOString(),
      });

      const productId = await createBalanceTrackedProduct({
        name: 'No Site Balance Part',
        sku: 'BAL-NO-SITE-STOCK',
        barcode: 'BAL-SALE-10006',
        stock: 7,
      });

      const secondaryCaller = appRouter.createCaller(createTestContextForSite(secondarySiteId));
      await secondaryCaller.cashSessions.open({
        registerName: 'No balance register',
        openingFloat: 50,
        denominations: [{ value: 50, count: 1 }],
      });

      await expect(
        secondaryCaller.sales.create({
          items: [
            { productId, unitId: baseUnitId, quantity: 1, unitPrice: 10, discount: 0 },
          ],
          paymentMethod: 'cash',
          paymentStatus: 'paid',
          status: 'completed',
          amountReceived: 10,
          discountAmount: 0,
        })
      ).rejects.toMatchObject<Partial<TRPCError>>({
        code: 'CONFLICT',
      });

      const primaryBalances = await appRouter
        .createCaller(createTestContext())
        .inventory.listBalancesBySite({ siteId });
      expect(primaryBalances.items.find(item => item.productId === productId)?.onHand).toBe(7);

      const secondaryBalances = await appRouter
        .createCaller(createTestContext())
        .inventory.listBalancesBySite({ siteId: secondarySiteId });
      expect(secondaryBalances.items.find(item => item.productId === productId)?.onHand).toBe(0);
    });
  });

  // ─── Phase 2 Tier-2 step 5 — split payments / multi-tender ───────────────

  describe('split payments', () => {
    async function createPaymentTestProduct(overrides: {
      name: string;
      sku: string;
      barcode: string;
      price: number;
      stock: number;
    }) {
      const db = getDatabase();
      const productId = nanoid();
      const now = new Date().toISOString();
      await db.insert(products).values({
        id: productId,
        tenantId,
        name: overrides.name,
        sku: overrides.sku,
        barcode: overrides.barcode,
        price: overrides.price,
        price2: overrides.price,
        price3: overrides.price,
        cost: overrides.price * 0.5,
        initialCost: overrides.price * 0.5,
        marginPercent1: 0,
        marginPercent2: 0,
        marginPercent3: 0,
        marginAmount1: 0,
        marginAmount2: 0,
        marginAmount3: 0,
        taxRate: 0,
        stock: overrides.stock,
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
        price: overrides.price,
        isBase: true,
        createdAt: now,
        updatedAt: now,
      });
      return productId;
    }

    it('legacy single-tender input still persists one payment row', async () => {
      const caller = appRouter.createCaller(createTestContext());
      const productId = await createPaymentTestProduct({
        name: 'Payment Legacy',
        sku: 'PAY-LEGACY',
        barcode: 'PAY-10001',
        price: 10,
        stock: 10,
      });

      const result = await caller.sales.create({
        items: [
          { productId, unitId: baseUnitId, quantity: 2, unitPrice: 10, discount: 0 },
        ],
        paymentMethod: 'cash',
        paymentStatus: 'paid',
        status: 'completed',
        amountReceived: 25,
        discountAmount: 0,
      });

      const db = getDatabase();
      const payments = await db
        .select()
        .from(salePayments)
        .where(eq(salePayments.saleId, result.id))
        .all();

      expect(payments).toHaveLength(1);
      expect(payments[0]?.method).toBe('cash');
      expect(payments[0]?.amount).toBe(20); // capped at total, 5 of change
      expect(result.change).toBeCloseTo(5);
    });

    it('split cash + card sums to the sale total and persists both rows', async () => {
      const caller = appRouter.createCaller(createTestContext());
      const productId = await createPaymentTestProduct({
        name: 'Payment Split',
        sku: 'PAY-SPLIT',
        barcode: 'PAY-10002',
        price: 30,
        stock: 5,
      });

      const result = await caller.sales.create({
        items: [
          { productId, unitId: baseUnitId, quantity: 1, unitPrice: 30, discount: 0 },
        ],
        paymentMethod: 'cash',
        paymentStatus: 'paid',
        status: 'completed',
        discountAmount: 0,
        payments: [
          { method: 'cash', amount: 10 },
          { method: 'card', amount: 20, reference: 'AUTH-12345' },
        ],
      });

      const db = getDatabase();
      const rows = await db
        .select()
        .from(salePayments)
        .where(eq(salePayments.saleId, result.id))
        .all();

      expect(rows).toHaveLength(2);
      expect(rows.find(row => row.method === 'cash')?.amount).toBe(10);
      expect(rows.find(row => row.method === 'card')?.amount).toBe(20);
      expect(rows.find(row => row.method === 'card')?.reference).toBe('AUTH-12345');
      expect(result.paymentStatus).toBe('paid');
      // Dominant tender (card=20 > cash=10) propagates to the legacy column.
      expect(result.paymentMethod).toBe('card');
    });

    it('requires a customer when split payments include credit', async () => {
      const caller = appRouter.createCaller(createTestContext());
      const productId = await createPaymentTestProduct({
        name: 'Payment Credit Split',
        sku: 'PAY-CREDIT-SPLIT',
        barcode: 'PAY-10004',
        price: 30,
        stock: 5,
      });

      await expect(
        caller.sales.create({
          items: [
            { productId, unitId: baseUnitId, quantity: 1, unitPrice: 30, discount: 0 },
          ],
          paymentMethod: 'cash',
          paymentStatus: 'paid',
          status: 'completed',
          discountAmount: 0,
          payments: [
            { method: 'cash', amount: 10 },
            { method: 'credit', amount: 20 },
          ],
        })
      ).rejects.toMatchObject<Partial<TRPCError>>({
        code: 'BAD_REQUEST',
      });
    });

    it('rejects a split payment whose amounts do not sum to the total', async () => {
      const caller = appRouter.createCaller(createTestContext());
      const productId = await createPaymentTestProduct({
        name: 'Payment Mismatch',
        sku: 'PAY-MISMATCH',
        barcode: 'PAY-10003',
        price: 40,
        stock: 5,
      });

      await expect(
        caller.sales.create({
          items: [
            { productId, unitId: baseUnitId, quantity: 1, unitPrice: 40, discount: 0 },
          ],
          paymentMethod: 'cash',
          paymentStatus: 'paid',
          status: 'completed',
          discountAmount: 0,
          payments: [
            { method: 'cash', amount: 20 },
            { method: 'card', amount: 19 }, // Σ=39, total=40
          ],
        })
      ).rejects.toMatchObject<Partial<TRPCError>>({
        code: 'BAD_REQUEST',
      });

      // No sale should have been persisted at all for this product (the
      // create transaction should have rolled back cleanly).
      const db = getDatabase();
      const productRows = await db
        .select()
        .from(saleItems)
        .where(eq(saleItems.productId, productId))
        .all();
      expect(productRows).toHaveLength(0);
    });

    it('drives cash-movement from the sum of cash-method tenders only', async () => {
      const caller = appRouter.createCaller(createTestContext());
      const db = getDatabase();
      const productId = await createPaymentTestProduct({
        name: 'Payment Cash Component',
        sku: 'PAY-CASH',
        barcode: 'PAY-10006',
        price: 50,
        stock: 5,
      });

      const sessionBefore = await db
        .select({ expected: cashSessions.expectedBalance })
        .from(cashSessions)
        .where(eq(cashSessions.id, activeCashSessionId))
        .get();

      await caller.sales.create({
        items: [
          { productId, unitId: baseUnitId, quantity: 1, unitPrice: 50, discount: 0 },
        ],
        paymentMethod: 'cash',
        paymentStatus: 'paid',
        status: 'completed',
        discountAmount: 0,
        payments: [
          { method: 'cash', amount: 15 },
          { method: 'transfer', amount: 35 },
        ],
      });

      const sessionAfter = await db
        .select({ expected: cashSessions.expectedBalance })
        .from(cashSessions)
        .where(eq(cashSessions.id, activeCashSessionId))
        .get();

      // Cash session balance should rise by exactly the cash tender (15),
      // not the full total (50) or the transfer piece.
      expect(sessionAfter?.expected).toBeCloseTo((sessionBefore?.expected ?? 0) + 15);
    });

    it('sales.getById returns the payments array for split and legacy sales', async () => {
      const caller = appRouter.createCaller(createTestContext());
      const productId = await createPaymentTestProduct({
        name: 'Payment GetById',
        sku: 'PAY-GETBYID',
        barcode: 'PAY-10005',
        price: 60,
        stock: 5,
      });

      const created = await caller.sales.create({
        items: [
          { productId, unitId: baseUnitId, quantity: 1, unitPrice: 60, discount: 0 },
        ],
        paymentMethod: 'cash',
        paymentStatus: 'paid',
        status: 'completed',
        discountAmount: 0,
        payments: [
          { method: 'cash', amount: 20 },
          { method: 'card', amount: 40, reference: 'REF-9' },
        ],
      });

      const detail = await caller.sales.getById({ id: created.id });
      expect(detail.payments).toHaveLength(2);
      expect(
        detail.payments.map(p => ({ method: p.method, amount: p.amount, reference: p.reference }))
      ).toEqual(
        expect.arrayContaining([
          { method: 'cash', amount: 20, reference: null },
          { method: 'card', amount: 40, reference: 'REF-9' },
        ])
      );
    });
  });
});
