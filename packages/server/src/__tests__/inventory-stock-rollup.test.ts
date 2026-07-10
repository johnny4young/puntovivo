/**
 * ENG-197 — materialized product stock rollup (`product_stock_totals`).
 *
 * The rollup is maintained EXCLUSIVELY by the SQLite triggers of migration
 * 0008; application code never writes it. This suite pins the invariant
 * `rollup.total ≡ Σ(inventory_balances.on_hand)` under the mutation shapes
 * production uses:
 *   - direct INSERT of balance rows (the fixture/seed path);
 *   - UPDATE of on_hand (raw and via applyInventoryBalanceDelta);
 *   - DELETE of a balance row;
 *   - a real sale + refund round-trip through the use-cases;
 *   - multi-tenant isolation of the totals.
 *
 * The broader parity net is the whole server suite: transfers/inventory/sales
 * tests assert stock via getProductStockTotal, which now reads the rollup —
 * any writer the triggers missed would fail those suites.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq, sql } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { createServer, type PuntovivoServer } from '../index.js';
import { getDatabase } from '../db/index.js';
import {
  companies,
  inventoryBalances,
  products,
  productStockTotals,
  sites,
  tenants,
  unitXProduct,
  units,
  users,
} from '../db/schema.js';
import { applyInventoryBalanceDelta } from '../services/inventory-balances/apply-delta.js';
import {
  getProductStockTotal,
  getProductStockTotals,
} from '../services/inventory-balances/derive.js';
import { completeSale } from '../application/sales/completeSale.js';
import { returnSale } from '../application/sales/returnSale.js';
import type { CompleteSaleContext } from '../application/sales/types.js';
import { registerDevice as registerDeviceService } from '../services/devices/devicesService.js';
import { makeFreshContextFactory } from './utils/criticalCommandFixture.js';
import { appRouter } from '../trpc/router.js';

let server: PuntovivoServer;
let tenantId: string;
let userId: string;
let siteId: string;
let baseUnitId: string;

/** rollup.total for (tenant, product), or null when no row exists. */
function rollupTotal(tid: string, productId: string): number | null {
  const row = getDatabase()
    .select({ total: productStockTotals.total })
    .from(productStockTotals)
    .where(and(eq(productStockTotals.tenantId, tid), eq(productStockTotals.productId, productId)))
    .get();
  return row?.total ?? null;
}

/** Raw Σ(on_hand) recomputed from the authoritative balances. */
function rawSum(tid: string, productId: string): number {
  const row = getDatabase()
    .select({ total: sql<number>`coalesce(sum(${inventoryBalances.onHand}), 0)` })
    .from(inventoryBalances)
    .where(and(eq(inventoryBalances.tenantId, tid), eq(inventoryBalances.productId, productId)))
    .get();
  return row?.total ?? 0;
}

/** The contract: rollup, raw sum, and the derive readers all agree. */
function expectParity(tid: string, productId: string): void {
  const raw = rawSum(tid, productId);
  expect(rollupTotal(tid, productId) ?? 0).toBeCloseTo(raw, 9);
  expect(getProductStockTotal(getDatabase(), tid, productId)).toBeCloseTo(raw, 9);
  expect(getProductStockTotals(getDatabase(), tid, [productId]).get(productId)).toBeCloseTo(raw, 9);
}

function buildSaleContext(): CompleteSaleContext {
  return {
    db: getDatabase(),
    tenantId,
    siteId,
    user: { id: userId, role: 'admin' },
    envelope: null,
    deviceId: null,
    log: undefined,
  };
}

