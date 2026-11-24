/**
 * A manual counter rewind must not let the register reissue a sale number.
 */
import type Database from 'better-sqlite3';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, desc, eq } from 'drizzle-orm';
import { createServer, type PuntovivoServer } from '../index.js';
import { getDatabase } from '../db/index.js';
import { auditLogs, sequentials, sites, units, users } from '../db/schema.js';
import { registerDevice } from '../services/devices/devicesService.js';
import { getHighestIssuedSequentialValue } from '../services/sequential-issued.js';
import { appRouter } from '../trpc/router.js';
import { makeFreshContextFactory } from './utils/criticalCommandFixture.js';

const PRODUCT_ID = 'rewind-product';
let server: PuntovivoServer;
let fresh: ReturnType<typeof makeFreshContextFactory>;
let tenantId = '';
let siteId = '';
let unitId = '';

function saleSequential() {
  const row = getDatabase()
    .select()
    .from(sequentials)
    .where(
      and(
        eq(sequentials.tenantId, tenantId),
        eq(sequentials.siteId, siteId),
        eq(sequentials.documentType, 'sale')
      )
    )
    .get();
  if (!row) throw new Error('Expected seeded sale sequential');
  return row;
}

function sell() {
  return appRouter.createCaller(fresh()).sales.create({
    items: [{ productId: PRODUCT_ID, unitId, quantity: 1, unitPrice: 10, discount: 0 }],
    paymentMethod: 'cash',
    paymentStatus: 'paid',
    status: 'completed',
    amountReceived: 10,
    discountAmount: 0,
  });
}

beforeAll(async () => {
  server = await createServer({ dbPath: ':memory:', verbose: false });
  const db = getDatabase();
  const sqlite = (db as unknown as { $client: Database.Database }).$client;
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
  unitId = unit.id;
  const now = '2026-11-05T00:00:00.000Z';
  sqlite
    .prepare(
      `INSERT INTO products (id, tenant_id, name, sku, price, price2, price3, cost, initial_cost,
         is_active, tracks_stock, created_at, updated_at)
       VALUES (?, ?, ?, ?, 10, 10, 10, 5, 5, 1, 1, ?, ?)`
    )
    .run(PRODUCT_ID, tenantId, PRODUCT_ID, PRODUCT_ID, now, now);
  sqlite
    .prepare(
      `INSERT INTO inventory_balances (id, tenant_id, site_id, product_id, on_hand, reserved,
         created_at, updated_at) VALUES (?, ?, ?, ?, 100, 0, ?, ?)`
    )
    .run('rewind-balance', tenantId, siteId, PRODUCT_ID, now, now);
  sqlite
    .prepare(
      `INSERT INTO unit_x_product (id, product_id, unit_id, equivalence, price, is_base,
         created_at, updated_at) VALUES (?, ?, ?, 1, 10, 1, ?, ?)`
    )
    .run('rewind-unit', PRODUCT_ID, unitId, now, now);
  const device = await registerDevice(db, {
    tenantId,
    userId: admin.id,
    kind: 'web',
    name: 'sequential-rewind',
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
    registerName: 'Rewind register',
    openingFloat: 0,
    denominations: [],
  });
  for (let index = 0; index < 3; index += 1) await sell();
}, 30_000);

afterAll(async () => {
  await server.close();
});

describe('sequential rewind guard', () => {
  it('derives the highest issued number from this tenant only', () => {
    const { prefix, currentValue } = saleSequential();
    const db = getDatabase();
    expect(getHighestIssuedSequentialValue(db, { tenantId, documentType: 'sale', prefix })).toBe(
      currentValue
    );
    expect(
      getHighestIssuedSequentialValue(db, {
        tenantId: 'foreign-tenant',
        documentType: 'sale',
        prefix,
      })
    ).toBe(0);
  });

  it('rejects a counter below an issued sale number and leaves it unchanged', async () => {
    const before = saleSequential();
    await expect(
      appRouter.createCaller(fresh()).sequentials.upsert({
        siteId,
        documentType: 'sale',
        prefix: before.prefix,
        currentValue: 1,
      })
    ).rejects.toMatchObject({
      code: 'BAD_REQUEST',
      cause: {
        errorCode: 'SEQUENTIAL_BELOW_ISSUED',
        details: { highestIssued: before.currentValue },
      },
    });
    expect(saleSequential().currentValue).toBe(before.currentValue);
  });

  it('allows a fresh prefix to restart and audits the adjustment', async () => {
    const before = saleSequential();
    const updated = await appRouter.createCaller(fresh()).sequentials.upsert({
      siteId,
      documentType: 'sale',
      prefix: 'NEW-',
      currentValue: 0,
    });
    expect(updated.currentValue).toBe(0);

    const audit = getDatabase()
      .select()
      .from(auditLogs)
      .where(and(eq(auditLogs.tenantId, tenantId), eq(auditLogs.action, 'sequential.adjust')))
      .orderBy(desc(auditLogs.createdAt))
      .get();
    expect(audit).toMatchObject({
      resourceType: 'sequential',
      resourceId: before.id,
      before: { prefix: before.prefix, currentValue: before.currentValue },
      after: { prefix: 'NEW-', currentValue: 0 },
    });

    await appRouter.createCaller(fresh()).sequentials.upsert({
      siteId,
      documentType: 'sale',
      prefix: before.prefix,
      currentValue: before.currentValue,
    });
  });

  it('maps a reissued sale number to SALE_NUMBER_COLLISION', async () => {
    const db = getDatabase();
    const { id } = saleSequential();
    // A rewind that bypassed the guard, such as a synced counter from another register.
    db.update(sequentials).set({ currentValue: 0 }).where(eq(sequentials.id, id)).run();

    await expect(sell()).rejects.toMatchObject({
      code: 'CONFLICT',
      cause: { errorCode: 'SALE_NUMBER_COLLISION' },
    });
  });
});
