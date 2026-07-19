/**
 * ENG-204 — cashier pace metrics (`cashSessions.pace`).
 *
 * Exercises the endpoint through REAL session and sale lifecycles (open →
 * sell → close via the routers/use-cases) so the metrics reflect exactly
 * what production rows produce:
 *   - null without an active session (the HUD hides);
 *   - live counts in base units with refunds excluded;
 *   - the personal best derives from the caller's own CLOSED sessions and
 *     requires the minimum sale count before a record can be set or beaten.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { createServer, type PuntovivoServer } from '../index.js';
import { getDatabase } from '../db/index.js';
import { inventoryBalances, products, sites, unitXProduct, units, users } from '../db/schema.js';
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
let productId: string;
let fresh: ReturnType<typeof makeFreshContextFactory>;

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

async function sell(quantity: number): Promise<string> {
  const result = await completeSale(buildSaleContext(), {
    mode: 'fresh',
    customerId: null,
    items: [{ productId, unitId: baseUnitId, quantity, unitPrice: 100, discount: 0 }],
    paymentMethod: 'cash',
    paymentStatus: 'paid',
    status: 'completed',
    amountReceived: quantity * 100,
    discountAmount: 0,
  });
  return (result.sale as { id: string }).id;
}

async function openSession(registerName: string) {
  return appRouter.createCaller(fresh()).cashSessions.open({
    registerName,
    openingFloat: 0,
    denominations: [],
  });
}

async function closeSession() {
  // Close balanced: the fixtures only move multiples of $100, so the
  // expected balance always decomposes into $100 bills. Over/short does not
  // gate the pace metrics — the balanced close just keeps the flow clean.
  const active = await appRouter.createCaller(fresh()).cashSessions.getActive();
  const expected = active?.expectedBalance ?? 0;
  return appRouter.createCaller(fresh()).cashSessions.close({
    actualCount: expected,
    denominations: expected > 0 ? [{ value: 100, count: Math.round(expected / 100) }] : [],
  });
}

describe('cashier pace (ENG-204)', () => {
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

    const reg = await registerDeviceService(db, {
      tenantId,
      userId,
      kind: 'web',
      name: 'cashier-pace.test',
    });
    fresh = makeFreshContextFactory({
      db,
      serverApp: server.app,
      tenantId,
      userId,
      email: 'admin@localhost',
      siteId,
      deviceId: reg.deviceId,
      defaultRole: 'admin',
    });

    // One product with plenty of stock for every scenario.
    const now = new Date().toISOString();
    productId = nanoid();
    await db.insert(products).values({
      id: productId,
      tenantId,
      name: 'Pace Product',
      sku: 'PACE-1',
      price: 100,
      cost: 40,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(unitXProduct).values({
      id: nanoid(),
      productId,
      unitId: baseUnitId,
      equivalence: 1,
      price: 100,
      isBase: true,
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(inventoryBalances).values({
      id: nanoid(),
      tenantId,
      siteId,
      productId,
      onHand: 1000,
      reserved: 0,
      createdAt: now,
      updatedAt: now,
    });
  });

  afterAll(async () => {
    await server.close();
  });

  it('returns null without an active session', async () => {
    const pace = await appRouter.createCaller(fresh()).cashSessions.pace();
    expect(pace).toBeNull();
  });

  it('builds the personal best from a closed session, then tracks the live one', async () => {
    // Session 1: 3 sales / 6 base units, then closed — the history record.
    await openSession('pace register 1');
    await sell(1);
    await sell(2);
    await sell(3);
    await closeSession();

    // Session 2 (live): 1 sale / 2 units so far.
    await openSession('pace register 2');
    await sell(2);
    const refundedId = await sell(5);
    await returnSale(buildSaleContext(), { id: refundedId, reason: 'pace exclusion' });

    const pace = await appRouter.createCaller(fresh()).cashSessions.pace();
    expect(pace).not.toBeNull();
    // The refunded sale contributes nothing.
    expect(pace?.salesCount).toBe(1);
    expect(pace?.itemsQty).toBeCloseTo(2, 6);
    expect(pace?.sessionMinutes).toBeGreaterThanOrEqual(1);
    // In-memory runs finish in seconds → minutes clamps to 1, so the rate
    // equals itemsQty; the closed session sets the 6.0 record the same way.
    expect(pace?.itemsPerMinute).toBeCloseTo(2, 1);
    expect(pace?.personalBestItemsPerMinute).toBeCloseTo(6, 1);
    // Below the minimum sale count AND below the record → not a best.
    expect(pace?.isPersonalBest).toBe(false);
    expect(pace?.avgSecondsBetweenSales).toBeNull();
  });

  it('flags a personal best once the live session meets count and rate', async () => {
    // Same live session: push past the 6.0 record with 3+ sales.
    await sell(3);
    await sell(4);

    const pace = await appRouter.createCaller(fresh()).cashSessions.pace();
    expect(pace?.salesCount).toBe(3);
    expect(pace?.itemsQty).toBeCloseTo(9, 6);
    expect(pace?.itemsPerMinute).toBeGreaterThanOrEqual(9);
    expect(pace?.personalBestItemsPerMinute).toBeCloseTo(6, 1);
    expect(pace?.isPersonalBest).toBe(true);
    expect(pace?.avgSecondsBetweenSales).not.toBeNull();
  });
});