async function seedProduct(name: string, sku: string): Promise<string> {
  const db = getDatabase();
  const id = nanoid();
  const now = new Date().toISOString();
  await db.insert(products).values({
    id,
    tenantId,
    name,
    sku,
    price: 100,
    price2: 100,
    price3: 100,
    cost: 40,
    marginPercent1: 0,
    marginPercent2: 0,
    marginPercent3: 0,
    marginAmount1: 0,
    marginAmount2: 0,
    marginAmount3: 0,
    taxRate: 0,
    initialCost: 40,
    minStock: 0,
    isActive: true,
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(unitXProduct).values({
    id: nanoid(),
    productId: id,
    unitId: baseUnitId,
    equivalence: 1,
    price: 100,
    isBase: true,
    createdAt: now,
    updatedAt: now,
  });
  return id;
}

describe('product stock rollup (ENG-197)', () => {
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
    siteId = site.id;
    const baseUnit = (await db.select().from(units).where(eq(units.tenantId, tenantId)).all()).find(
      unit => unit.abbreviation === 'UND'
    );
    if (!baseUnit) throw new Error('Expected seeded base unit');
    baseUnitId = baseUnit.id;

    // The sale round-trip drives the real use-cases, which require an open
    // cash session for the (tenant, site, cashier) triple.
    const reg = await registerDeviceService(db, {
      tenantId,
      userId,
      kind: 'web',
      name: 'inventory-stock-rollup.test',
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
    await appRouter.createCaller(fresh()).cashSessions.open({
      registerName: 'rollup register',
      openingFloat: 500,
      denominations: [{ value: 100, count: 5 }],
    });
  });

  afterAll(async () => {
    await server.close();
  });

  it('tracks direct inserts across multiple sites (the fixture/seed shape)', async () => {
    const db = getDatabase();
    const productId = await seedProduct('Rollup Multi-site', 'RU-MS');
    const now = new Date().toISOString();

    // Second site so the total genuinely aggregates.
    const companyRow = await db
      .select({ companyId: sites.companyId })
      .from(sites)
      .where(eq(sites.id, siteId))
      .get();
    const siteB = nanoid();
    await db.insert(sites).values({
      id: siteB,
      tenantId,
      companyId: companyRow!.companyId,
      name: 'Rollup Site B',
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });

    expect(rollupTotal(tenantId, productId)).toBeNull();
    await db.insert(inventoryBalances).values([
      {
        id: nanoid(),
        tenantId,
        siteId,
        productId,
        onHand: 7.5,
        reserved: 0,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: nanoid(),
        tenantId,
        siteId: siteB,
        productId,
        onHand: 2.25,
        reserved: 0,
        createdAt: now,
        updatedAt: now,
      },
    ]);
    expect(rollupTotal(tenantId, productId)).toBeCloseTo(9.75, 9);
    expectParity(tenantId, productId);
  });

  it('tracks raw on_hand updates and deletes', async () => {
    const db = getDatabase();
    const productId = await seedProduct('Rollup RawOps', 'RU-RAW');
    const now = new Date().toISOString();
    const rowId = nanoid();
    await db.insert(inventoryBalances).values({
      id: rowId,
      tenantId,
      siteId,
      productId,
      onHand: 10,
      reserved: 0,
      createdAt: now,
      updatedAt: now,
    });

    await db
      .update(inventoryBalances)
      .set({ onHand: 4.5, updatedAt: now })
      .where(eq(inventoryBalances.id, rowId));
    expect(rollupTotal(tenantId, productId)).toBeCloseTo(4.5, 9);
    expectParity(tenantId, productId);

    // Updates that do NOT touch on_hand must not fire the delta trigger.
    await db
      .update(inventoryBalances)
      .set({ syncStatus: 'synced' })
      .where(eq(inventoryBalances.id, rowId));
    expect(rollupTotal(tenantId, productId)).toBeCloseTo(4.5, 9);

    await db.delete(inventoryBalances).where(eq(inventoryBalances.id, rowId));
    expect(rollupTotal(tenantId, productId)).toBeCloseTo(0, 9);
    expectParity(tenantId, productId);
  });

  it('tracks applyInventoryBalanceDelta (the central write helper)', async () => {
    const db = getDatabase();
    const productId = await seedProduct('Rollup Delta', 'RU-DELTA');
    db.transaction(tx => {
      applyInventoryBalanceDelta(tx, {
        tenantId,
        siteId,
        productId,
        delta: 12,
        initialOnHandIfMissing: 0,
      });
    });
    expectParity(tenantId, productId);
    db.transaction(tx => {
      applyInventoryBalanceDelta(tx, { tenantId, siteId, productId, delta: -3.25 });
    });
    expect(rollupTotal(tenantId, productId)).toBeCloseTo(8.75, 9);
    expectParity(tenantId, productId);
  });

  it('stays in parity through a real sale and refund round-trip', async () => {
    const db = getDatabase();
    const productId = await seedProduct('Rollup Sale', 'RU-SALE');
    const now = new Date().toISOString();
    await db.insert(inventoryBalances).values({
      id: nanoid(),
      tenantId,
      siteId,
      productId,
      onHand: 20,
      reserved: 0,
      createdAt: now,
      updatedAt: now,
    });

    const sale = await completeSale(buildSaleContext(), {
      mode: 'fresh',
      customerId: null,
      items: [{ productId, unitId: baseUnitId, quantity: 6, unitPrice: 100, discount: 0 }],
      paymentMethod: 'cash',
      paymentStatus: 'paid',
      status: 'completed',
      amountReceived: 600,
      discountAmount: 0,
    });
    expect(rollupTotal(tenantId, productId)).toBeCloseTo(14, 9);
    expectParity(tenantId, productId);

    const saleId = (sale.sale as { id: string }).id;
    await returnSale(buildSaleContext(), { id: saleId, reason: 'rollup parity test' });
    expect(rollupTotal(tenantId, productId)).toBeCloseTo(20, 9);
    expectParity(tenantId, productId);
  });

  it('isolates totals per tenant', async () => {
    const db = getDatabase();
    const now = new Date().toISOString();
    const productId = await seedProduct('Rollup TenantA', 'RU-TA');
    await db.insert(inventoryBalances).values({
      id: nanoid(),
      tenantId,
      siteId,
      productId,
      onHand: 5,
      reserved: 0,
      createdAt: now,
      updatedAt: now,
    });

    // Foreign tenant with a balance row for ITS OWN product.
    const tenantB = nanoid();
    const userB = nanoid();
    await db.insert(tenants).values({
      id: tenantB,
      name: 'Rollup Tenant B',
      slug: `rollup-b-${nanoid(6)}`,
      settings: {},
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(users).values({
      id: userB,
      tenantId: tenantB,
      email: `rollup-b-${nanoid(6)}@example.com`,
      passwordHash: 'x',
      name: 'B',
      role: 'admin',
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });
    const productB = nanoid();
    await db.insert(products).values({
      id: productB,
      tenantId: tenantB,
      name: 'B product',
      sku: 'RU-TB',
      price: 1,
      cost: 1,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });
    const companyB = nanoid();
    await db
      .insert(companies)
      .values({ id: companyB, tenantId: tenantB, name: 'B co', createdAt: now, updatedAt: now });
    const siteB = nanoid();
    await db.insert(sites).values({
      id: siteB,
      tenantId: tenantB,
      companyId: companyB,
      name: 'B site',
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(inventoryBalances).values({
      id: nanoid(),
      tenantId: tenantB,
      siteId: siteB,
      productId: productB,
      onHand: 999,
      reserved: 0,
      createdAt: now,
      updatedAt: now,
    });

    expect(rollupTotal(tenantId, productId)).toBeCloseTo(5, 9);
    expect(rollupTotal(tenantB, productB)).toBeCloseTo(999, 9);
    expect(getProductStockTotal(db, tenantId, productB)).toBe(0);
    expectParity(tenantId, productId);
    expectParity(tenantB, productB);
  });
});
