import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { and, asc, eq, inArray } from 'drizzle-orm';
import { nanoid } from 'nanoid';

import { createServer, type PuntovivoServer } from '../index.js';
import { getDatabase } from '../db/index.js';
import {
  cashMovements,
  cashSessions,
  customerLedgerEntries,
  customers,
  inventoryBalances,
  inventoryLots,
  operationEffects,
  operationEvents,
  productSerials,
  products,
  saleItemLots,
  saleItemSerials,
  saleItemTaxComponents,
  saleExchanges,
  saleItems,
  saleReturnItemLots,
  saleReturnItemSerials,
  saleReturnItemTaxComponents,
  saleReturnItems,
  saleReturnPaymentAllocations,
  saleReturns,
  salePayments,
  sales,
  sites,
  storeCreditAccounts,
  storeCreditMovements,
  syncOutbox,
  tenants,
  unitXProduct,
  units,
  users,
} from '../db/schema.js';
import { appRouter } from '../trpc/router.js';
import { registerDevice } from '../services/devices/devicesService.js';
import { completeSale } from '../application/sales/completeSale.js';
import { getSaleRecord } from '../application/sales/sale-read.js';
import { returnSale } from '../application/sales/partialReturnSale.js';
import type { CompleteSaleContext } from '../application/sales/types.js';
import { makeFreshContextFactory } from './utils/criticalCommandFixture.js';
import { getProductStockTotal } from '../services/inventory-balances.js';
import { resolveFiscalDocumentSnapshot } from '../services/fiscal/orchestrator/snapshots.js';
import { writeRestaurantSettings } from '../services/restaurant/settings.js';
import { computeProfitMarginReport } from '../services/reports/profit-margin.js';
import { getCompanionSnapshot } from '../services/companion/snapshot.js';
import { computeCashierPace } from '../services/cashier-pace.js';
import { computeDayCloseSummary } from '../services/reports/day-close.js';
import { computeCashierPace as computeCheckoutPace } from '../services/reports/cashier-pace.js';
import { recordOperationStart } from '../services/operation-journal/journal.js';
import { calendarDayInTimeZone } from '../services/reports/day-window.js';
import { resolveTenantLocale } from '../services/tenant-locale.js';

