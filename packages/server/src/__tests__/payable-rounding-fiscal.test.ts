import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';

import { createServer, type PuntovivoServer } from '../index.js';
import { getDatabase } from '../db/index.js';
import {
  fiscalDocuments,
  fiscalNumberingResolutions,
  inventoryBalances,
  products,
  saleItems,
  saleReturns,
  sales,
  sites,
  tenantLocaleSettings,
  tenants,
  unitXProduct,
  units,
  users,
} from '../db/schema.js';
import { appRouter } from '../trpc/router.js';
import { registerDevice } from '../services/devices/devicesService.js';
import { completeSale } from '../application/sales/completeSale.js';
import { returnSale } from '../application/sales/partialReturnSale.js';
import { voidSale } from '../application/sales/voidSale.js';
import type { CompleteSaleContext } from '../application/sales/types.js';
import { makeFreshContextFactory } from './utils/criticalCommandFixture.js';

// Fiscal documents carry the 2-decimal gross even when the sale and its
// refunds are settled in whole pesos.
describe('payable rounding on emitted fiscal documents', () => {
  let server: PuntovivoServer;
  let tenantId: string;
  let userId: string;
  let siteId: string;
  let unitId: string;

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

  async function seedProduct(price: number, taxRate = 0) {
    const db = getDatabase();
    const id = nanoid();
    const now = new Date().toISOString();
    await db.insert(products).values({
      id,
      tenantId,
      name: `Fiscal ${price}`,
      sku: `F-${randomUUID()}`,
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
      taxRate,
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
      onHand: 100,
      reserved: 0,
      createdAt: now,
      updatedAt: now,
    });
    return id;
  }

  async function documentFor(source: 'sale' | 'void' | 'return', sourceId: string) {
    return getDatabase()
      .select({ kind: fiscalDocuments.kind, totalAmount: fiscalDocuments.totalAmount })
      .from(fiscalDocuments)
      .where(
        and(
          eq(fiscalDocuments.tenantId, tenantId),
          eq(fiscalDocuments.source, source),
          eq(fiscalDocuments.sourceId, sourceId)
        )
      )
      .get();
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

    const tenant = await db.select().from(tenants).where(eq(tenants.id, tenantId)).get();
    await db
      .update(tenants)
      .set({
        defaultCurrencyCode: 'COP',
        settings: {
          ...((tenant?.settings as Record<string, unknown>) ?? {}),
          fiscal_dian_enabled: true,
          fiscal: { co: { nit: '900373115-3', softwareId: 'sw-test', softwarePin: '12301' } },
        },
      })
      .where(eq(tenants.id, tenantId))
      .run();
    const now = new Date().toISOString();
    await db
      .insert(tenantLocaleSettings)
      .values({
        tenantId,
        countryCode: 'CO',
        localeOverride: null,
        currencyOverride: null,
        timezoneOverride: null,
        firstDayOfWeekOverride: null,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: tenantLocaleSettings.tenantId,
        set: { countryCode: 'CO', updatedAt: now },
      });
    for (const [kind, prefix] of [
      ['DEE', 'RD'],
      ['NC', 'RNC'],
    ] as const) {
      await db.insert(fiscalNumberingResolutions).values({
        id: nanoid(),
        tenantId,
        siteId,
        kind,
        resolutionNumber: '18760000001',
        prefix,
        fromNumber: 1,
        toNumber: 1_000_000,
        currentNumber: 0,
        technicalKey: 'fc8eac422eba16e22ffd8c6f94b3f40a6e38162c',
        validFrom: new Date(Date.now() - 60_000).toISOString(),
        validUntil: new Date(Date.now() + 365 * 24 * 60 * 60 * 1_000).toISOString(),
        isActive: true,
        createdAt: now,
        updatedAt: now,
      });
    }

    const device = await registerDevice(db, {
      tenantId,
      userId,
      kind: 'web',
      name: 'payable-rounding-fiscal.test',
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
    await appRouter.createCaller(callerContext()).cashSessions.open({
      registerName: 'Fiscal rounding register',
      openingFloat: 50000,
      denominations: [{ value: 50000, count: 1 }],
    });
  });

  afterAll(async () => server.close());

  it('freezes the credit note of a rounded return at the gross of its lines', async () => {
    const weighedId = await seedProduct(2990);
    const unitPricedId = await seedProduct(1000);
    const result = await completeSale(context(), {
      mode: 'fresh',
      customerId: null,
      items: [
        { productId: weighedId, unitId, quantity: 1.25, unitPrice: 2990, discount: 0 },
        { productId: unitPricedId, unitId, quantity: 1, unitPrice: 1000, discount: 0 },
      ],
      paymentMethod: 'cash',
      paymentStatus: 'paid',
      status: 'completed',
      amountReceived: 5000,
      discountAmount: 0,
    });
    const saleId = (result.sale as { id: string }).id;
    expect(await documentFor('sale', saleId)).toMatchObject({ totalAmount: 4737.5 });
    const weighedLine = await getDatabase()
      .select({ id: saleItems.id })
      .from(saleItems)
      .where(and(eq(saleItems.saleId, saleId), eq(saleItems.productId, weighedId)))
      .get();

    await returnSale(context(), {
      id: saleId,
      items: [{ saleItemId: weighedLine!.id, quantity: 1.25 }],
      reason: 'whole weight',
    });
    const header = await getDatabase()
      .select({
        id: saleReturns.id,
        refundAmount: saleReturns.refundAmount,
        roundingAdjustment: saleReturns.roundingAdjustment,
      })
      .from(saleReturns)
      .where(eq(saleReturns.saleId, saleId))
      .get();
    expect(header).toMatchObject({ refundAmount: 3738, roundingAdjustment: 0.5 });
    expect(await documentFor('return', header!.id)).toEqual({ kind: 'NC', totalAmount: 3737.5 });
  });

  it('voids a rounded sale with a document at the invoiced gross', async () => {
    const productId = await seedProduct(2990);
    const result = await completeSale(context(), {
      mode: 'fresh',
      customerId: null,
      items: [{ productId, unitId, quantity: 1.25, unitPrice: 2990, discount: 0 }],
      paymentMethod: 'cash',
      paymentStatus: 'paid',
      status: 'completed',
      amountReceived: 4000,
      discountAmount: 0,
    });
    const saleId = (result.sale as { id: string }).id;
    expect(
      await getDatabase()
        .select({ total: sales.total, roundingAdjustment: sales.roundingAdjustment })
        .from(sales)
        .where(eq(sales.id, saleId))
        .get()
    ).toEqual({ total: 3738, roundingAdjustment: 0.5 });

    await voidSale(context(), { id: saleId, reason: 'wrong product' });
    expect(await documentFor('void', saleId)).toMatchObject({ totalAmount: 3737.5 });
  });
});
