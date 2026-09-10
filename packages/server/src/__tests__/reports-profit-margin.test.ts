/**
 * reports.profit.margin (margin / COGS over the sale_item_lots ledger).
 *
 * Verifies the correctness invariants that make the report trustworthy:
 * - COGS for a lot-tracked line comes from `sale_item_lots` (the real
 * per-lot cost), NOT the `cost_at_sale` snapshot.
 * - COGS for a non-lot line comes from `cost_at_sale × normalized quantity`.
 * - Sales and their frozen returns are booked in their own periods; fully
 * refunded tickets cancel only when both events are inside the window.
 * - Voided, draft, and out-of-range events are excluded.
 * - Tenant isolation and the manager/admin role gate.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { createServer, type PuntovivoServer } from '../index.js';
import { getDatabase } from '../db/index.js';
import {
  inventoryLots,
  products,
  saleItemLots,
  saleItems,
  saleReturnItems,
  saleReturns,
  sales,
  sites,
  tenants,
  users,
} from '../db/schema.js';
import { seedCommittedSaleSession } from './utils/cashSessionFixture.js';
import { computeProfitMarginReport } from '../services/reports/profit-margin.js';
import { roundMoney } from '../lib/money.js';
import { appRouter } from '../trpc/router.js';
import type { Context } from '../trpc/context.js';

let server: PuntovivoServer;
let tenantId: string;
let userId: string;

const RANGE_FROM = '2026-03-01T00:00:00.000Z';
const RANGE_TO = '2026-03-31T23:59:59.999Z';
const IN_RANGE_AT = '2026-03-15T14:00:00.000Z';
const OUT_OF_RANGE_AT = '2026-01-10T10:00:00.000Z';

const P_LOT = nanoid();
const P_PLAIN = nanoid();

function buildContext(role: 'admin' | 'manager' | 'cashier', tid = tenantId): Context {
  return {
    req: {
      server: server.app,
      headers: {},
      user: { userId, email: 'admin@localhost', role, tenantId: tid },
      jwtVerify: async () => {},
    } as unknown as Context['req'],
    res: {} as unknown as Context['res'],
    db: getDatabase(),
    user: { id: userId, email: 'admin@localhost', role, tenantId: tid },
    tenantId: tid,
    siteId: null,
  };
}

const marginInput = { fromDate: RANGE_FROM, toDate: RANGE_TO, limit: 50 };

describe('reports.profit.margin', () => {
  beforeAll(async () => {
    server = await createServer({ dbPath: ':memory:', verbose: false });
    const db = getDatabase();

    const admin = await db.select().from(users).where(eq(users.email, 'admin@localhost')).get();
    if (!admin) throw new Error('Expected seeded admin user');
    tenantId = admin.tenantId;
    userId = admin.id;

    const site = await db
      .select()
      .from(sites)
      .where(and(eq(sites.tenantId, tenantId), eq(sites.isActive, true)))
      .get();
    if (!site) throw new Error('Expected seeded site');
    const siteId = site.id;

    await db.insert(products).values([
      {
        id: P_LOT,
        tenantId,
        name: 'Lotted Widget',
        sku: 'LOT-1',
        price: 12,
        cost: 5,
        tracksLots: true,
        isActive: true,
        createdAt: IN_RANGE_AT,
        updatedAt: IN_RANGE_AT,
      },
      {
        id: P_PLAIN,
        tenantId,
        name: 'Plain Gadget',
        sku: 'PLN-1',
        price: 10,
        cost: 3,
        tracksLots: false,
        isActive: true,
        createdAt: IN_RANGE_AT,
        updatedAt: IN_RANGE_AT,
      },
    ]);

    // Two lots for the lot-tracked product at different unit costs. The report
    // reads sale_item_lots, so the lot on_hand here is immaterial — the rows
    // just need to exist for the sale_item_lots FK.
    const lotA = nanoid();
    const lotB = nanoid();
    await db.insert(inventoryLots).values([
      {
        id: lotA,
        tenantId,
        siteId,
        productId: P_LOT,
        lotNumber: 'A',
        onHand: 6,
        unitCost: 4,
        status: 'active',
        receivedAt: IN_RANGE_AT,
        createdAt: IN_RANGE_AT,
        updatedAt: IN_RANGE_AT,
      },
      {
        id: lotB,
        tenantId,
        siteId,
        productId: P_LOT,
        lotNumber: 'B',
        onHand: 4,
        unitCost: 6,
        status: 'active',
        receivedAt: IN_RANGE_AT,
        createdAt: IN_RANGE_AT,
        updatedAt: IN_RANGE_AT,
      },
    ]);

    const sessionId = await seedCommittedSaleSession({ tenantId, cashierId: userId, siteId });

    // S1 — the one eligible sale. Line 1 lot-tracked (lot COGS 6*4 + 4*6 = 48,
    // NOT costAtSale 5*10 = 50). Line 2 plain sells 5 packs with equivalence 2,
    // so snapshot COGS is 3*(5*2) = 30, not 3*5 = 15.
    const s1 = nanoid();
    const s1Line1 = nanoid();
    const s1Line2 = nanoid();
    // S2 — fully returned within the range. Historical full refunds are
    // normalized into frozen return evidence by the migration, not inferred
    // from today's header status when computing a dated report.
    const s2 = nanoid();
    const s2Line = nanoid();
    const s3 = nanoid(); // voided
    const s4 = nanoid(); // draft
    const s5 = nanoid(); // out of range

    await db.insert(sales).values([
      {
        id: s1,
        tenantId,
        saleNumber: 'PM-1',
        subtotal: 170,
        taxAmount: 0,
        discountAmount: 0,
        total: 170,
        paymentMethod: 'cash',
        paymentStatus: 'paid',
        status: 'completed',
        cashSessionId: sessionId,
        createdBy: userId,
        createdAt: IN_RANGE_AT,
        updatedAt: IN_RANGE_AT,
      },
      {
        id: s2,
        tenantId,
        saleNumber: 'PM-2',
        subtotal: 5000,
        taxAmount: 0,
        discountAmount: 0,
        total: 5000,
        paymentMethod: 'cash',
        returnState: 'refunded',
        status: 'completed',
        cashSessionId: sessionId,
        createdBy: userId,
        createdAt: IN_RANGE_AT,
        updatedAt: IN_RANGE_AT,
      },
      {
        id: s3,
        tenantId,
        saleNumber: 'PM-3',
        subtotal: 999,
        taxAmount: 0,
        discountAmount: 0,
        total: 999,
        paymentMethod: 'cash',
        paymentStatus: 'paid',
        status: 'voided',
        cashSessionId: sessionId,
        createdBy: userId,
        createdAt: IN_RANGE_AT,
        updatedAt: IN_RANGE_AT,
      },
      {
        id: s4,
        tenantId,
        saleNumber: 'PM-4',
        subtotal: 888,
        taxAmount: 0,
        discountAmount: 0,
        total: 888,
        paymentMethod: 'cash',
        paymentStatus: 'pending',
        status: 'draft',
        cashSessionId: null,
        createdBy: userId,
        createdAt: IN_RANGE_AT,
        updatedAt: IN_RANGE_AT,
      },
      {
        id: s5,
        tenantId,
        saleNumber: 'PM-5',
        subtotal: 777,
        taxAmount: 0,
        discountAmount: 0,
        total: 777,
        paymentMethod: 'cash',
        paymentStatus: 'paid',
        status: 'completed',
        cashSessionId: sessionId,
        createdBy: userId,
        createdAt: OUT_OF_RANGE_AT,
        updatedAt: OUT_OF_RANGE_AT,
      },
    ]);

    await db.insert(saleItems).values([
      {
        id: s1Line1,
        saleId: s1,
        productId: P_LOT,
        quantity: 10,
        unitPrice: 12,
        discount: 0,
        taxRate: 0,
        taxAmount: 0,
        costAtSale: 5,
        total: 120,
      },
      {
        id: s1Line2,
        saleId: s1,
        productId: P_PLAIN,
        quantity: 5,
        unitEquivalence: 2,
        unitPrice: 10,
        discount: 0,
        taxRate: 0,
        taxAmount: 0,
        costAtSale: 3,
        total: 50,
      },
      {
        id: s2Line,
        saleId: s2,
        productId: P_LOT,
        quantity: 50,
        unitPrice: 100,
        discount: 0,
        taxRate: 0,
        taxAmount: 0,
        costAtSale: 5,
        total: 5000,
      },
      {
        id: nanoid(),
        saleId: s3,
        productId: P_PLAIN,
        quantity: 3,
        unitPrice: 333,
        discount: 0,
        taxRate: 0,
        taxAmount: 0,
        costAtSale: 3,
        total: 999,
      },
      {
        id: nanoid(),
        saleId: s4,
        productId: P_PLAIN,
        quantity: 3,
        unitPrice: 296,
        discount: 0,
        taxRate: 0,
        taxAmount: 0,
        costAtSale: 3,
        total: 888,
      },
      {
        id: nanoid(),
        saleId: s5,
        productId: P_PLAIN,
        quantity: 1,
        unitPrice: 777,
        discount: 0,
        taxRate: 0,
        taxAmount: 0,
        costAtSale: 3,
        total: 777,
      },
    ]);

    const s2Return = nanoid();
    await db.insert(saleReturns).values({
      id: s2Return,
      tenantId,
      saleId: s2,
      subtotal: 5000,
      refundAmount: 5000,
      createdBy: userId,
      createdAt: IN_RANGE_AT,
    });
    await db.insert(saleReturnItems).values({
      id: nanoid(),
      tenantId,
      saleReturnId: s2Return,
      saleItemId: s2Line,
      productId: P_LOT,
      quantity: 50,
      baseQuantity: 50,
      unitPrice: 100,
      unitEquivalence: 1,
      subtotal: 5000,
      total: 5000,
      costAmount: 250,
      createdAt: IN_RANGE_AT,
    });

    // sale_item_lots only for S1's lot-tracked line (6 from lot A @4, 4 from lot B @6).
    await db.insert(saleItemLots).values([
      {
        id: nanoid(),
        tenantId,
        saleItemId: s1Line1,
        lotId: lotA,
        quantity: 6,
        unitCost: 4,
        createdAt: IN_RANGE_AT,
      },
      {
        id: nanoid(),
        tenantId,
        saleItemId: s1Line1,
        lotId: lotB,
        quantity: 4,
        unitCost: 6,
        createdAt: IN_RANGE_AT,
      },
    ]);
  });

  afterAll(async () => {
    await server.close();
  });

  it('sources COGS from the lot ledger for lot-tracked lines and the snapshot otherwise', async () => {
    const caller = appRouter.createCaller(buildContext('admin'));
    const report = await caller.reports.profit.margin(marginInput);

    // revenue 120 + 50; lot COGS 48 (not the 5*10=50 snapshot); snapshot COGS
    // uses base units for the pack line: 3*(5*2) = 30.
    expect(report.summary.revenue).toBe(170);
    expect(report.summary.cogsFromLots).toBe(48);
    expect(report.summary.cogsFromSnapshot).toBe(30);
    expect(report.summary.cogs).toBe(78);
    expect(report.summary.grossProfit).toBe(92);
    expect(report.summary.grossMarginPct).toBe(54.12);
    expect(report.summary.salesCount).toBe(1);
    expect(report.summary.lineCount).toBe(2);
  });

  it('breaks down per product, ordered by gross profit descending', async () => {
    const caller = appRouter.createCaller(buildContext('manager'));
    const report = await caller.reports.profit.margin(marginInput);

    expect(report.products).toHaveLength(2);
    const [first, second] = report.products;
    expect(first?.sku).toBe('LOT-1');
    expect(first?.quantity).toBe(10);
    expect(first?.revenue).toBe(120);
    expect(first?.cogs).toBe(48);
    expect(first?.grossProfit).toBe(72);
    expect(first?.grossMarginPct).toBe(60);
    expect(second?.sku).toBe('PLN-1');
    expect(second?.quantity).toBe(10);
    expect(second?.cogs).toBe(30);
    expect(second?.grossProfit).toBe(20);
    expect(second?.grossMarginPct).toBe(40);
  });

  it('nets same-period refunds and excludes voided, draft, and out-of-range sales', async () => {
    // S2 (5000) and its frozen return cancel; S3 (voided), S4 (draft), and
    // S5 (out of range) never contribute.
    const report = computeProfitMarginReport(getDatabase(), {
      tenantId,
      fromDate: RANGE_FROM,
      toDate: RANGE_TO,
      limit: 50,
    });
    expect(report.summary.revenue).toBe(170);
    expect(report.products.map(p => p.sku).sort()).toEqual(['LOT-1', 'PLN-1']);
  });

  it('returns an all-zero summary for a range with no sales', async () => {
    const report = computeProfitMarginReport(getDatabase(), {
      tenantId,
      fromDate: '2030-01-01T00:00:00.000Z',
      toDate: '2030-01-31T23:59:59.999Z',
      limit: 50,
    });
    expect(report.summary.revenue).toBe(0);
    expect(report.summary.cogs).toBe(0);
    expect(report.summary.grossProfit).toBe(0);
    expect(report.summary.grossMarginPct).toBe(0);
    expect(report.products).toEqual([]);
  });

  it("isolates by tenant — another tenant's sales never appear", async () => {
    const db = getDatabase();
    const now = IN_RANGE_AT;
    const tenantB = `pm-tenant-b-${nanoid(6)}`;
    const userB = nanoid();
    const productB = nanoid();
    await db.insert(tenants).values({
      id: tenantB,
      name: 'PM Tenant B',
      slug: `pm-b-${nanoid(6)}`,
      settings: {},
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(users).values({
      id: userB,
      tenantId: tenantB,
      email: `b-${nanoid(6)}@example.com`,
      passwordHash: 'x',
      name: 'B Admin',
      role: 'admin',
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });
    const sessionB = await seedCommittedSaleSession({ tenantId: tenantB, cashierId: userB });
    await db.insert(products).values({
      id: productB,
      tenantId: tenantB,
      name: 'B Product',
      sku: 'B-1',
      price: 100,
      cost: 1,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });
    const saleB = nanoid();
    await db.insert(sales).values({
      id: saleB,
      tenantId: tenantB,
      saleNumber: 'B-1',
      subtotal: 99999,
      taxAmount: 0,
      discountAmount: 0,
      total: 99999,
      paymentMethod: 'cash',
      paymentStatus: 'paid',
      status: 'completed',
      cashSessionId: sessionB,
      createdBy: userB,
      createdAt: now,
      updatedAt: now,
    });
    const lineB = nanoid();
    await db.insert(saleItems).values({
      id: lineB,
      saleId: saleB,
      productId: productB,
      quantity: 1000,
      unitPrice: 100,
      discount: 0,
      taxRate: 0,
      taxAmount: 0,
      costAtSale: 1,
      total: 99999,
    });
    const returnB = nanoid();
    await db.insert(saleReturns).values({
      id: returnB,
      tenantId: tenantB,
      saleId: saleB,
      subtotal: 49999.5,
      refundAmount: 49999.5,
      createdBy: userB,
      createdAt: now,
    });
    await db.insert(saleReturnItems).values({
      id: nanoid(),
      tenantId: tenantB,
      saleReturnId: returnB,
      saleItemId: lineB,
      productId: productB,
      quantity: 500,
      baseQuantity: 500,
      unitPrice: 100,
      unitEquivalence: 1,
      subtotal: 49999.5,
      total: 49999.5,
      costAmount: 500,
      createdAt: now,
    });

    // Tenant A's report is unchanged; tenant B's own report sees only its sale.
    const reportA = computeProfitMarginReport(db, {
      tenantId,
      fromDate: RANGE_FROM,
      toDate: RANGE_TO,
      limit: 50,
    });
    expect(reportA.summary.revenue).toBe(170);
    expect(reportA.products.some(p => p.sku === 'B-1')).toBe(false);

    const reportB = computeProfitMarginReport(db, {
      tenantId: tenantB,
      fromDate: RANGE_FROM,
      toDate: RANGE_TO,
      limit: 50,
    });
    expect(reportB.summary.revenue).toBe(49999.5);
    expect(reportB.summary.cogs).toBe(500);
    expect(reportB.products).toHaveLength(1);
    expect(reportB.products[0]?.sku).toBe('B-1');
  });

  it('rejects a cashier — manager/admin gated', async () => {
    const caller = appRouter.createCaller(buildContext('cashier'));
    await expect(caller.reports.profit.margin(marginInput)).rejects.toThrow();
  });

  it('books discounted, tax-exclusive returns on their dates without restating checkout', async () => {
    const db = getDatabase();
    const productId = nanoid();
    const saleId = nanoid();
    const lineId = nanoid();
    const soldAt = '2026-08-20T10:00:00.000Z';
    const returnedAt = '2026-08-21T23:59:59.999Z';
    const finalReturnAt = '2026-08-22T00:00:00.000Z';
    const cashSessionId = await seedCommittedSaleSession({ tenantId, cashierId: userId });
    await db.insert(products).values({
      id: productId,
      tenantId,
      name: 'Dated discounted VAT',
      sku: `DATED-${nanoid(6)}`,
      price: 11900,
      cost: 6000,
    });
    await db.insert(sales).values({
      id: saleId,
      tenantId,
      saleNumber: `DATED-${nanoid(6)}`,
      subtotal: 30000,
      taxAmount: 5700,
      discountAmount: 1190,
      total: 34510,
      status: 'completed',
      paymentStatus: 'paid',
      paymentMethod: 'cash',
      cashSessionId,
      createdBy: userId,
      // A draft created yesterday is revenue only when it was checked out.
      createdAt: '2026-08-19T10:00:00.000Z',
      checkoutCompletedAt: soldAt,
    });
    await db.insert(saleItems).values({
      id: lineId,
      saleId,
      productId,
      quantity: 3,
      unitPrice: 11900,
      taxAmount: 5700,
      taxRate: 19,
      costAtSale: 6000,
      inventoryCostCents: 1800000,
      cogsCostCents: 1800000,
      total: 35700,
    });
    const report = (from: string, to = from) =>
      computeProfitMarginReport(db, {
        tenantId,
        fromDate: `${from}T00:00:00.000Z`,
        toDate: `${to}T23:59:59.999Z`,
        limit: 50,
      });
    const beforeReturn = report('2026-08-20');
    expect(beforeReturn.summary).toMatchObject({
      revenue: 28810,
      cogs: 18000,
      grossProfit: 10810,
      salesCount: 1,
      lineCount: 1,
    });
    expect(report('2026-08-19').summary.revenue).toBe(0);

    for (const [quantity, createdAt, discountAmount] of [
      [1, returnedAt, 396.67],
      [2, finalReturnAt, 793.33],
    ] as const) {
      const returnId = nanoid();
      await db.insert(saleReturns).values({
        id: returnId,
        tenantId,
        saleId,
        subtotal: quantity * 10000,
        taxAmount: quantity * 1900,
        discountAmount,
        refundAmount: roundMoney(quantity * 11900 - discountAmount),
        createdBy: userId,
        createdAt,
      });
      await db.insert(saleReturnItems).values({
        id: nanoid(),
        tenantId,
        saleReturnId: returnId,
        saleItemId: lineId,
        productId,
        quantity,
        baseQuantity: quantity,
        unitPrice: 11900,
        unitEquivalence: 1,
        taxRate: 19,
        subtotal: quantity * 10000,
        taxAmount: quantity * 1900,
        total: quantity * 11900,
        costAmount: quantity * 6000,
        createdAt,
      });
    }
    await db.update(sales).set({ returnState: 'refunded' }).where(eq(sales.id, saleId));
    await db.update(products).set({ cost: 99000, taxRate: 0 }).where(eq(products.id, productId));

    expect(report('2026-08-20')).toEqual(beforeReturn);
    const firstReturn = report('2026-08-21');
    expect(firstReturn.summary).toMatchObject({
      revenue: -9603.33,
      cogs: -6000,
      cogsFromSnapshot: -6000,
      grossProfit: -3603.33,
      salesCount: 0,
      lineCount: 0,
    });
    expect(firstReturn.products).toEqual([
      expect.objectContaining({ productId, quantity: -1, revenue: -9603.33, cogs: -6000 }),
    ]);
    const finalReturn = report('2026-08-22');
    expect(finalReturn.summary).toMatchObject({ revenue: -19206.67, cogs: -12000 });
    const combined = report('2026-08-20', '2026-08-22');
    expect(combined.summary).toMatchObject({ revenue: 0, cogs: 0, grossProfit: 0 });
    expect(combined.products).toEqual([]);
    expect(
      roundMoney(
        beforeReturn.summary.revenue + firstReturn.summary.revenue + finalReturn.summary.revenue
      )
    ).toBe(combined.summary.revenue);
    expect(report('2026-08-23').products).toEqual([]);
  });

  it('conserves multi-line header cents and dated lot costs through separate final returns', async () => {
    const db = getDatabase();
    const saleId = nanoid();
    const productIds = [nanoid(), nanoid()];
    const lineIds = [`a-${nanoid()}`, `b-${nanoid()}`];
    const soldAt = '2026-09-01T12:00:00.000Z';
    const site = await db.select().from(sites).where(eq(sites.tenantId, tenantId)).get();
    if (!site) throw new Error('Expected seeded site');
    const cashSessionId = await seedCommittedSaleSession({ tenantId, cashierId: userId });
    const lotId = nanoid();
    for (const [index, productId] of productIds.entries()) {
      await db.insert(products).values({
        id: productId,
        tenantId,
        name: `Dated cents ${index}`,
        sku: `CENTS-${nanoid(6)}`,
        price: index === 0 ? 2.01 : 0.99,
        cost: 99,
      });
    }
    await db.insert(inventoryLots).values({
      id: lotId,
      tenantId,
      siteId: site.id,
      productId: productIds[0]!,
      lotNumber: nanoid(),
      unitCost: 0.5,
    });
    await db.insert(sales).values({
      id: saleId,
      tenantId,
      saleNumber: `CENTS-${nanoid(6)}`,
      subtotal: 6,
      discountAmount: 1,
      total: 5,
      status: 'completed',
      paymentMethod: 'cash',
      paymentStatus: 'paid',
      cashSessionId,
      createdBy: userId,
      createdAt: soldAt,
    });
    for (const [index, productId] of productIds.entries()) {
      await db.insert(saleItems).values({
        id: lineIds[index]!,
        saleId,
        productId,
        quantity: 2,
        unitEquivalence: index === 0 ? 2 : 1,
        unitPrice: index === 0 ? 2.01 : 0.99,
        total: index === 0 ? 4.02 : 1.98,
        costAtSale: 99,
        // Known zero must not fall back to the nonzero catalog/unit cost.
        inventoryCostCents: index === 0 ? null : 0,
        cogsCostCents: index === 0 ? null : 0,
      });
    }
    await db.insert(saleItemLots).values({
      id: nanoid(),
      tenantId,
      saleItemId: lineIds[0]!,
      lotId,
      quantity: 4,
      unitCost: 0.5,
    });
    for (const day of ['2026-09-02', '2026-09-03']) {
      const returnId = nanoid();
      const createdAt = `${day}T12:00:00.000Z`;
      await db.insert(saleReturns).values({
        id: returnId,
        tenantId,
        saleId,
        subtotal: 3,
        discountAmount: 0.5,
        refundAmount: 2.5,
        createdBy: userId,
        createdAt,
      });
      for (const [index, productId] of productIds.entries()) {
        await db.insert(saleReturnItems).values({
          id: nanoid(),
          tenantId,
          saleReturnId: returnId,
          saleItemId: lineIds[index]!,
          productId,
          quantity: 1,
          baseQuantity: index === 0 ? 2 : 1,
          unitEquivalence: index === 0 ? 2 : 1,
          unitPrice: index === 0 ? 2.01 : 0.99,
          subtotal: index === 0 ? 2.01 : 0.99,
          total: index === 0 ? 2.01 : 0.99,
          costAmount: index === 0 ? 1 : 0,
          createdAt,
        });
      }
    }
    await db.update(sales).set({ returnState: 'refunded' }).where(eq(sales.id, saleId));
    const read = (from: string, to = from) =>
      computeProfitMarginReport(db, {
        tenantId,
        fromDate: `${from}T00:00:00.000Z`,
        toDate: `${to}T23:59:59.999Z`,
        limit: 50,
      });
    const periods = ['2026-09-01', '2026-09-02', '2026-09-03'].map(day => read(day));
    expect(periods.map(period => period.summary.revenue)).toEqual([5, -2.5, -2.5]);
    expect(periods.map(period => period.summary.cogsFromLots)).toEqual([2, -1, -1]);
    expect(periods.map(period => period.summary.cogsFromSnapshot)).toEqual([0, 0, 0]);
    for (const productId of productIds) {
      const productPeriods = periods.map(period =>
        period.products.find(product => product.productId === productId)
      );
      expect(productPeriods.every(Boolean)).toBe(true);
      expect(roundMoney(productPeriods.reduce((sum, row) => sum + row!.revenue, 0))).toBe(0);
      expect(roundMoney(productPeriods.reduce((sum, row) => sum + row!.cogs, 0))).toBe(0);
    }
    expect(read('2026-09-01', '2026-09-03').products).toEqual([]);
  });
});