describe('normalized partial returns', () => {
  let server: PuntovivoServer;
  let tenantId: string;
  let userId: string;
  let siteId: string;
  let unitId: string;
  let deviceId: string;
  let callerContext: ReturnType<typeof makeFreshContextFactory>;

  function context(overrides: Partial<CompleteSaleContext> = {}): CompleteSaleContext {
    return {
      db: getDatabase(),
      tenantId,
      siteId,
      user: { id: userId, role: 'admin' },
      envelope: null,
      deviceId: null,
      ...overrides,
    };
  }

  async function seedProduct(input: {
    name: string;
    price?: number;
    stock?: number;
    tracksLots?: boolean;
    tracksSerials?: boolean;
  }) {
    const db = getDatabase();
    const id = nanoid();
    const now = new Date().toISOString();
    const price = input.price ?? 10;
    await db.insert(products).values({
      id,
      tenantId,
      name: input.name,
      sku: `${input.name}-${randomUUID()}`,
      price,
      price2: price,
      price3: price,
      cost: 4,
      marginPercent1: 0,
      marginPercent2: 0,
      marginPercent3: 0,
      marginAmount1: 0,
      marginAmount2: 0,
      marginAmount3: 0,
      taxRate: 0,
      initialCost: 4,
      minStock: 0,
      tracksLots: input.tracksLots ?? false,
      tracksSerials: input.tracksSerials ?? false,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(unitXProduct).values({
      id: nanoid(),
      productId: id,
      unitId,
      equivalence: 1,
      price,
      isBase: true,
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(inventoryBalances).values({
      id: nanoid(),
      tenantId,
      siteId,
      productId: id,
      onHand: input.stock ?? 10,
      reserved: 0,
      createdAt: now,
      updatedAt: now,
    });
    return id;
  }

  async function saleLineId(saleId: string) {
    const row = await getDatabase()
      .select({ id: saleItems.id })
      .from(saleItems)
      .where(eq(saleItems.saleId, saleId))
      .get();
    if (!row) throw new Error('Expected sale line');
    return row.id;
  }

  beforeAll(async () => {
    server = await createServer({ dbPath: ':memory:', verbose: false });
    const db = getDatabase();
    const user = await db.select().from(users).where(eq(users.email, 'admin@localhost')).get();
    if (!user) throw new Error('Expected seeded administrator');
    tenantId = user.tenantId;
    userId = user.id;
    const site = await db
      .select()
      .from(sites)
      .where(and(eq(sites.tenantId, tenantId), eq(sites.isActive, true)))
      .get();
    if (!site) throw new Error('Expected seeded site');
    siteId = site.id;
    const unit = await db
      .select()
      .from(units)
      .where(and(eq(units.tenantId, tenantId), eq(units.abbreviation, 'UND')))
      .get();
    if (!unit) throw new Error('Expected UND unit');
    unitId = unit.id;
    const device = await registerDevice(db, {
      tenantId,
      userId,
      kind: 'web',
      name: 'partial-returns.test',
    });
    deviceId = device.deviceId;
    callerContext = makeFreshContextFactory({
      db,
      serverApp: server.app,
      tenantId,
      userId,
      email: user.email,
      role: 'admin',
      siteId,
      deviceId: device.deviceId,
    });
    await appRouter.createCaller(callerContext()).cashSessions.open({
      registerName: 'Partial returns register',
      openingFloat: 500,
      denominations: [{ value: 100, count: 5 }],
    });
  });

  afterAll(async () => server.close());

  afterEach(async () => {
    await writeRestaurantSettings(getDatabase(), tenantId, { serviceChargeRate: 0 });
  });

  it('returns one line in two steps without duplicating stock or money', async () => {
    const caller = appRouter.createCaller(callerContext());
    const tenantLocale = await resolveTenantLocale(getDatabase(), tenantId);
    const businessDate = calendarDayInTimeZone(new Date(), tenantLocale.timezone);
    const [summaryBefore, dashboardBefore, companionBefore] = await Promise.all([
      caller.sales.summary(),
      caller.dashboard.summary(),
      getCompanionSnapshot(getDatabase(), { tenantId, date: businessDate }),
    ]);
    const activeSession = await getDatabase()
      .select({ id: cashSessions.id, openedAt: cashSessions.openedAt })
      .from(cashSessions)
      .where(
        and(
          eq(cashSessions.tenantId, tenantId),
          eq(cashSessions.cashierId, userId),
          eq(cashSessions.status, 'open')
        )
      )
      .get();
    if (!activeSession) throw new Error('Expected active partial-return session');
    const readDayClose = async () => {
      const closedAt = new Date().toISOString();
      await getDatabase()
        .update(cashSessions)
        .set({ status: 'closed', closedAt, actualCount: 500, overShort: 0 })
        .where(eq(cashSessions.id, activeSession.id))
        .run();
      try {
        return computeDayCloseSummary(getDatabase(), {
          tenantId,
          sessionId: activeSession.id,
          viewerUserId: userId,
          includeProfit: true,
          canViewAnyCashierSession: true,
        });
      } finally {
        await getDatabase()
          .update(cashSessions)
          .set({ status: 'open', closedAt: null, actualCount: null, overShort: null })
          .where(eq(cashSessions.id, activeSession.id))
          .run();
      }
    };
    const dayCloseBefore = await readDayClose();
    const productId = await seedProduct({ name: 'Partial widget', stock: 10 });
    const completed = await completeSale(context(), {
      mode: 'fresh',
      customerId: null,
      items: [{ productId, unitId, quantity: 3, unitPrice: 10, discount: 0 }],
      paymentMethod: 'cash',
      paymentStatus: 'paid',
      status: 'completed',
      amountReceived: 30,
      discountAmount: 0,
    });
    const saleId = (completed.sale as { id: string }).id;
    const lineId = await saleLineId(saleId);

    const partial = await returnSale(context(), {
      id: saleId,
      items: [{ saleItemId: lineId, quantity: 1 }],
      reason: 'one unit damaged',
    });
    expect(partial.sale.paymentStatus).toBe('partially_refunded');
    expect(getProductStockTotal(getDatabase(), tenantId, productId)).toBe(8);
    const [partialSummary, partialDashboard, partialCompanion] = await Promise.all([
      caller.sales.summary(),
      caller.dashboard.summary(),
      getCompanionSnapshot(getDatabase(), { tenantId, date: businessDate }),
    ]);
    expect(partialSummary.todaySalesTotal).toBe(summaryBefore.todaySalesTotal + 20);
    expect(partialSummary.transactionCount).toBe(summaryBefore.transactionCount + 1);
    expect(partialDashboard.stats.todayRevenue.value).toBe(
      dashboardBefore.stats.todayRevenue.value + 20
    );
    expect(partialDashboard.stats.todayOrders.value).toBe(
      dashboardBefore.stats.todayOrders.value + 1
    );
    expect(partialDashboard.recentSales.find(row => row.id === saleId)?.total).toBe(20);
    expect(partialCompanion.stats.revenue).toBe(companionBefore.stats.revenue + 20);
    expect(partialCompanion.stats.orders).toBe(companionBefore.stats.orders + 1);
    expect(partialCompanion.recentSales.find(row => row.id === saleId)?.total).toBe(20);
    const partialMargin = computeProfitMarginReport(getDatabase(), {
      tenantId,
      fromDate: '2000-01-01T00:00:00.000Z',
      toDate: '2100-01-01T00:00:00.000Z',
      limit: 500,
    });
    expect(partialMargin.products.find(row => row.productId === productId)).toMatchObject({
      quantity: 2,
      revenue: 20,
      cogs: 8,
    });
    const partialDayClose = await readDayClose();
    expect(partialDayClose.day.revenue).toBe(dayCloseBefore.day.revenue + 20);
    expect(partialDayClose.day.salesCount).toBe(dayCloseBefore.day.salesCount + 1);
    expect(partialDayClose.topProducts.find(row => row.productId === productId)).toMatchObject({
      revenue: 20,
      grossProfit: 12,
    });
    expect(
      computeCashierPace(getDatabase(), {
        tenantId,
        cashierId: userId,
        session: activeSession,
        nowIso: new Date(Date.parse(activeSession.openedAt) + 60_000).toISOString(),
      })
    ).toMatchObject({ salesCount: 1, itemsQty: 2 });
    await expect(
      computeCheckoutPace({
        db: getDatabase(),
        tenantId,
        siteId,
        cashierId: userId,
        now: new Date(Date.parse(activeSession.openedAt) + 60_000),
      })
    ).resolves.toMatchObject({ completedSales: 1, itemCount: 2 });
    const firstReturn = await getDatabase()
      .select()
      .from(saleReturns)
      .where(eq(saleReturns.saleId, saleId))
      .get();
    if (!firstReturn) throw new Error('Expected partial return header');
    const returnOutbox = await getDatabase()
      .select({ payload: syncOutbox.payload, payloadVersion: syncOutbox.payloadVersion })
      .from(syncOutbox)
      .where(
        and(eq(syncOutbox.entityType, 'sale_returns'), eq(syncOutbox.entityId, firstReturn.id))
      )
      .get();
    expect(returnOutbox?.payloadVersion).toBe(2);
    expect(returnOutbox?.payload).toMatchObject({
      aggregateVersion: 1,
      id: firstReturn.id,
      saleId,
      items: [{ saleItemId: lineId, quantity: 1, taxComponents: expect.any(Array) }],
      paymentAllocations: [{ destination: 'cash', amount: 10 }],
    });
    const fiscalSnapshot = await resolveFiscalDocumentSnapshot(getDatabase(), {
      tenantId,
      source: 'return',
      sourceId: firstReturn.id,
      saleId,
      sale: { subtotal: 30, taxAmount: 0, discountAmount: 0, total: 30 },
    });
    expect(fiscalSnapshot.amounts).toEqual({
      subtotal: 10,
      taxAmount: 0,
      discountAmount: 0,
      total: 10,
    });
    expect(fiscalSnapshot.lines).toMatchObject([{ quantity: 1, lineTotal: 10 }]);

    const final = await returnSale(context(), { id: saleId, reason: 'remaining units returned' });
    expect(final.sale.paymentStatus).toBe('refunded');
    expect(getProductStockTotal(getDatabase(), tenantId, productId)).toBe(10);
    const returns = await getDatabase()
      .select()
      .from(saleReturns)
      .where(eq(saleReturns.saleId, saleId))
      .orderBy(asc(saleReturns.createdAt), asc(saleReturns.id))
      .all();
    expect(returns).toHaveLength(2);
    expect(returns.map(row => row.refundAmount).sort((a, b) => a - b)).toEqual([10, 20]);
    const returnedLines = await getDatabase()
      .select({ quantity: saleReturnItems.quantity })
      .from(saleReturnItems)
      .where(eq(saleReturnItems.saleItemId, lineId))
      .all();
    expect(returnedLines.map(row => row.quantity).sort()).toEqual([1, 2]);
    const refundMovements = await getDatabase()
      .select({ amount: cashMovements.amount, referenceId: cashMovements.referenceId })
      .from(cashMovements)
      .where(and(eq(cashMovements.tenantId, tenantId), eq(cashMovements.type, 'refund')))
      .all();
    const relevant = refundMovements.filter(row => row.referenceId === saleId);
    expect(relevant.map(row => row.amount).sort((a, b) => a - b)).toEqual([10, 20]);
    const list = await caller.sales.list({ page: 1, perPage: 200 });
    const listed = list.items.filter(row => row.id === saleId);
    expect(listed).toHaveLength(1);
    expect(listed[0]).toMatchObject({
      paymentStatus: 'refunded',
      refundAmount: 30,
      returnId: expect.any(String),
      returnedAt: expect.any(String),
    });
    const [finalSummary, finalDashboard, finalCompanion] = await Promise.all([
      caller.sales.summary(),
      caller.dashboard.summary(),
      getCompanionSnapshot(getDatabase(), { tenantId, date: businessDate }),
    ]);
    expect(finalSummary.todaySalesTotal).toBe(summaryBefore.todaySalesTotal);
    expect(finalSummary.transactionCount).toBe(summaryBefore.transactionCount);
    expect(finalDashboard.stats.todayRevenue.value).toBe(dashboardBefore.stats.todayRevenue.value);
    expect(finalDashboard.stats.todayOrders.value).toBe(dashboardBefore.stats.todayOrders.value);
    expect(finalDashboard.recentSales.some(row => row.id === saleId)).toBe(false);
    expect(finalCompanion.stats).toEqual(companionBefore.stats);
    expect(finalCompanion.recentSales.some(row => row.id === saleId)).toBe(false);
    const finalDayClose = await readDayClose();
    expect(finalDayClose.day).toEqual(dayCloseBefore.day);
    expect(
      computeCashierPace(getDatabase(), {
        tenantId,
        cashierId: userId,
        session: activeSession,
        nowIso: new Date(Date.parse(activeSession.openedAt) + 60_000).toISOString(),
      })
    ).toMatchObject({ salesCount: 0, itemsQty: 0 });
    await expect(
      computeCheckoutPace({
        db: getDatabase(),
        tenantId,
        siteId,
        cashierId: userId,
        now: new Date(Date.parse(activeSession.openedAt) + 60_000),
      })
    ).resolves.toMatchObject({ completedSales: 0, itemCount: 0 });
  });

  it('keeps the original sale currency in the return operation after a tenant currency change', async () => {
    const db = getDatabase();
    const productId = await seedProduct({ name: 'Frozen currency return', stock: 2 });
    const completed = await completeSale(context(), {
      mode: 'fresh',
      items: [{ productId, unitId, quantity: 1, unitPrice: 10, discount: 0 }],
      paymentMethod: 'cash',
      paymentStatus: 'paid',
      status: 'completed',
      discountAmount: 0,
    });
    const saleId = (completed.sale as { id: string }).id;
    const sale = await db
      .select({ currencyCode: sales.currencyCode })
      .from(sales)
      .where(eq(sales.id, saleId))
      .get();
    expect(sale?.currencyCode).toBe('COP');

    const operationId = nanoid();
    const operation = await recordOperationStart(db, {
      tenantId,
      operationId,
      operationKind: 'sales.returnSale',
      deviceId,
      userId,
      requestHash: `frozen-currency-return:${saleId}`,
    });

    await db
      .update(tenants)
      .set({ defaultCurrencyCode: 'USD', updatedAt: new Date().toISOString() })
      .where(eq(tenants.id, tenantId))
      .run();
    try {
      await returnSale(context({ envelope: { operationId }, deviceId }), { id: saleId });
      const event = await db
        .select({ summary: operationEvents.summary })
        .from(operationEvents)
        .where(eq(operationEvents.id, operation.eventId))
        .get();
      expect(event?.summary).toMatchObject({ currencyCode: 'COP', originalSaleId: saleId });
    } finally {
      await db
        .update(tenants)
        .set({ defaultCurrencyCode: 'COP', updatedAt: new Date().toISOString() })
        .where(eq(tenants.id, tenantId))
        .run();
    }
  });

  it('restores zero-value merchandise after the paid balance was already refunded', async () => {
    const db = getDatabase();
    const paidProductId = await seedProduct({ name: 'Paid bundle item', price: 10, stock: 1 });
    const freeProductId = await seedProduct({ name: 'Free bundle item', price: 0, stock: 1 });
    const completed = await completeSale(context(), {
      mode: 'fresh',
      customerId: null,
      items: [
        { productId: paidProductId, unitId, quantity: 1, unitPrice: 10, discount: 0 },
        { productId: freeProductId, unitId, quantity: 1, unitPrice: 0, discount: 0 },
      ],
      paymentMethod: 'cash',
      paymentStatus: 'paid',
      status: 'completed',
      amountReceived: 10,
      discountAmount: 0,
    });
    const saleId = (completed.sale as { id: string }).id;
    const soldLines = await db
      .select({ id: saleItems.id, productId: saleItems.productId })
      .from(saleItems)
      .where(eq(saleItems.saleId, saleId))
      .all();
    const paidLineId = soldLines.find(line => line.productId === paidProductId)?.id;
    const freeLineId = soldLines.find(line => line.productId === freeProductId)?.id;
    if (!paidLineId || !freeLineId) throw new Error('Expected both bundle lines');

    const paidReturn = await returnSale(context(), {
      id: saleId,
      items: [{ saleItemId: paidLineId, quantity: 1 }],
    });
    expect(paidReturn.sale.paymentStatus).toBe('partially_refunded');
    expect(getProductStockTotal(db, tenantId, paidProductId)).toBe(1);
    expect(getProductStockTotal(db, tenantId, freeProductId)).toBe(0);

    const freeReturn = await returnSale(context(), {
      id: saleId,
      items: [{ saleItemId: freeLineId, quantity: 1 }],
    });
    expect(freeReturn.sale.paymentStatus).toBe('refunded');
    expect(getProductStockTotal(db, tenantId, freeProductId)).toBe(1);
    const headers = await db
      .select({ refundAmount: saleReturns.refundAmount })
      .from(saleReturns)
      .where(and(eq(saleReturns.tenantId, tenantId), eq(saleReturns.saleId, saleId)))
      .all();
    expect(headers.map(row => row.refundAmount).sort((a, b) => a - b)).toEqual([0, 10]);
    const cashRefunds = await db
      .select({ amount: cashMovements.amount })
      .from(cashMovements)
      .where(
        and(
          eq(cashMovements.tenantId, tenantId),
          eq(cashMovements.referenceId, saleId),
          eq(cashMovements.type, 'refund')
        )
      )
      .all();
    expect(cashRefunds).toEqual([{ amount: 10 }]);
  });

  it('refunds only tendered cash and cancels the untendered partial-sale balance', async () => {
    const db = getDatabase();
    const productId = await seedProduct({
      name: 'Partial-payment return item',
      price: 50,
      stock: 2,
    });
    const completed = await completeSale(context(), {
      mode: 'fresh',
      customerId: null,
      items: [{ productId, unitId, quantity: 2, unitPrice: 50, discount: 0 }],
      paymentMethod: 'cash',
      paymentStatus: 'partial',
      status: 'completed',
      amountReceived: 40,
      discountAmount: 0,
    });
    const saleId = (completed.sale as { id: string }).id;

    const returned = await returnSale(context(), { id: saleId });
    expect(returned.sale.paymentStatus).toBe('refunded');
    expect(getProductStockTotal(db, tenantId, productId)).toBe(2);
    const header = await db
      .select({ id: saleReturns.id, refundAmount: saleReturns.refundAmount })
      .from(saleReturns)
      .where(and(eq(saleReturns.tenantId, tenantId), eq(saleReturns.saleId, saleId)))
      .get();
    if (!header) throw new Error('Expected partial-payment return');
    const allocations = await db
      .select({
        destination: saleReturnPaymentAllocations.destination,
        amount: saleReturnPaymentAllocations.amount,
        salePaymentId: saleReturnPaymentAllocations.salePaymentId,
      })
      .from(saleReturnPaymentAllocations)
      .where(
        and(
          eq(saleReturnPaymentAllocations.tenantId, tenantId),
          eq(saleReturnPaymentAllocations.saleReturnId, header.id)
        )
      )
      .all();
    expect(header.refundAmount).toBe(100);
    expect(allocations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ destination: 'cash', amount: 40 }),
        { destination: 'receivable', amount: 60, salePaymentId: null },
      ])
    );
    expect(
      await db
        .select({ amount: cashMovements.amount })
        .from(cashMovements)
        .where(
          and(
            eq(cashMovements.tenantId, tenantId),
            eq(cashMovements.referenceId, saleId),
            eq(cashMovements.type, 'refund')
          )
        )
        .all()
    ).toEqual([{ amount: 40 }]);
    expect(
      await db
        .select({ id: customerLedgerEntries.id })
        .from(customerLedgerEntries)
        .where(
          and(
            eq(customerLedgerEntries.tenantId, tenantId),
            eq(customerLedgerEntries.referenceSaleId, saleId),
            eq(customerLedgerEntries.kind, 'adjustment')
          )
        )
        .all()
    ).toEqual([]);
  });

  it('fails before committing when frozen tax components no longer match the sale line', async () => {
    const db = getDatabase();
    const productId = await seedProduct({ name: 'Corrupt tax snapshot widget', stock: 1 });
    const completed = await completeSale(context(), {
      mode: 'fresh',
      customerId: null,
      items: [{ productId, unitId, quantity: 1, unitPrice: 10, discount: 0 }],
      paymentMethod: 'cash',
      paymentStatus: 'paid',
      status: 'completed',
      amountReceived: 10,
      discountAmount: 0,
    });
    const saleId = (completed.sale as { id: string }).id;
    const lineId = await saleLineId(saleId);
    await db
      .update(saleItemTaxComponents)
      .set({ taxAmount: 1 })
      .where(
        and(
          eq(saleItemTaxComponents.tenantId, tenantId),
          eq(saleItemTaxComponents.saleItemId, lineId)
        )
      )
      .run();

    await expect(returnSale(context(), { id: saleId })).rejects.toMatchObject({
      cause: { errorCode: 'SALE_RETURN_TAX_COMPONENT_MISMATCH' },
    });
    expect(
      await db
        .select({ id: saleReturns.id })
        .from(saleReturns)
        .where(and(eq(saleReturns.tenantId, tenantId), eq(saleReturns.saleId, saleId)))
        .all()
    ).toEqual([]);
    expect(getProductStockTotal(db, tenantId, productId)).toBe(0);

    // Keep this shared integration database internally consistent for the
    // remaining report assertions in the file.
    await db
      .update(saleItemTaxComponents)
      .set({ taxAmount: 0 })
      .where(
        and(
          eq(saleItemTaxComponents.tenantId, tenantId),
          eq(saleItemTaxComponents.saleItemId, lineId)
        )
      )
      .run();
  });

  it('reconciles multi-component tax cents across successive partial returns', async () => {
    const db = getDatabase();
    const productId = await seedProduct({ name: 'Tiny multi-tax service', price: 1, stock: 3 });
    const completed = await completeSale(context(), {
      mode: 'fresh',
      customerId: null,
      items: [{ productId, unitId, quantity: 3, unitPrice: 1, discount: 0 }],
      paymentMethod: 'cash',
      paymentStatus: 'paid',
      status: 'completed',
      amountReceived: 3,
      discountAmount: 0,
    });
    const saleId = (completed.sale as { id: string }).id;
    const lineId = await saleLineId(saleId);
    const payment = await db
      .select({ id: salePayments.id })
      .from(salePayments)
      .where(and(eq(salePayments.tenantId, tenantId), eq(salePayments.saleId, saleId)))
      .get();
    if (!payment) throw new Error('Expected original payment');

    const rewrittenAt = new Date().toISOString();
    await db
      .update(saleItems)
      .set({
        tracksStockSnapshot: false,
        unitPrice: 0.01,
        taxRate: 66.666667,
        taxAmount: 0.02,
        costAtSale: 0,
        total: 0.05,
      })
      .where(eq(saleItems.id, lineId))
      .run();
    await db
      .delete(saleItemTaxComponents)
      .where(
        and(
          eq(saleItemTaxComponents.tenantId, tenantId),
          eq(saleItemTaxComponents.saleItemId, lineId)
        )
      )
      .run();
    await db.insert(saleItemTaxComponents).values([
      {
        id: nanoid(),
        tenantId,
        saleItemId: lineId,
        componentKey: 'tiny-iva',
        taxKind: 'iva',
        taxRate: 33.333333,
        taxableAmount: 0.03,
        taxAmount: 0.01,
        position: 0,
        createdAt: rewrittenAt,
      },
      {
        id: nanoid(),
        tenantId,
        saleItemId: lineId,
        componentKey: 'tiny-inc',
        taxKind: 'inc',
        taxRate: 33.333334,
        taxableAmount: 0.03,
        taxAmount: 0.01,
        position: 1,
        createdAt: rewrittenAt,
      },
    ]);
    await db
      .update(sales)
      .set({
        subtotal: 0.03,
        taxAmount: 0.02,
        total: 0.05,
        paymentMethod: 'card',
        updatedAt: rewrittenAt,
      })
      .where(and(eq(sales.tenantId, tenantId), eq(sales.id, saleId)))
      .run();
    await db
      .update(salePayments)
      .set({ method: 'card', amount: 0.05, reference: 'tiny-original-charge' })
      .where(and(eq(salePayments.tenantId, tenantId), eq(salePayments.id, payment.id)))
      .run();

    for (let index = 0; index < 3; index += 1) {
      await returnSale(context(), {
        id: saleId,
        items: [{ saleItemId: lineId, quantity: 1 }],
        externalReferences: [{ salePaymentId: payment.id, reference: `tiny-refund-${index + 1}` }],
      });
    }

    const returnedLines = await db
      .select({ id: saleReturnItems.id, taxAmount: saleReturnItems.taxAmount })
      .from(saleReturnItems)
      .where(and(eq(saleReturnItems.tenantId, tenantId), eq(saleReturnItems.saleItemId, lineId)))
      .orderBy(asc(saleReturnItems.createdAt), asc(saleReturnItems.id))
      .all();
    const returnedComponents = await db
      .select({
        saleReturnItemId: saleReturnItemTaxComponents.saleReturnItemId,
        componentKey: saleReturnItemTaxComponents.componentKey,
        taxAmount: saleReturnItemTaxComponents.taxAmount,
      })
      .from(saleReturnItemTaxComponents)
      .where(
        and(
          eq(saleReturnItemTaxComponents.tenantId, tenantId),
          inArray(
            saleReturnItemTaxComponents.saleReturnItemId,
            returnedLines.map(line => line.id)
          )
        )
      )
      .all();
    for (const line of returnedLines) {
      const componentTax = returnedComponents
        .filter(component => component.saleReturnItemId === line.id)
        .reduce((sum, component) => Math.round((sum + component.taxAmount) * 100) / 100, 0);
      expect(componentTax).toBe(line.taxAmount);
    }
    expect(
      returnedComponents
        .filter(component => component.componentKey === 'tiny-iva')
        .reduce((sum, component) => Math.round((sum + component.taxAmount) * 100) / 100, 0)
    ).toBe(0.01);
    expect(
      returnedComponents
        .filter(component => component.componentKey === 'tiny-inc')
        .reduce((sum, component) => Math.round((sum + component.taxAmount) * 100) / 100, 0)
    ).toBe(0.01);
  });

  it('rejects a cross-site return before moving stock or money', async () => {
    const db = getDatabase();
    const originalSite = await db
      .select({ companyId: sites.companyId })
      .from(sites)
      .where(and(eq(sites.tenantId, tenantId), eq(sites.id, siteId)))
      .get();
    if (!originalSite) throw new Error('Expected original sale site');
    const otherSiteId = nanoid();
    const now = new Date().toISOString();
    await db.insert(sites).values({
      id: otherSiteId,
      tenantId,
      companyId: originalSite.companyId,
      name: `Return mismatch ${randomUUID()}`,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });
    const productId = await seedProduct({ name: 'Cross-site return widget', stock: 1 });
    const completed = await completeSale(context(), {
      mode: 'fresh',
      customerId: null,
      items: [{ productId, unitId, quantity: 1, unitPrice: 10, discount: 0 }],
      paymentMethod: 'cash',
      paymentStatus: 'paid',
      status: 'completed',
      amountReceived: 10,
      discountAmount: 0,
    });
    const saleId = (completed.sale as { id: string }).id;

    const otherSiteContext = makeFreshContextFactory({
      db,
      serverApp: server.app,
      tenantId,
      userId,
      email: 'admin@localhost',
      role: 'admin',
      siteId: otherSiteId,
      deviceId: callerContext().deviceId,
    });
    await expect(
      appRouter.createCaller(otherSiteContext()).sales.previewReturn({ id: saleId })
    ).rejects.toMatchObject({ cause: { errorCode: 'SALE_RETURN_SITE_MISMATCH' } });

    await expect(
      returnSale({ ...context(), siteId: otherSiteId }, { id: saleId })
    ).rejects.toMatchObject({
      cause: { errorCode: 'SALE_RETURN_SITE_MISMATCH' },
    });
    expect(getProductStockTotal(db, tenantId, productId)).toBe(0);
    expect(
      await db
        .select({ id: saleReturns.id })
        .from(saleReturns)
        .where(and(eq(saleReturns.tenantId, tenantId), eq(saleReturns.saleId, saleId)))
        .all()
    ).toEqual([]);
  });

  it('allocates restaurant discount, tip and service charge cumulatively into fiscal snapshots', async () => {
    await writeRestaurantSettings(getDatabase(), tenantId, { serviceChargeRate: 3.7 });
    const productId = await seedProduct({ name: 'Restaurant return item', stock: 3 });
    const completed = await completeSale(context(), {
      mode: 'fresh',
      customerId: null,
      items: [{ productId, unitId, quantity: 3, unitPrice: 10, discount: 0 }],
      paymentMethod: 'cash',
      paymentStatus: 'paid',
      status: 'completed',
      amountReceived: 30,
      discountAmount: 3,
      tipAmount: 2,
      tipMethod: 'fixed',
      serviceChargeAmount: 1,
      serviceChargeRate: 3.7,
    });
    const saleId = (completed.sale as { id: string }).id;
    const lineId = await saleLineId(saleId);

    await returnSale(context(), {
      id: saleId,
      items: [{ saleItemId: lineId, quantity: 1 }],
      reason: 'First guest item',
    });
    const firstHeader = await getDatabase()
      .select()
      .from(saleReturns)
      .where(eq(saleReturns.saleId, saleId))
      .get();
    if (!firstHeader) throw new Error('Expected first restaurant return');
    expect(firstHeader).toMatchObject({
      subtotal: 11,
      tipAmount: 0.67,
      serviceChargeAmount: 0.33,
      discountAmount: 1,
      refundAmount: 10,
    });
    const firstFiscal = await resolveFiscalDocumentSnapshot(getDatabase(), {
      tenantId,
      source: 'return',
      sourceId: firstHeader.id,
      saleId,
      sale: { subtotal: 30, taxAmount: 0, discountAmount: 3, total: 30 },
    });
    expect(firstFiscal.amounts).toEqual({
      subtotal: 11,
      taxAmount: 0,
      discountAmount: 1,
      total: 10,
    });
    expect(firstFiscal.lines).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ productId, quantity: 1, lineTotal: 10 }),
        expect.objectContaining({ productId: null, productName: 'Propina', lineTotal: 0.67 }),
        expect.objectContaining({
          productId: null,
          productName: 'Cargo por servicio',
          lineTotal: 0.33,
        }),
      ])
    );

    await returnSale(context(), { id: saleId, reason: 'Remaining guest items' });
    const headers = await getDatabase()
      .select()
      .from(saleReturns)
      .where(eq(saleReturns.saleId, saleId))
      .all();
    const finalHeader = headers.find(row => row.id !== firstHeader.id);
    expect(finalHeader).toMatchObject({
      subtotal: 22,
      tipAmount: 1.33,
      serviceChargeAmount: 0.67,
      discountAmount: 2,
      refundAmount: 20,
    });
    expect(headers.reduce((sum, row) => sum + row.tipAmount, 0)).toBe(2);
    expect(headers.reduce((sum, row) => sum + row.serviceChargeAmount, 0)).toBe(1);
    expect(headers.reduce((sum, row) => sum + row.discountAmount, 0)).toBe(3);
    expect(headers.reduce((sum, row) => sum + row.refundAmount, 0)).toBe(30);
  });

  it('does not turn a return with missing frozen lines into a full-sale fiscal credit note', async () => {
    const db = getDatabase();
    const productId = await seedProduct({ name: 'Return snapshot corruption guard', stock: 1 });
    const completed = await completeSale(context(), {
      mode: 'fresh',
      customerId: null,
      items: [{ productId, unitId, quantity: 1, unitPrice: 10, discount: 0 }],
      paymentMethod: 'cash',
      paymentStatus: 'paid',
      status: 'completed',
      amountReceived: 10,
      discountAmount: 0,
    });
    const saleId = (completed.sale as { id: string }).id;
    await returnSale(context(), { id: saleId });
    const header = await db
      .select()
      .from(saleReturns)
      .where(and(eq(saleReturns.tenantId, tenantId), eq(saleReturns.saleId, saleId)))
      .get();
    if (!header) throw new Error('Expected normalized return header');

    await db
      .delete(saleReturnItems)
      .where(
        and(eq(saleReturnItems.tenantId, tenantId), eq(saleReturnItems.saleReturnId, header.id))
      )
      .run();

    const snapshot = await resolveFiscalDocumentSnapshot(db, {
      tenantId,
      source: 'return',
      sourceId: header.id,
      saleId,
      sale: { subtotal: 10, taxAmount: 0, discountAmount: 0, total: 10 },
    });
    expect(snapshot.lines).toEqual([]);
    expect(snapshot.amounts).toEqual({
      subtotal: header.subtotal,
      taxAmount: header.taxAmount,
      discountAmount: header.discountAmount,
      total: header.refundAmount,
    });
  });

  it('reverses credit debt while issuing store credit only for paid tenders', async () => {
    const db = getDatabase();
    const customerId = nanoid();
    const now = new Date().toISOString();
    await db.insert(customers).values({
      id: customerId,
      tenantId,
      name: 'Mixed tender customer',
      creditLimit: 100,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });
    const productId = await seedProduct({ name: 'Mixed tender widget', stock: 2 });
    const completed = await completeSale(context(), {
      mode: 'fresh',
      customerId,
      items: [{ productId, unitId, quantity: 2, unitPrice: 10, discount: 0 }],
      payments: [
        { method: 'cash', amount: 8, reference: null },
        { method: 'credit', amount: 12, reference: null },
      ],
      paymentMethod: 'cash',
      paymentStatus: 'partial',
      status: 'completed',
      discountAmount: 0,
    });
    const saleId = (completed.sale as { id: string }).id;
    const lineId = await saleLineId(saleId);

    const operationId = nanoid();
    const operation = await recordOperationStart(db, {
      tenantId,
      operationId,
      operationKind: 'sales.returnSale',
      deviceId,
      userId,
      requestHash: `store-credit-return:${saleId}`,
    });
    await returnSale(context({ envelope: { operationId }, deviceId }), {
      id: saleId,
      items: [{ saleItemId: lineId, quantity: 1 }],
      destination: 'store_credit',
    });
    const allocations = await db
      .select()
      .from(saleReturnPaymentAllocations)
      .innerJoin(saleReturns, eq(saleReturnPaymentAllocations.saleReturnId, saleReturns.id))
      .where(eq(saleReturns.saleId, saleId))
      .all();
    expect(
      allocations.map(row => ({
        destination: row.sale_return_payment_allocations.destination,
        amount: row.sale_return_payment_allocations.amount,
      }))
    ).toEqual(
      expect.arrayContaining([
        { destination: 'store_credit', amount: 4 },
        { destination: 'receivable', amount: 6 },
      ])
    );
    const ledger = await db
      .select({ kind: customerLedgerEntries.kind, amount: customerLedgerEntries.amount })
      .from(customerLedgerEntries)
      .where(
        and(
          eq(customerLedgerEntries.tenantId, tenantId),
          eq(customerLedgerEntries.customerId, customerId),
          eq(customerLedgerEntries.referenceSaleId, saleId)
        )
      )
      .all();
    expect(ledger).toEqual(
      expect.arrayContaining([
        { kind: 'sale', amount: 12 },
        { kind: 'adjustment', amount: -6 },
      ])
    );
    const storeAccount = await db
      .select({ id: storeCreditAccounts.id, balance: storeCreditAccounts.balance })
      .from(storeCreditAccounts)
      .where(eq(storeCreditAccounts.customerId, customerId))
      .get();
    expect(storeAccount).toMatchObject({ balance: 4 });
    const storeMovement = await db
      .select({ id: storeCreditMovements.id, amount: storeCreditMovements.amount })
      .from(storeCreditMovements)
      .where(eq(storeCreditMovements.customerId, customerId))
      .get();
    expect(storeMovement).toMatchObject({ amount: 4 });
    expect(
      await db
        .select({ kind: operationEffects.kind, resourceType: operationEffects.resourceType })
        .from(operationEffects)
        .where(eq(operationEffects.operationEventId, operation.eventId))
        .all()
    ).toEqual(
      expect.arrayContaining([
        { kind: 'store_credit_movement', resourceType: 'store_credit_movements' },
      ])
    );
    expect(
      await db
        .select({ entityType: syncOutbox.entityType, entityId: syncOutbox.entityId })
        .from(syncOutbox)
        .where(
          and(
            eq(syncOutbox.tenantId, tenantId),
            inArray(syncOutbox.entityType, ['store_credit_accounts', 'store_credit_movements'])
          )
        )
        .all()
    ).toEqual(
      expect.arrayContaining([
        { entityType: 'store_credit_accounts', entityId: storeAccount?.id },
        { entityType: 'store_credit_movements', entityId: storeMovement?.id },
      ])
    );

    const sourceReturn = await db
      .select({ id: saleReturns.id })
      .from(saleReturns)
      .where(eq(saleReturns.saleId, saleId))
      .get();
    if (!sourceReturn) throw new Error('Expected source return');
    const returnAggregate = await db
      .select({ payload: syncOutbox.payload })
      .from(syncOutbox)
      .where(
        and(
          eq(syncOutbox.tenantId, tenantId),
          eq(syncOutbox.entityType, 'sale_returns'),
          eq(syncOutbox.entityId, sourceReturn.id)
        )
      )
      .get();
    expect(returnAggregate?.payload).not.toHaveProperty('storeCreditMovement');
    expect(
      await db
        .select({ id: syncOutbox.id })
        .from(syncOutbox)
        .where(
          and(
            eq(syncOutbox.tenantId, tenantId),
            eq(syncOutbox.entityType, 'store_credit_movements'),
            eq(syncOutbox.entityId, storeMovement!.id)
          )
        )
        .all()
    ).toHaveLength(1);
    const replacement = await completeSale(context(), {
      mode: 'fresh',
      customerId,
      sourceReturnId: sourceReturn.id,
      items: [{ productId, unitId, quantity: 1, unitPrice: 10, discount: 0 }],
      paymentMethod: 'cash',
      paymentStatus: 'paid',
      status: 'completed',
      amountReceived: 10,
      discountAmount: 0,
    });
    const exchange = await db
      .select()
      .from(saleExchanges)
      .where(eq(saleExchanges.saleReturnId, sourceReturn.id))
      .get();
    expect(exchange).toMatchObject({
      replacementSaleId: (replacement.sale as { id: string }).id,
    });
    const sourceAfterExchange = await getSaleRecord(db, tenantId, saleId);
    expect(
      sourceAfterExchange.returns.find(row => row.id === sourceReturn.id)?.exchange
    ).toMatchObject({
      replacementSaleId: (replacement.sale as { id: string }).id,
      replacementSaleNumber: (replacement.sale as { saleNumber: string }).saleNumber,
    });
    expect(
      await db
        .select({ entityType: syncOutbox.entityType, entityId: syncOutbox.entityId })
        .from(syncOutbox)
        .where(
          and(eq(syncOutbox.entityType, 'sale_exchanges'), eq(syncOutbox.entityId, exchange!.id))
        )
        .get()
    ).toEqual({ entityType: 'sale_exchanges', entityId: exchange!.id });

    const syncTargets = await db
      .select({ id: syncOutbox.id, entityType: syncOutbox.entityType })
      .from(syncOutbox)
      .where(
        and(
          eq(syncOutbox.tenantId, tenantId),
          inArray(syncOutbox.entityType, [
            'sale_returns',
            'sale_exchanges',
            'store_credit_accounts',
            'store_credit_movements',
          ]),
          inArray(syncOutbox.entityId, [
            sourceReturn.id,
            exchange!.id,
            storeAccount!.id,
            storeMovement!.id,
          ])
        )
      )
      .all();
    expect(syncTargets).toHaveLength(4);
    // Isolate this push from outbox evidence left by earlier cases in this
    // integration file; the target rows still exercise the real state machine.
    await db
      .update(syncOutbox)
      .set({ status: 'synced' })
      .where(eq(syncOutbox.tenantId, tenantId))
      .run();
    await db
      .update(syncOutbox)
      .set({ status: 'queued', attempts: 0, lastError: null })
      .where(
        inArray(
          syncOutbox.id,
          syncTargets.map(row => row.id)
        )
      )
      .run();
    const push = await appRouter.createCaller(callerContext()).sync.push({ limit: 50 });
    expect(push.processedIds).toEqual(expect.arrayContaining(syncTargets.map(row => row.id)));
    expect(push.errors).toEqual([]);
    expect(
      await db
        .select({
          syncStatus: storeCreditAccounts.syncStatus,
          syncVersion: storeCreditAccounts.syncVersion,
        })
        .from(storeCreditAccounts)
        .where(eq(storeCreditAccounts.id, storeAccount!.id))
        .get()
    ).toMatchObject({ syncStatus: 'synced', syncVersion: expect.any(Number) });
    expect(
      await db
        .select({ id: syncOutbox.id, status: syncOutbox.status })
        .from(syncOutbox)
        .where(
          inArray(
            syncOutbox.id,
            syncTargets.map(row => row.id)
          )
        )
        .all()
    ).toEqual(expect.arrayContaining(syncTargets.map(row => ({ id: row.id, status: 'synced' }))));
  });

  it('absorbs final cents deterministically across tiny split tenders', async () => {
    const db = getDatabase();
    const productId = await seedProduct({ name: 'Final-cent widget', price: 0.01, stock: 3 });
    const completed = await completeSale(context(), {
      mode: 'fresh',
      customerId: null,
      items: [{ productId, unitId, quantity: 3, unitPrice: 0.01, discount: 0 }],
      payments: [
        { method: 'cash', amount: 0.01, reference: null },
        { method: 'cash', amount: 0.01, reference: null },
        { method: 'cash', amount: 0.01, reference: null },
      ],
      paymentMethod: 'cash',
      paymentStatus: 'paid',
      status: 'completed',
      discountAmount: 0,
    });
    const saleId = (completed.sale as { id: string }).id;
    const lineId = await saleLineId(saleId);

    await returnSale(context(), {
      id: saleId,
      items: [{ saleItemId: lineId, quantity: 1 }],
    });
    const firstReturn = await db
      .select({ id: saleReturns.id })
      .from(saleReturns)
      .where(and(eq(saleReturns.tenantId, tenantId), eq(saleReturns.saleId, saleId)))
      .get();
    if (!firstReturn) throw new Error('Expected first final-cent return');
    const firstAllocations = await db
      .select({ amount: saleReturnPaymentAllocations.amount })
      .from(saleReturnPaymentAllocations)
      .where(eq(saleReturnPaymentAllocations.saleReturnId, firstReturn.id))
      .all();
    expect(firstAllocations.reduce((sum, row) => sum + row.amount, 0)).toBe(0.01);

    await returnSale(context(), { id: saleId });
    const allAllocations = await db
      .select({ amount: saleReturnPaymentAllocations.amount })
      .from(saleReturnPaymentAllocations)
      .innerJoin(saleReturns, eq(saleReturnPaymentAllocations.saleReturnId, saleReturns.id))
      .where(and(eq(saleReturns.tenantId, tenantId), eq(saleReturns.saleId, saleId)))
      .all();
    expect(allAllocations.reduce((sum, row) => sum + row.amount, 0)).toBeCloseTo(0.03, 8);
  });

  it('requires external evidence before claiming a card refund', async () => {
    const productId = await seedProduct({ name: 'Card widget', stock: 1 });
    const completed = await completeSale(context(), {
      mode: 'fresh',
      customerId: null,
      items: [{ productId, unitId, quantity: 1, unitPrice: 10, discount: 0 }],
      paymentMethod: 'card',
      paymentStatus: 'paid',
      status: 'completed',
      discountAmount: 0,
    });
    const saleId = (completed.sale as { id: string }).id;
    const preview = await appRouter
      .createCaller(callerContext())
      .sales.previewReturn({ id: saleId });
    expect(preview.allocations).toEqual([
      expect.objectContaining({ destination: 'external', amount: 10 }),
    ]);
    await expect(returnSale(context(), { id: saleId })).rejects.toMatchObject({
      cause: { errorCode: 'SALE_RETURN_EXTERNAL_REFERENCE_REQUIRED' },
    });
    const payment = await getDatabase()
      .select()
      .from(saleReturnPaymentAllocations)
      .where(eq(saleReturnPaymentAllocations.tenantId, tenantId))
      .all();
    const originalPayment = await getDatabase().query.salePayments.findFirst({
      where: (row, { eq }) => eq(row.saleId, saleId),
    });
    if (!originalPayment) throw new Error('Expected card payment');
    await returnSale(context(), {
      id: saleId,
      externalReferences: [{ salePaymentId: originalPayment.id, reference: 'processor-refund-1' }],
    });
    expect(payment.filter(row => row.saleReturnId === saleId)).toHaveLength(0);
    const allocation = await getDatabase()
      .select()
      .from(saleReturnPaymentAllocations)
      .where(eq(saleReturnPaymentAllocations.salePaymentId, originalPayment.id))
      .get();
    expect(allocation).toMatchObject({
      destination: 'external',
      amount: 10,
      externalReference: 'processor-refund-1',
    });
  });

  it('accepts provider evidence for a legacy card sale without sale_payments rows', async () => {
    const db = getDatabase();
    const productId = await seedProduct({ name: 'Legacy card widget', stock: 1 });
    const completed = await completeSale(context(), {
      mode: 'fresh',
      customerId: null,
      items: [{ productId, unitId, quantity: 1, unitPrice: 10, discount: 0 }],
      paymentMethod: 'card',
      paymentStatus: 'paid',
      status: 'completed',
      discountAmount: 0,
    });
    const saleId = (completed.sale as { id: string }).id;
    await db
      .delete(salePayments)
      .where(and(eq(salePayments.tenantId, tenantId), eq(salePayments.saleId, saleId)))
      .run();

    const caller = appRouter.createCaller(callerContext());
    const preview = await caller.sales.previewReturn({ id: saleId });
    expect(preview.allocations).toEqual([
      expect.objectContaining({
        salePaymentId: null,
        originalMethod: 'card',
        destination: 'external',
        amount: 10,
      }),
    ]);

    await caller.sales.returnSale({
      id: saleId,
      externalReferences: [{ salePaymentId: null, reference: 'legacy-provider-refund-1' }],
    });
    expect(
      await db
        .select({
          salePaymentId: saleReturnPaymentAllocations.salePaymentId,
          originalMethod: saleReturnPaymentAllocations.originalMethod,
          destination: saleReturnPaymentAllocations.destination,
          amount: saleReturnPaymentAllocations.amount,
          externalReference: saleReturnPaymentAllocations.externalReference,
        })
        .from(saleReturnPaymentAllocations)
        .innerJoin(saleReturns, eq(saleReturnPaymentAllocations.saleReturnId, saleReturns.id))
        .where(and(eq(saleReturns.tenantId, tenantId), eq(saleReturns.saleId, saleId)))
        .get()
    ).toEqual({
      salePaymentId: null,
      originalMethod: 'card',
      destination: 'external',
      amount: 10,
      externalReference: 'legacy-provider-refund-1',
    });
  });

  it('ignores a damaged foreign-tenant tax child when planning a later return', async () => {
    const db = getDatabase();
    const productId = await seedProduct({ name: 'Tenant-safe return widget', stock: 2 });
    const completed = await completeSale(context(), {
      mode: 'fresh',
      customerId: null,
      items: [{ productId, unitId, quantity: 2, unitPrice: 10, discount: 0 }],
      paymentMethod: 'cash',
      paymentStatus: 'paid',
      status: 'completed',
      amountReceived: 20,
      discountAmount: 0,
    });
    const saleId = (completed.sale as { id: string }).id;
    const lineId = await saleLineId(saleId);
    await returnSale(context(), {
      id: saleId,
      items: [{ saleItemId: lineId, quantity: 1 }],
    });
    const firstReturnLine = await db
      .select({ id: saleReturnItems.id })
      .from(saleReturnItems)
      .innerJoin(saleReturns, eq(saleReturnItems.saleReturnId, saleReturns.id))
      .where(and(eq(saleReturns.tenantId, tenantId), eq(saleReturns.saleId, saleId)))
      .get();
    if (!firstReturnLine) throw new Error('Expected first normalized return line');
    const foreignTenantId = nanoid();
    await db.insert(tenants).values({
      id: foreignTenantId,
      name: 'Foreign damaged child tenant',
      slug: `foreign-return-child-${randomUUID()}`,
    });
    await db.insert(saleReturnItemTaxComponents).values({
      id: nanoid(),
      tenantId: foreignTenantId,
      saleReturnItemId: firstReturnLine.id,
      componentKey: 'foreign:iva',
      vatRateId: null,
      taxKind: 'iva',
      taxRate: 0,
      taxableAmount: 0,
      taxAmount: 0,
      position: 1,
      createdAt: new Date().toISOString(),
    });

    await expect(returnSale(context(), { id: saleId })).resolves.toMatchObject({
      sale: { returnedAmount: 20, paymentStatus: 'refunded' },
    });
    expect(
      await db
        .select({ id: saleReturns.id })
        .from(saleReturns)
        .where(and(eq(saleReturns.tenantId, tenantId), eq(saleReturns.saleId, saleId)))
        .all()
    ).toHaveLength(2);
  });

  it('fails closed when lot or serial tracking is enabled after an untracked sale', async () => {
    const db = getDatabase();
    const cases = [
      {
        name: 'Later lot tracking',
        code: 'SALE_RETURN_LOT_TRACKING_CHANGED',
        enable: () => ({ tracksLots: true }),
      },
      {
        name: 'Later serial tracking',
        code: 'SALE_RETURN_SERIAL_TRACKING_CHANGED',
        enable: () => ({ tracksSerials: true }),
      },
    ] as const;

    for (const testCase of cases) {
      const productId = await seedProduct({ name: testCase.name, stock: 1 });
      const completed = await completeSale(context(), {
        mode: 'fresh',
        customerId: null,
        items: [{ productId, unitId, quantity: 1, unitPrice: 10, discount: 0 }],
        paymentMethod: 'cash',
        paymentStatus: 'paid',
        status: 'completed',
        amountReceived: 10,
        discountAmount: 0,
      });
      const saleId = (completed.sale as { id: string }).id;
      await db.update(products).set(testCase.enable()).where(eq(products.id, productId)).run();

      await expect(returnSale(context(), { id: saleId })).rejects.toMatchObject({
        cause: { errorCode: testCase.code },
      });
      expect(
        await db
          .select({ id: saleReturns.id })
          .from(saleReturns)
          .where(and(eq(saleReturns.tenantId, tenantId), eq(saleReturns.saleId, saleId)))
          .all()
      ).toHaveLength(0);
      expect(
        await db
          .select({ onHand: inventoryBalances.onHand })
          .from(inventoryBalances)
          .where(
            and(
              eq(inventoryBalances.tenantId, tenantId),
              eq(inventoryBalances.siteId, siteId),
              eq(inventoryBalances.productId, productId)
            )
          )
          .get()
      ).toEqual({ onHand: 0 });
    }
  });

  it('restores only selected lot and serial provenance without deleting the original sale evidence', async () => {
    const db = getDatabase();
    const now = new Date().toISOString();
    const lotProductId = await seedProduct({
      name: 'Lot widget',
      stock: 2,
      tracksLots: true,
    });
    const lotIds = [nanoid(), nanoid()];
    for (const [index, id] of lotIds.entries()) {
      await db.insert(inventoryLots).values({
        id,
        tenantId,
        siteId,
        productId: lotProductId,
        lotNumber: `LOT-${index + 1}-${randomUUID()}`,
        onHand: 1,
        unitCost: index === 0 ? 3 : 7,
        status: 'active',
        receivedAt: now,
        syncStatus: 'pending',
        syncVersion: 1,
        createdAt: now,
        updatedAt: now,
      });
    }
    const lotSale = await completeSale(context(), {
      mode: 'fresh',
      customerId: null,
      items: [{ productId: lotProductId, unitId, quantity: 2, unitPrice: 10, discount: 0 }],
      paymentMethod: 'cash',
      paymentStatus: 'paid',
      status: 'completed',
      amountReceived: 20,
      discountAmount: 0,
    });
    const lotSaleId = (lotSale.sale as { id: string }).id;
    const lotLineId = await saleLineId(lotSaleId);
    const consumed = await db
      .select()
      .from(saleItemLots)
      .where(eq(saleItemLots.saleItemId, lotLineId))
      .orderBy(asc(saleItemLots.id))
      .all();
    expect(consumed).toHaveLength(2);
    const expensiveLot = consumed.find(row => row.unitCost === 7);
    expect(expensiveLot).toBeDefined();
    await db.update(products).set({ tracksLots: false }).where(eq(products.id, lotProductId)).run();
    await expect(
      returnSale(context(), {
        id: lotSaleId,
        items: [
          {
            saleItemId: lotLineId,
            quantity: 1,
            lotAllocations: [{ saleItemLotId: expensiveLot!.id, quantity: 1 }],
          },
        ],
      })
    ).rejects.toMatchObject({
      cause: { errorCode: 'SALE_RETURN_LOT_TRACKING_CHANGED' },
    });
    expect(
      await db
        .select({ id: saleReturns.id })
        .from(saleReturns)
        .where(and(eq(saleReturns.tenantId, tenantId), eq(saleReturns.saleId, lotSaleId)))
        .all()
    ).toHaveLength(0);
    await db.update(products).set({ tracksLots: true }).where(eq(products.id, lotProductId)).run();
    await returnSale(context(), {
      id: lotSaleId,
      items: [
        {
          saleItemId: lotLineId,
          quantity: 1,
          lotAllocations: [{ saleItemLotId: expensiveLot!.id, quantity: 1 }],
        },
      ],
    });
    expect(
      await db.select().from(saleItemLots).where(eq(saleItemLots.saleItemId, lotLineId)).all()
    ).toHaveLength(2);
    expect(
      await db
        .select()
        .from(saleReturnItemLots)
        .where(eq(saleReturnItemLots.saleItemLotId, expensiveLot!.id))
        .all()
    ).toHaveLength(1);
    const returnedLotLine = await db
      .select({ costAmount: saleReturnItems.costAmount, unitCost: saleReturnItemLots.unitCost })
      .from(saleReturnItems)
      .innerJoin(saleReturnItemLots, eq(saleReturnItemLots.saleReturnItemId, saleReturnItems.id))
      .where(eq(saleReturnItems.saleItemId, lotLineId))
      .get();
    expect(returnedLotLine).toEqual({ costAmount: 7, unitCost: 7 });

    const serialProductId = await seedProduct({
      name: 'Serial widget',
      stock: 2,
      tracksSerials: true,
    });
    const serialIds = [nanoid(), nanoid()];
    for (const [index, id] of serialIds.entries()) {
      await db.insert(productSerials).values({
        id,
        tenantId,
        currentSiteId: siteId,
        productId: serialProductId,
        serialNumber: `SER-${index + 1}-${randomUUID()}`,
        status: 'in_stock',
        unitCost: 4,
        receivedAt: now,
        syncStatus: 'pending',
        syncVersion: 1,
        createdAt: now,
        updatedAt: now,
      });
    }
    const serialSale = await completeSale(context(), {
      mode: 'fresh',
      customerId: null,
      items: [
        {
          productId: serialProductId,
          unitId,
          quantity: 2,
          unitPrice: 10,
          discount: 0,
          serialIds,
        },
      ],
      paymentMethod: 'cash',
      paymentStatus: 'paid',
      status: 'completed',
      amountReceived: 20,
      discountAmount: 0,
    });
    const serialSaleId = (serialSale.sale as { id: string }).id;
    const serialLineId = await saleLineId(serialSaleId);
    await returnSale(context(), {
      id: serialSaleId,
      items: [{ saleItemId: serialLineId, quantity: 1, serialIds: [serialIds[0]!] }],
    });
    expect(
      await db
        .select({ id: saleItemSerials.id })
        .from(saleItemSerials)
        .where(eq(saleItemSerials.saleItemId, serialLineId))
        .all()
    ).toHaveLength(2);
    expect(
      await db
        .select({ id: saleReturnItemSerials.id })
        .from(saleReturnItemSerials)
        .innerJoin(saleReturnItems, eq(saleReturnItemSerials.saleReturnItemId, saleReturnItems.id))
        .where(eq(saleReturnItems.saleItemId, serialLineId))
        .all()
    ).toHaveLength(1);
    expect(
      await db
        .select({ id: productSerials.id, status: productSerials.status })
        .from(productSerials)
        .where(eq(productSerials.productId, serialProductId))
        .orderBy(asc(productSerials.id))
        .all()
    ).toEqual(
      expect.arrayContaining([
        { id: serialIds[0], status: 'returned' },
        { id: serialIds[1], status: 'sold' },
      ])
    );
  });
});
