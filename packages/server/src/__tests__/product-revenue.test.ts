/** Historical snapshot/allocation edges complement the real checkout/return journey. */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { createServer, type PuntovivoServer } from '../index.js';
import { getDatabase } from '../db/index.js';
import {
  cashSessions,
  products,
  saleItems,
  saleItemTaxComponents,
  saleReturns,
  saleReturnItems,
  sales,
  tenants,
  users,
} from '../db/schema.js';
import { roundMoney } from '../lib/money.js';
import { computeProfitMarginReport } from '../services/reports/profit-margin.js';
import { computeDayCloseSummary } from '../services/reports/day-close.js';
import { seedCommittedSaleSession } from './utils/cashSessionFixture.js';

const at = '2026-03-15T14:00:00.000Z';
const range = {
  fromDate: '2026-03-15T00:00:00.000Z',
  toDate: '2026-03-15T23:59:59.999Z',
  limit: 50,
};
let server: PuntovivoServer;
let tenantId: string;
let userId: string;
let sessionId: string;

/** Stable line ids intentionally differ from insertion order. */
async function seedTicket(input: {
  gross: number[];
  taxes?: number[];
  discount?: number;
  tip?: number;
  service?: number;
}) {
  const db = getDatabase();
  const saleId = nanoid();
  const taxAmount = roundMoney((input.taxes ?? []).reduce((sum, tax) => sum + tax, 0));
  const gross = roundMoney(input.gross.reduce((sum, amount) => sum + amount, 0));
  await db.insert(sales).values({
    id: saleId,
    tenantId,
    saleNumber: saleId,
    createdBy: userId,
    cashSessionId: sessionId,
    subtotal: roundMoney(gross - taxAmount),
    taxAmount,
    discountAmount: input.discount ?? 0,
    tipAmount: input.tip ?? 0,
    serviceChargeAmount: input.service ?? 0,
    total: roundMoney(gross - (input.discount ?? 0) + (input.tip ?? 0) + (input.service ?? 0)),
    paymentMethod: 'cash',
    paymentStatus: 'paid',
    status: 'completed',
    createdAt: at,
    updatedAt: at,
  });
  const lines = input.gross.map((total, index) => ({
    id: `${saleId}-${String(index).padStart(3, '0')}`,
    saleId,
    productId: nanoid(),
    quantity: 1,
    unitPrice: total,
    unitEquivalence: 1,
    total,
    taxAmount: input.taxes?.[index] ?? 0,
    costAtSale: 4,
  }));
  for (const [index, line] of lines.entries()) {
    await db.insert(products).values({
      id: line.productId,
      tenantId,
      name: `Product ${index}`,
      sku: line.productId,
      price: 999,
      cost: 999,
    });
  }
  await db.insert(saleItems).values([...lines].reverse());
  return { saleId, lines };
}

function report(limit = 50) {
  return computeProfitMarginReport(getDatabase(), { tenantId, ...range, limit });
}

