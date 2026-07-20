/**
 * reports.profit.margin (margin / COGS over the sale_item_lots ledger).
 *
 * Verifies the correctness invariants that make the report trustworthy:
 * - COGS for a lot-tracked line comes from `sale_item_lots` (the real
 * per-lot cost), NOT the `cost_at_sale` snapshot.
 * - COGS for a non-lot line comes from `cost_at_sale × normalized quantity`.
 * - Refunded (paymentStatus='refunded', still status='completed'), voided,
 * draft, and out-of-range sales are excluded.
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
  sales,
  sites,
  tenants,
  users,
} from '../db/schema.js';
import { seedCommittedSaleSession } from './utils/cashSessionFixture.js';
import { computeProfitMarginReport } from '../services/reports/profit-margin.js';
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
    // S2 — refunded (status stays 'completed'); lot-tracked but its lot rows
    // were deleted on refund, so it would leak revenue with ~0 lot COGS if the
    // filter missed it. Must be excluded.
    const s2 = nanoid();
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
        paymentStatus: 'refunded',
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
        id: nanoid(),
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

  it('excludes refunded, voided, draft, and out-of-range sales', async () => {
    // If any of S2 (5000, refunded), S3 (999, voided), S4 (888, draft), or
    // S5 (777, out of range) leaked, revenue would jump well past 170.
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
    await db.insert(saleItems).values({
      id: nanoid(),
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
    expect(reportB.summary.revenue).toBe(99999);
    expect(reportB.products).toHaveLength(1);
    expect(reportB.products[0]?.sku).toBe('B-1');
  });

  it('rejects a cashier — manager/admin gated', async () => {
    const caller = appRouter.createCaller(buildContext('cashier'));
    await expect(caller.reports.profit.margin(marginInput)).rejects.toThrow();
  });
});
