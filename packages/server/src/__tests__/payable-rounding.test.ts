import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';

import { createServer, type PuntovivoServer } from '../index.js';
import { getDatabase } from '../db/index.js';
import {
  cashMovements,
  cashSessions,
  currencyCatalog,
  customerLedgerEntries,
  customers,
  inventoryBalances,
  products,
  saleItems,
  salePayments,
  saleReturns,
  sales,
  sites,
  tenants,
  unitXProduct,
  units,
  users,
} from '../db/schema.js';
import { appRouter } from '../trpc/router.js';
import { registerDevice } from '../services/devices/devicesService.js';
import { completeSale } from '../application/sales/completeSale.js';
import { returnSale } from '../application/sales/partialReturnSale.js';
import type { CompleteSaleContext, CompleteSaleInput } from '../application/sales/types.js';
import { payableDecimals } from '../lib/money.js';
import { resolveFiscalDocumentSnapshot } from '../services/fiscal/orchestrator/snapshots.js';
import { makeFreshContextFactory } from './utils/criticalCommandFixture.js';

// 1.25 kg x 2,990 COP = 3,737.50: a total no peso bill or coin can pay.
const KILO_PRICE = 2990;
const WEIGHT = 1.25;

describe('payable total rounding', () => {
  let server: PuntovivoServer;
  let tenantId: string;
  let userId: string;
  let siteId: string;
  let unitId: string;
  let sessionId: string;

  function context(): CompleteSaleContext {
    return {
      db: getDatabase(),
      tenantId,
      siteId,
      user: { id: userId, role: 'admin' },
      envelope: null,
      deviceId: null,
    };
  }

  async function seedProduct(price: number, stock = 100) {
    const db = getDatabase();
    const id = nanoid();
    const now = new Date().toISOString();
    await db.insert(products).values({
      id,
      tenantId,
      name: `Weighed ${price}`,
      sku: `W-${randomUUID()}`,
      price,
      price2: price,
      price3: price,
      cost: 1,
      marginPercent1: 0,
      marginPercent2: 0,
      marginPercent3: 0,
      marginAmount1: 0,
      marginAmount2: 0,
      marginAmount3: 0,
      taxRate: 0,
      initialCost: 1,
      minStock: 0,
      sellByFraction: true,
      fractionStep: 0.01,
      fractionMinimum: 0.01,
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
      onHand: stock,
      reserved: 0,
      createdAt: now,
      updatedAt: now,
    });
    return id;
  }

  function weighedSale(productId: string, overrides: Partial<CompleteSaleInput> = {}) {
    return completeSale(context(), {
      mode: 'fresh',
      customerId: null,
      items: [{ productId, unitId, quantity: WEIGHT, unitPrice: KILO_PRICE, discount: 0 }],
      paymentMethod: 'cash',
      paymentStatus: 'paid',
      status: 'completed',
      amountReceived: 4000,
      discountAmount: 0,
      ...overrides,
    } as CompleteSaleInput);
  }

  async function saleRow(saleId: string) {
    const row = await getDatabase().select().from(sales).where(eq(sales.id, saleId)).get();
    if (!row) throw new Error('Expected sale row');
    return row;
  }

  async function cashFor(referenceId: string) {
    return getDatabase()
      .select({ type: cashMovements.type, amount: cashMovements.amount })
      .from(cashMovements)
      .where(and(eq(cashMovements.tenantId, tenantId), eq(cashMovements.referenceId, referenceId)))
      .all();
  }

  async function expectedBalance() {
    const row = await getDatabase()
      .select({ expectedBalance: cashSessions.expectedBalance })
      .from(cashSessions)
      .where(eq(cashSessions.id, sessionId))
      .get();
    return row?.expectedBalance ?? Number.NaN;
  }

  async function setTenantCurrency(code: string) {
    await getDatabase()
      .update(tenants)
      .set({ defaultCurrencyCode: code })
      .where(eq(tenants.id, tenantId))
      .run();
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
    await setTenantCurrency('COP');
    const device = await registerDevice(db, {
      tenantId,
      userId,
      kind: 'web',
      name: 'payable-rounding.test',
    });
    const callerContext = makeFreshContextFactory({
      db,
      serverApp: server.app,
      tenantId,
      userId,
      email: user.email,
      siteId,
      deviceId: device.deviceId,
    });
    const session = await appRouter.createCaller(callerContext()).cashSessions.open({
      registerName: 'Rounding register',
      openingFloat: 50000,
      denominations: [{ value: 50000, count: 1 }],
    });
    sessionId = (session as { id: string }).id;
  });

  afterAll(async () => server.close());

  it('keeps the shared payable map in step with the seeded currency catalog', async () => {
    const rows = await getDatabase().select().from(currencyCatalog).all();
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect({ code: row.code, decimals: payableDecimals(row.code) }).toEqual({
        code: row.code,
        decimals: row.displayDecimals,
      });
    }
  });

  it('charges whole pesos for a fractional weight and records the rounding', async () => {
    const productId = await seedProduct(KILO_PRICE);
    const before = await expectedBalance();
    const result = await weighedSale(productId);
    const saleId = (result.sale as { id: string }).id;

    const sale = await saleRow(saleId);
    expect(sale).toMatchObject({ subtotal: 3737.5, total: 3738, roundingAdjustment: 0.5 });
    expect(result.change).toBe(262);
    expect(sale.cashChangeSnapshot).toBe(262);
    expect(await cashFor(saleId)).toEqual([{ type: 'sale', amount: 3738 }]);
    expect(await expectedBalance()).toBe(before + 3738);
    const payments = await getDatabase()
      .select({ amount: salePayments.amount })
      .from(salePayments)
      .where(eq(salePayments.saleId, saleId))
      .all();
    expect(payments).toEqual([{ amount: 3738 }]);
  });

  it('requires split tenders to add up to the rounded total', async () => {
    const productId = await seedProduct(KILO_PRICE);
    await expect(
      weighedSale(productId, {
        payments: [
          { method: 'cash', amount: 2000 },
          { method: 'card', amount: 1737, reference: 'VOUCHER-1' },
        ],
      })
    ).rejects.toMatchObject({ cause: { errorCode: 'SALE_PAYMENTS_SUM_MISMATCH' } });

    const result = await weighedSale(productId, {
      payments: [
        { method: 'cash', amount: 2000 },
        { method: 'card', amount: 1738, reference: 'VOUCHER-2' },
      ],
    });
    const saleId = (result.sale as { id: string }).id;
    expect(await saleRow(saleId)).toMatchObject({ total: 3738, roundingAdjustment: 0.5 });
    expect(await cashFor(saleId)).toEqual([{ type: 'sale', amount: 2000 }]);
  });

  it('puts the rounded total on the customer ledger of a credit sale', async () => {
    const productId = await seedProduct(KILO_PRICE);
    const customerId = nanoid();
    const now = new Date().toISOString();
    await getDatabase().insert(customers).values({
      id: customerId,
      tenantId,
      name: 'Rounding credit customer',
      creditLimit: 0,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });
    const result = await weighedSale(productId, {
      customerId,
      paymentMethod: 'credit',
      paymentStatus: 'pending',
      amountReceived: undefined,
    });
    const saleId = (result.sale as { id: string }).id;
    expect(await saleRow(saleId)).toMatchObject({ total: 3738, roundingAdjustment: 0.5 });
    const ledger = await getDatabase()
      .select({ amount: customerLedgerEntries.amount })
      .from(customerLedgerEntries)
      .where(
        and(
          eq(customerLedgerEntries.customerId, customerId),
          eq(customerLedgerEntries.kind, 'sale')
        )
      )
      .all();
    expect(ledger).toEqual([{ amount: 3738 }]);
  });

  it('refunds whole pesos across partial returns and never more than was paid', async () => {
    const weighedId = await seedProduct(KILO_PRICE);
    const unitPricedId = await seedProduct(1000);
    const result = await completeSale(context(), {
      mode: 'fresh',
      customerId: null,
      items: [
        { productId: weighedId, unitId, quantity: WEIGHT, unitPrice: KILO_PRICE, discount: 0 },
        { productId: unitPricedId, unitId, quantity: 1, unitPrice: 1000, discount: 0 },
      ],
      paymentMethod: 'cash',
      paymentStatus: 'paid',
      status: 'completed',
      amountReceived: 5000,
      discountAmount: 0,
    });
    const saleId = (result.sale as { id: string }).id;
    expect(await saleRow(saleId)).toMatchObject({ total: 4738, roundingAdjustment: 0.5 });
    const lines = await getDatabase()
      .select({ id: saleItems.id, productId: saleItems.productId })
      .from(saleItems)
      .where(eq(saleItems.saleId, saleId))
      .all();
    const lineOf = (productId: string) => lines.find(line => line.productId === productId)!.id;

    await returnSale(context(), {
      id: saleId,
      items: [{ saleItemId: lineOf(weighedId), quantity: 0.5 }],
      reason: 'partial weight',
    });
    await returnSale(context(), {
      id: saleId,
      items: [{ saleItemId: lineOf(weighedId), quantity: 0.75 }],
      reason: 'rest of the weight',
    });
    const last = await returnSale(context(), {
      id: saleId,
      items: [{ saleItemId: lineOf(unitPricedId), quantity: 1 }],
      reason: 'unit line',
    });
    expect(last.sale.returnState).toBe('refunded');

    const returns = await getDatabase()
      .select({
        id: saleReturns.id,
        refundAmount: saleReturns.refundAmount,
        roundingAdjustment: saleReturns.roundingAdjustment,
      })
      .from(saleReturns)
      .where(eq(saleReturns.saleId, saleId))
      .all();
    const byAmount = (a: number, b: number) => a - b;
    expect(returns.map(row => row.refundAmount).sort(byAmount)).toEqual([1000, 1495, 2243]);
    expect(returns.reduce((sum, row) => sum + row.roundingAdjustment, 0)).toBeCloseTo(0.5, 2);
    const refunds = (await cashFor(saleId)).filter(row => row.type === 'refund');
    expect(refunds.map(row => row.amount).sort(byAmount)).toEqual([1000, 1495, 2243]);
    expect(refunds.reduce((sum, row) => sum + row.amount, 0)).toBe(4738);

    // The credit note keeps the 2-decimal gross of the returned weight.
    const rounded = returns.find(row => row.refundAmount === 2243)!;
    expect(rounded.roundingAdjustment).toBe(0.5);
    const fiscal = await resolveFiscalDocumentSnapshot(getDatabase(), {
      tenantId,
      source: 'return',
      sourceId: rounded.id,
      saleId,
      sale: { subtotal: 4737.5, taxAmount: 0, discountAmount: 0, total: 4737.5 },
    });
    expect(fiscal.amounts.total).toBe(2242.5);
  });

  it('rounds the cumulative refund so repeated partial returns do not drift', async () => {
    // 1.5 kg x 1,001 + 1,000 = 2,501.50, charged 2,502; each 0.5 kg share is 500.50.
    const weighedId = await seedProduct(1001);
    const unitPricedId = await seedProduct(1000);
    const result = await completeSale(context(), {
      mode: 'fresh',
      customerId: null,
      items: [
        { productId: weighedId, unitId, quantity: 1.5, unitPrice: 1001, discount: 0 },
        { productId: unitPricedId, unitId, quantity: 1, unitPrice: 1000, discount: 0 },
      ],
      paymentMethod: 'cash',
      paymentStatus: 'paid',
      status: 'completed',
      amountReceived: 3000,
      discountAmount: 0,
    });
    const saleId = (result.sale as { id: string }).id;
    const lines = await getDatabase()
      .select({ id: saleItems.id, productId: saleItems.productId })
      .from(saleItems)
      .where(eq(saleItems.saleId, saleId))
      .all();
    const lineOf = (productId: string) => lines.find(line => line.productId === productId)!.id;
    for (const [productId, quantity] of [
      [weighedId, 0.5],
      [weighedId, 0.5],
      [weighedId, 0.5],
      [unitPricedId, 1],
    ] as const) {
      await returnSale(context(), {
        id: saleId,
        items: [{ saleItemId: lineOf(productId), quantity }],
      });
    }
    const amounts = (
      await getDatabase()
        .select({ refundAmount: saleReturns.refundAmount })
        .from(saleReturns)
        .where(eq(saleReturns.saleId, saleId))
        .all()
    ).map(row => row.refundAmount);
    expect(amounts.slice().sort((a, b) => a - b)).toEqual([500, 501, 501, 1000]);
    expect(amounts.reduce((sum, value) => sum + value, 0)).toBe(2502);
  });

  it('rejects a tender with cents in a whole-peso currency', async () => {
    const productId = await seedProduct(KILO_PRICE);
    await expect(
      weighedSale(productId, {
        payments: [
          { method: 'cash', amount: 2000.5 },
          { method: 'card', amount: 1737.5, reference: 'VOUCHER-3' },
        ],
      })
    ).rejects.toMatchObject({ cause: { errorCode: 'SALE_TENDER_NOT_PAYABLE_UNIT' } });
    await expect(weighedSale(productId, { amountReceived: 4000.5 })).rejects.toMatchObject({
      cause: { errorCode: 'SALE_TENDER_NOT_PAYABLE_UNIT' },
    });
  });

  it('leaves a two-decimal currency untouched', async () => {
    await setTenantCurrency('USD');
    try {
      const productId = await seedProduct(2.99);
      const result = await completeSale(context(), {
        mode: 'fresh',
        customerId: null,
        items: [{ productId, unitId, quantity: WEIGHT, unitPrice: 2.99, discount: 0 }],
        paymentMethod: 'cash',
        paymentStatus: 'paid',
        status: 'completed',
        amountReceived: 5,
        discountAmount: 0,
      });
      const saleId = (result.sale as { id: string }).id;
      expect(await saleRow(saleId)).toMatchObject({
        currencyCode: 'USD',
        total: 3.74,
        roundingAdjustment: 0,
      });
      expect(result.change).toBe(1.26);
      expect(await cashFor(saleId)).toEqual([{ type: 'sale', amount: 3.74 }]);
    } finally {
      await setTenantCurrency('COP');
    }
  });
});
