/**
 * A sale reads tenant settings and locale from many helpers. Inside
 * completeSale the pre-transaction readers share one read each.
 */
import type Database from 'better-sqlite3';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { createServer, type PuntovivoServer } from '../index.js';
import { getDatabase } from '../db/index.js';
import { sites, units, users } from '../db/schema.js';
import { registerDevice } from '../services/devices/devicesService.js';
import { appRouter } from '../trpc/router.js';
import { makeFreshContextFactory } from './utils/criticalCommandFixture.js';

const CART = ['memo-product-0', 'memo-product-1', 'memo-product-2'];
let server: PuntovivoServer;
let sqlite: Database.Database;
let fresh: ReturnType<typeof makeFreshContextFactory>;
let unitId = '';

beforeAll(async () => {
  server = await createServer({ dbPath: ':memory:', verbose: false });
  const db = getDatabase();
  sqlite = (db as unknown as { $client: Database.Database }).$client;
  const admin = db.select().from(users).where(eq(users.email, 'admin@localhost')).get();
  if (!admin) throw new Error('Expected seeded admin');
  const site = db
    .select()
    .from(sites)
    .where(and(eq(sites.tenantId, admin.tenantId), eq(sites.isActive, true)))
    .get();
  const unit = db
    .select()
    .from(units)
    .where(eq(units.tenantId, admin.tenantId))
    .all()
    .find(row => row.abbreviation === 'UND');
  if (!site || !unit) throw new Error('Expected seeded site and base unit');
  unitId = unit.id;
  const now = '2026-11-05T00:00:00.000Z';
  for (const id of CART) {
    sqlite
      .prepare(
        `INSERT INTO products (id, tenant_id, name, sku, price, price2, price3, cost, initial_cost,
           is_active, tracks_stock, created_at, updated_at)
         VALUES (?, ?, ?, ?, 10, 10, 10, 5, 5, 1, 1, ?, ?)`
      )
      .run(id, admin.tenantId, id, id, now, now);
    sqlite
      .prepare(
        `INSERT INTO inventory_balances (id, tenant_id, site_id, product_id, on_hand, reserved,
           created_at, updated_at) VALUES (?, ?, ?, ?, 100, 0, ?, ?)`
      )
      .run(`balance-${id}`, admin.tenantId, site.id, id, now, now);
    sqlite
      .prepare(
        `INSERT INTO unit_x_product (id, product_id, unit_id, equivalence, price, is_base,
           created_at, updated_at) VALUES (?, ?, ?, 1, 10, 1, ?, ?)`
      )
      .run(`unit-${id}`, id, unit.id, now, now);
  }
  const device = await registerDevice(db, {
    tenantId: admin.tenantId,
    userId: admin.id,
    kind: 'web',
    name: 'sale-request-memo',
  });
  fresh = makeFreshContextFactory({
    db,
    serverApp: server.app,
    tenantId: admin.tenantId,
    userId: admin.id,
    email: admin.email,
    siteId: site.id,
    deviceId: device.deviceId,
  });
  await appRouter.createCaller(fresh()).cashSessions.open({
    registerName: 'Memo register',
    openingFloat: 0,
    denominations: [],
  });
}, 30_000);

afterAll(async () => {
  await server.close();
});

describe('sale request memo', () => {
  it('reads tenant settings and locale once per sale', async () => {
    const original = sqlite.prepare;
    const prepared: string[] = [];
    sqlite.prepare = ((source: string) => {
      prepared.push(source);
      return original.call(sqlite, source);
    }) as typeof sqlite.prepare;
    try {
      await appRouter.createCaller(fresh()).sales.create({
        items: CART.map(productId => ({
          productId,
          unitId,
          quantity: 1,
          unitPrice: 10,
          discount: 0,
        })),
        paymentMethod: 'cash',
        paymentStatus: 'paid',
        status: 'completed',
        amountReceived: 30,
        discountAmount: 0,
      });
    } finally {
      sqlite.prepare = original;
    }

    const count = (pattern: RegExp) => prepared.filter(source => pattern.test(source)).length;
    // Pricing, restaurant and loyalty share one read; the KDS gate, both DIAN
    // checks and the journal projection keep reading the current row.
    expect(count(/^select "settings" from "tenants"/)).toBe(5);
    expect(count(/^select "tenant_id", "country_code"/)).toBe(1);
  });
});
