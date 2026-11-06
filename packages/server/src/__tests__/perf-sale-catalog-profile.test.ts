/**
 * Sale cost against a store-sized catalog.
 *
 * Runs only through scripts/run-sale-catalog-profile-gate.mjs. A checkout must
 * cost what its cart costs: work proportional to the catalog passes every
 * small-fixture gate and still costs seconds per sale in a large store.
 */
import Database from 'better-sqlite3';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { performance } from 'node:perf_hooks';

import { createServer, type PuntovivoServer } from '../index.js';
import { getDatabase } from '../db/index.js';
import { sites, units, users } from '../db/schema.js';
import { computePercentile, loadPerfBudget } from '../perf/budgets.js';
import { registerDevice } from '../services/devices/devicesService.js';
import { appRouter } from '../trpc/router.js';
import { makeFreshContextFactory } from './utils/criticalCommandFixture.js';

const budget = loadPerfBudget().saleCatalogProfile;
const CART_PRODUCTS = 3;
const UNIT_PRICE = 10;
const BALANCE_INSERT = /^\s*insert\s+into\s+"?inventory_balances"?/i;

let server: PuntovivoServer | undefined;
let fresh: ReturnType<typeof makeFreshContextFactory>;
let tenantId = '';
let siteId = '';
let baseUnitId = '';
let buildElapsedMs = 0;
let p95Ms = 0;
let maxBalanceInserts = 0;
const samplesMs: number[] = [];
const cartIds = Array.from({ length: CART_PRODUCTS }, (_, index) => `sale-profile-cart-${index}`);

function liveClient(): Database.Database {
  return (getDatabase() as unknown as { $client: Database.Database }).$client;
}

/** Every catalog product already has its balance row: the state of a store after its first day. */
function insertCatalog(): void {
  const sqlite = liveClient();
  const now = '2026-11-05T00:00:00.000Z';
  const insertProduct = sqlite.prepare(
    `INSERT INTO products (
       id, tenant_id, name, sku, price, price2, price3, cost, initial_cost,
       is_active, tracks_stock, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, 5, 5, 1, 1, ?, ?)`
  );
  const insertBalance = sqlite.prepare(
    `INSERT INTO inventory_balances (
       id, tenant_id, site_id, product_id, on_hand, reserved, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, 0, ?, ?)`
  );
  const insertUnit = sqlite.prepare(
    `INSERT INTO unit_x_product (
       id, product_id, unit_id, equivalence, price, is_base, created_at, updated_at
     ) VALUES (?, ?, ?, 1, ?, 1, ?, ?)`
  );
  sqlite.transaction(() => {
    for (let sequence = 0; sequence < budget.catalogProducts; sequence += 1) {
      const isCart = sequence < CART_PRODUCTS;
      const id = isCart ? cartIds[sequence]! : `sale-profile-product-${sequence}`;
      const sku = `SALE-PROFILE-${String(sequence).padStart(6, '0')}`;
      insertProduct.run(id, tenantId, `Sale Profile ${sku}`, sku, 10, 10, 10, now, now);
      insertBalance.run(`balance-${id}`, tenantId, siteId, id, isCart ? 1_000_000 : 0, now, now);
      if (isCart) insertUnit.run(`unit-${id}`, id, baseUnitId, UNIT_PRICE, now, now);
    }
  })();
}

/** Counts statements the driver prepares while `run` executes. */
async function countBalanceInserts(run: () => Promise<unknown>): Promise<number> {
  const sqlite = liveClient();
  const original = sqlite.prepare;
  let inserts = 0;
  sqlite.prepare = ((source: string) => {
    if (BALANCE_INSERT.test(source)) inserts += 1;
    return original.call(sqlite, source);
  }) as typeof sqlite.prepare;
  try {
    await run();
  } finally {
    sqlite.prepare = original;
  }
  return inserts;
}

async function sell(): Promise<void> {
  await appRouter.createCaller(fresh()).sales.create({
    items: cartIds.map(productId => ({
      productId,
      unitId: baseUnitId,
      quantity: 1,
      unitPrice: UNIT_PRICE,
      discount: 0,
    })),
    paymentMethod: 'cash',
    paymentStatus: 'paid',
    status: 'completed',
    amountReceived: CART_PRODUCTS * UNIT_PRICE,
    discountAmount: 0,
  });
}

describe('sale against a store-sized catalog', () => {
  beforeAll(async () => {
    server = await createServer({ dbPath: ':memory:', verbose: false });
    const db = getDatabase();
    const admin = db.select().from(users).where(eq(users.email, 'admin@localhost')).get();
    if (!admin) throw new Error('Expected seeded admin');
    tenantId = admin.tenantId;
    const site = db
      .select()
      .from(sites)
      .where(and(eq(sites.tenantId, tenantId), eq(sites.isActive, true)))
      .get();
    const unit = db
      .select()
      .from(units)
      .where(eq(units.tenantId, tenantId))
      .all()
      .find(row => row.abbreviation === 'UND');
    if (!site || !unit) throw new Error('Expected seeded site and base unit');
    siteId = site.id;
    baseUnitId = unit.id;

    const buildStartedAt = performance.now();
    insertCatalog();
    buildElapsedMs = performance.now() - buildStartedAt;

    const device = await registerDevice(db, {
      tenantId,
      userId: admin.id,
      kind: 'web',
      name: 'perf-sale-catalog-profile',
    });
    fresh = makeFreshContextFactory({
      db,
      serverApp: server.app,
      tenantId,
      userId: admin.id,
      email: admin.email,
      siteId,
      deviceId: device.deviceId,
    });
    await appRouter.createCaller(fresh()).cashSessions.open({
      registerName: 'Sale profile register',
      openingFloat: 0,
      denominations: [],
    });
  }, 180_000);

  afterAll(async () => {
    process.stdout.write(
      `sale-catalog-profile measured=${JSON.stringify({
        catalogProducts: budget.catalogProducts,
        buildElapsedMs: Number(buildElapsedMs.toFixed(2)),
        p95Ms: Number(p95Ms.toFixed(2)),
        maxBalanceInserts,
        samplesMs: samplesMs.map(sample => Number(sample.toFixed(2))),
      })}\n`
    );
    if (server) await server.close();
  });

  it('keeps balance writes and checkout time independent of catalog size', async () => {
    for (let warmup = 0; warmup < budget.warmupSales; warmup += 1) await sell();

    for (let sample = 0; sample < budget.samples; sample += 1) {
      let elapsedMs = 0;
      const inserts = await countBalanceInserts(async () => {
        const startedAt = performance.now();
        await sell();
        elapsedMs = performance.now() - startedAt;
      });
      samplesMs.push(elapsedMs);
      maxBalanceInserts = Math.max(maxBalanceInserts, inserts);
    }
    p95Ms = computePercentile(samplesMs, 95);

    expect(maxBalanceInserts).toBeLessThanOrEqual(CART_PRODUCTS);
    expect(p95Ms).toBeLessThanOrEqual(budget.p95Ms * (1 + budget.thresholdPercent / 100));
  }, 180_000);
});