describe('frozen product revenue allocation', () => {
  beforeEach(async () => {
    server = await createServer({ dbPath: ':memory:', verbose: false });
    const db = getDatabase();
    const admin = db.select().from(users).where(eq(users.email, 'admin@localhost')).get()!;
    tenantId = admin.tenantId;
    userId = admin.id;
    sessionId = await seedCommittedSaleSession({ tenantId, cashierId: userId });
    await db.update(cashSessions).set({ closedAt: at }).where(eq(cashSessions.id, sessionId));
  });
  afterEach(async () => {
    await server.close();
  });

  it.each([0.01, 0.02, 0.05, 0.1, 1.01, 10, 30])(
    'conserves a %s ticket discount across equal lines before product limiting',
    async discount => {
      const { lines } = await seedTicket({ gross: [10, 10, 10], discount });
      const actual = report();
      expect(actual.summary.revenue).toBe(roundMoney(30 - discount));
      const amounts = lines.map((line, index) => {
        const cumulative = roundMoney((discount * (index + 1)) / 3);
        const prior = roundMoney((discount * index) / 3);
        return roundMoney(10 - roundMoney(cumulative - prior));
      });
      expect(
        lines.map(line => actual.products.find(row => row.productId === line.productId)?.revenue)
      ).toEqual(amounts);
      expect(report(1).summary).toEqual(actual.summary);
      expect(report(1).products).toEqual(actual.products.slice(0, 1));
    }
  );

  it('retains a loss when a valid discount exceeds the tax-exclusive base', async () => {
    await seedTicket({ gross: [119], taxes: [19], discount: 110 });
    expect(report().summary).toMatchObject({
      revenue: -10,
      cogs: 4,
      grossProfit: -14,
      grossMarginPct: 0,
    });
  });

  it('keeps zero-price lines finite and excludes tips and service charges', async () => {
    await seedTicket({ gross: [0, 0], tip: 5 });
    expect(report().summary).toMatchObject({ revenue: 0, cogs: 8, grossProfit: -8 });
    await seedTicket({ gross: [0, 10], discount: 3, tip: 5, service: 2 });
    expect(report().summary).toMatchObject({ revenue: 7, cogs: 16, grossProfit: -9 });
  });

  it('uses the frozen tax summary for legacy and multi-component lines exactly once', async () => {
    const db = getDatabase();
    const { lines } = await seedTicket({ gross: [127, 119], taxes: [27, 19], discount: 1.01 });
    await db.insert(saleItemTaxComponents).values([
      {
        id: nanoid(),
        tenantId,
        saleItemId: lines[0]!.id,
        componentKey: 'iva',
        taxKind: 'iva',
        taxRate: 19,
        taxableAmount: 100,
        taxAmount: 19,
        position: 0,
      },
      {
        id: nanoid(),
        tenantId,
        saleItemId: lines[0]!.id,
        componentKey: 'inc',
        taxKind: 'inc',
        taxRate: 8,
        taxableAmount: 100,
        taxAmount: 8,
        position: 1,
      },
    ]);
    expect(report().summary).toMatchObject({ revenue: 198.99, cogs: 8, grossProfit: 190.99 });
  });

  it('reallocates only the frozen unreturned discount and ignores foreign return evidence', async () => {
    const db = getDatabase();
    const { saleId, lines } = await seedTicket({ gross: [10, 20], discount: 1.01 });
    const returnId = nanoid();
    await db.insert(saleReturns).values({
      id: returnId,
      tenantId,
      saleId,
      createdBy: userId,
      discountAmount: 0.34,
      refundAmount: 9.66,
      // This assertion covers same-period netting, not a future dated return.
      createdAt: at,
    });
    await db.insert(saleReturnItems).values({
      id: nanoid(),
      tenantId,
      saleReturnId: returnId,
      saleItemId: lines[0]!.id,
      productId: lines[0]!.productId,
      productNameSnapshot: 'Product 0',
      productSkuSnapshot: '0',
      quantity: 1,
      baseQuantity: 1,
      unitPrice: 10,
      unitEquivalence: 1,
      total: 10,
      costAmount: 4,
    });
    const expected = report();
    expect(expected.summary).toMatchObject({
      revenue: 19.33,
      cogs: 4,
      grossProfit: 15.33,
      lineCount: 1,
    });
    const foreignTenant = nanoid();
    await db.insert(tenants).values({ id: foreignTenant, name: 'Foreign', slug: foreignTenant });
    const foreignReturn = nanoid();
    // Deliberately malformed cross-tenant links exercise the report boundary,
    // not an authorized mutation: the schema's independent FKs allow these.
    await db.insert(saleReturns).values({
      id: foreignReturn,
      tenantId: foreignTenant,
      saleId,
      createdBy: userId,
      discountAmount: 0.67,
      refundAmount: 19.33,
      createdAt: at,
    });
    await db.insert(saleReturnItems).values({
      id: nanoid(),
      tenantId: foreignTenant,
      saleReturnId: foreignReturn,
      saleItemId: lines[1]!.id,
      productId: lines[1]!.productId,
      productNameSnapshot: 'Foreign',
      productSkuSnapshot: 'foreign',
      quantity: 1,
      baseQuantity: 1,
      unitPrice: 20,
      unitEquivalence: 1,
      total: 20,
      costAmount: 4,
    });
    expect(report()).toEqual(expected);
    expect(computeProfitMarginReport(db, { ...range, tenantId: foreignTenant }).products).toEqual(
      []
    );
  });

  it('keeps gross day totals distinct and owner/cashier product revenue identical without COGS leakage', async () => {
    await seedTicket({
      gross: [119, 119, 119, 119],
      taxes: [19, 19, 19, 19],
      discount: 1.01,
      tip: 5,
      service: 2,
    });
    const readDay = (includeProfit: boolean) =>
      computeDayCloseSummary(getDatabase(), {
        tenantId,
        sessionId,
        viewerUserId: userId,
        includeProfit,
        canViewAnyCashierSession: true,
      });
    const owner = readDay(true);
    const cashier = readDay(false);
    expect(owner.day.revenue).toBe(481.99);
    expect(cashier.day).toEqual(owner.day);
    expect(owner.margin?.grossProfit).toBe(382.99);
    expect(cashier.margin).toBeNull();
    expect(cashier.pulse).toBeNull();
    expect(cashier.topProducts).toHaveLength(3);
    for (const row of cashier.topProducts) {
      expect(row).toEqual({
        productId: row.productId,
        name: row.name,
        sku: row.sku,
        revenue: report().products.find(product => product.productId === row.productId)!.revenue,
        grossProfit: null,
        grossMarginPct: null,
      });
    }
  });
});
