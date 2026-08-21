/**
 * Invariant tests for the flexible tax model (H2.1).
 *
 * Two seams, one shared split:
 * - `tenants.settings.pricing.priceIncludesTax` switches the whole engine
 *   between tax-inclusive catalog prices (the default, byte-identical to
 *   the historical behavior) and tax-exclusive pricing.
 * - `vat_rates.kind` ('iva' | 'inc') rides with the rate into the product
 *   and freezes on the sale line, so a Colombian restaurant charging INC
 *   instead of IVA classifies correctly all the way into the fiscal
 *   document's DIAN category codes and the CUFE's '04' slot.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { createServer, type PuntovivoServer } from '../index.js';
import { getDatabase } from '../db/index.js';
import { registerDevice as registerDeviceService } from '../services/devices/devicesService.js';
import {
  auditLogs,
  inventoryBalances,
  products,
  saleItems,
  sites,
  unitXProduct,
  units,
  users,
} from '../db/schema.js';
import { appRouter } from '../trpc/router.js';
import { completeSale } from '../application/sales/completeSale.js';
import { resolveLines } from '../services/fiscal/orchestrator/snapshots.js';
import { sumTaxTotals, taxCategoryCodeFor } from '../services/fiscal/orchestrator/tax-lines.js';
import type { CompleteSaleContext } from '../application/sales/types.js';
import { makeFreshContextFactory } from './utils/criticalCommandFixture.js';

let server: PuntovivoServer;
let tenantId: string;
let userId: string;
let siteId: string;
let baseUnitId: string;
let makeCaller: () => ReturnType<typeof appRouter.createCaller>;

function buildContext(overrides: Partial<CompleteSaleContext> = {}): CompleteSaleContext {
  return {
    db: getDatabase(),
    tenantId,
    siteId,
    user: { id: userId, role: 'admin' },
    envelope: null,
    deviceId: null,
    log: undefined,
    ...overrides,
  };
}

async function seedProduct(args: {
  name: string;
  sku: string;
  price: number;
  taxRate: number;
  taxKind?: 'iva' | 'inc';
  stock?: number;
}): Promise<string> {
  const db = getDatabase();
  const productId = nanoid();
  const now = new Date().toISOString();
  await db.insert(products).values({
    id: productId,
    tenantId,
    name: args.name,
    sku: args.sku,
    price: args.price,
    price2: args.price,
    price3: args.price,
    cost: 1,
    marginPercent1: 0,
    marginPercent2: 0,
    marginPercent3: 0,
    marginAmount1: 0,
    marginAmount2: 0,
    marginAmount3: 0,
    taxRate: args.taxRate,
    taxKind: args.taxKind ?? 'iva',
    initialCost: 1,
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
    price: args.price,
    isBase: true,
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(inventoryBalances).values({
    id: nanoid(),
    tenantId,
    siteId,
    productId,
    onHand: args.stock ?? 50,
    reserved: 0,
    createdAt: now,
    updatedAt: now,
  });
  return productId;
}

async function sellOne(productId: string, unitPrice: number) {
  return completeSale(buildContext(), {
    mode: 'fresh',
    items: [{ productId, unitId: baseUnitId, quantity: 1, unitPrice, discount: 0 }],
    paymentMethod: 'cash',
    paymentStatus: 'paid',
    status: 'completed',
    amountReceived: 100_000,
    discountAmount: 0,
  });
}

beforeAll(async () => {
  server = await createServer({ dbPath: ':memory:', verbose: false });
  const db = getDatabase();

  const seededUser = await db.select().from(users).where(eq(users.email, 'admin@localhost')).get();
  if (!seededUser) throw new Error('Expected seeded admin user');
  tenantId = seededUser.tenantId;
  userId = seededUser.id;

  const seededSite = await db
    .select()
    .from(sites)
    .where(and(eq(sites.tenantId, tenantId), eq(sites.isActive, true)))
    .get();
  if (!seededSite) throw new Error('Expected seeded site');
  siteId = seededSite.id;

  const seededUnits = await db.select().from(units).where(eq(units.tenantId, tenantId)).all();
  const baseUnit = seededUnits.find(unit => unit.abbreviation === 'UND');
  if (!baseUnit) throw new Error('Expected seeded unit UND');
  baseUnitId = baseUnit.id;

  const reg = await registerDeviceService(db, {
    tenantId,
    userId,
    kind: 'web',
    name: 'tax-model.test',
  });

  const fresh = makeFreshContextFactory({
    db,
    serverApp: server.app,
    tenantId,
    userId,
    email: 'admin@localhost',
    siteId,
    deviceId: reg.deviceId,
    defaultRole: 'admin',
  });
  makeCaller = () => appRouter.createCaller(fresh());
  await makeCaller().cashSessions.open({
    registerName: 'Tax model register',
    openingFloat: 100,
    denominations: [{ value: 100, count: 1 }],
  });
});

afterAll(async () => {
  await server.close();
});

describe('priceIncludesTax pricing mode', () => {
  it('defaults to tax-inclusive and reads through the settings procedure', async () => {
    const settings = await makeCaller().companies.getPricingSettings();
    expect(settings.priceIncludesTax).toBe(true);
  });

  it('extracts the tax from the price in inclusive mode', async () => {
    const productId = await seedProduct({
      name: 'Inclusive widget',
      sku: 'TAX-INC-W',
      price: 119,
      taxRate: 19,
    });

    const result = await sellOne(productId, 119);
    expect(result.sale.subtotal).toBe(100);
    expect(result.sale.taxAmount).toBe(19);
    expect(result.sale.total).toBe(119);
  });

  it('adds the tax on top in exclusive mode, and the flip is audited', async () => {
    const caller = makeCaller();
    await caller.companies.updatePriceIncludesTax({ priceIncludesTax: false });

    const settings = await caller.companies.getPricingSettings();
    expect(settings.priceIncludesTax).toBe(false);

    const auditRow = await getDatabase()
      .select()
      .from(auditLogs)
      .where(
        and(eq(auditLogs.tenantId, tenantId), eq(auditLogs.action, 'pricing.tax_mode.updated'))
      )
      .get();
    expect(auditRow?.before).toMatchObject({ priceIncludesTax: true });
    expect(auditRow?.after).toMatchObject({ priceIncludesTax: false });

    try {
      const productId = await seedProduct({
        name: 'Exclusive widget',
        sku: 'TAX-EXC-W',
        price: 100,
        taxRate: 19,
      });
      const result = await sellOne(productId, 100);
      expect(result.sale.subtotal).toBe(100);
      expect(result.sale.taxAmount).toBe(19);
      expect(result.sale.total).toBe(119);
    } finally {
      await caller.companies.updatePriceIncludesTax({ priceIncludesTax: true });
    }
  });

  it('prices quotations in the same mode as sales', async () => {
    const caller = makeCaller();
    const productId = await seedProduct({
      name: 'Quoted widget',
      sku: 'TAX-QUO-W',
      price: 100,
      taxRate: 19,
    });

    await caller.companies.updatePriceIncludesTax({ priceIncludesTax: false });
    try {
      const quotation = await caller.quotations.create({
        siteId,
        items: [{ productId, quantity: 2, unitPrice: 100, discount: 0, taxRate: 19 }],
      });
      // Exclusive: 200 base + 38 tax. The create result carries only the
      // total; the split lives on the stored header.
      expect(quotation.total).toBe(238);
      const stored = await caller.quotations.getById({ id: quotation.id });
      expect(stored.subtotal).toBe(200);
      expect(stored.taxAmount).toBe(38);
    } finally {
      await caller.companies.updatePriceIncludesTax({ priceIncludesTax: true });
    }
  });
});

describe('INC as a first-class tax kind', () => {
  it('flows from the vat rate through the product to the frozen sale line', async () => {
    const caller = makeCaller();
    const incRate = await caller.vatRates.create({ name: 'INC 8% (test)', rate: 8, kind: 'inc' });
    expect(incRate.kind).toBe('inc');

    const created = await caller.products.create({
      name: 'Almuerzo del día',
      sku: `INC-MENU-${nanoid(6)}`,
      price: 27_000,
      vatRateId: incRate.id,
      stock: 0,
      tracksStock: false,
    });
    expect(created.taxKind).toBe('inc');
    expect(created.taxRate).toBe(8);

    const result = await sellOne(created.id, 27_000);
    const line = await getDatabase()
      .select()
      .from(saleItems)
      .where(eq(saleItems.saleId, result.sale.id))
      .get();
    expect(line?.taxKind).toBe('inc');
    // 27,000 inclusive at 8% -> 25,000 base + 2,000 INC.
    expect(result.sale.subtotal).toBe(25_000);
    expect(result.sale.taxAmount).toBe(2_000);
  });

  it('re-stamps dependent products when a rate kind is corrected', async () => {
    const caller = makeCaller();
    const rate = await caller.vatRates.create({ name: 'Tarifa 8% (fix)', rate: 8, kind: 'iva' });
    const created = await caller.products.create({
      name: 'Menú mal clasificado',
      sku: `FIX-KIND-${nanoid(6)}`,
      price: 10_000,
      vatRateId: rate.id,
      stock: 0,
      tracksStock: false,
    });
    expect(created.taxKind).toBe('iva');

    await caller.vatRates.update({ id: rate.id, kind: 'inc' });

    const product = await getDatabase()
      .select({ taxKind: products.taxKind })
      .from(products)
      .where(eq(products.id, created.id))
      .get();
    expect(product?.taxKind).toBe('inc');
  });

  it('resets the kind when the vat-rate link is cleared to a manual rate', async () => {
    const caller = makeCaller();
    const incRate = await caller.vatRates.create({ name: 'INC 8% (clr)', rate: 8, kind: 'inc' });
    const created = await caller.products.create({
      name: 'Plato que deja INC',
      sku: `CLR-KIND-${nanoid(6)}`,
      price: 10_000,
      vatRateId: incRate.id,
      stock: 0,
      tracksStock: false,
    });
    expect(created.taxKind).toBe('inc');

    const updated = await caller.products.update({
      id: created.id,
      version: created.version,
      vatRateId: null,
      taxRate: 19,
    });
    expect(updated.taxRate).toBe(19);
    expect(updated.taxKind).toBe('iva');
  });

  it('copies the parent tax kind onto every generated variant', async () => {
    const caller = makeCaller();
    const incRate = await caller.vatRates.create({ name: 'INC 8% (var)', rate: 8, kind: 'inc' });
    const parent = await caller.products.create({
      name: 'Combo del día',
      sku: `INC-COMBO-${nanoid(6)}`,
      price: 20_000,
      vatRateId: incRate.id,
      stock: 0,
      tracksStock: false,
    });

    const created = await caller.products.createVariantMatrix({
      parentProductId: parent.id,
      axes: [{ name: 'Tamaño', values: ['Personal', 'Familiar'] }],
    });
    expect(created.variants).toHaveLength(2);

    const children = await getDatabase()
      .select({ taxKind: products.taxKind })
      .from(products)
      .where(and(eq(products.tenantId, tenantId), eq(products.variantParentId, parent.id)))
      .all();
    expect(children).toHaveLength(2);
    expect(children.every(child => child.taxKind === 'inc')).toBe(true);
  });

  it('classifies the fiscal lines and buckets the CUFE totals by kind', async () => {
    const caller = makeCaller();
    const incRate = await caller.vatRates.create({ name: 'INC 8% (mix)', rate: 8, kind: 'inc' });
    const menuId = (
      await caller.products.create({
        name: 'Plato mixto',
        sku: `INC-MIX-${nanoid(6)}`,
        price: 10_800,
        vatRateId: incRate.id,
        stock: 0,
        tracksStock: false,
      })
    ).id;
    const sodaId = await seedProduct({
      name: 'Gaseosa',
      sku: 'IVA-SODA',
      price: 5_950,
      taxRate: 19,
    });

    // A mixed table: prepared food at INC, packaged drink at IVA.
    const result = await completeSale(buildContext(), {
      mode: 'fresh',
      items: [
        { productId: menuId, unitId: baseUnitId, quantity: 1, unitPrice: 10_800, discount: 0 },
        { productId: sodaId, unitId: baseUnitId, quantity: 1, unitPrice: 5_950, discount: 0 },
      ],
      paymentMethod: 'cash',
      paymentStatus: 'paid',
      status: 'completed',
      amountReceived: 20_000,
      discountAmount: 0,
    });

    const lines = await resolveLines(getDatabase(), tenantId, result.sale.id);
    expect(lines).toHaveLength(2);
    const byKind = new Map(lines.map(line => [line.taxKind, line]));
    expect(taxCategoryCodeFor(byKind.get('inc')!.taxKind)).toBe('04');
    expect(taxCategoryCodeFor(byKind.get('iva')!.taxKind)).toBe('01');

    const totals = sumTaxTotals(lines);
    // 10,800 inclusive at 8% -> 800 INC; 5,950 inclusive at 19% -> 950 IVA.
    expect(totals.incAmount).toBe(800);
    expect(totals.ivaAmount).toBe(950);
  });
});
