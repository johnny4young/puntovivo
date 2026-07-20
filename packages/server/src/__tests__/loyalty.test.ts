/**
 * minimum viable loyalty ().
 *
 * Pins the contracts that make points trustworthy:
 * - the ledger is the truth and the balance is its rollup — parity
 * `points ≡ Σ(movements.points)` holds through earn / revert / adjust;
 * - accrual rides the REAL sale transaction (floor rule, snapshot rate),
 * is idempotent per sale, and is silent when the program is off, the
 * sale has no customer, or the total earns nothing;
 * - a reversed sale takes its points back by APPENDING a negative row,
 * never by erasing history, and never twice;
 * - manual adjustments are gated (admin), audited by their note, and can
 * never leave a negative balance;
 * - multi-tenant isolation on every read/write.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type Database from 'better-sqlite3';
import { and, eq, sql } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { createServer, type PuntovivoServer } from '../index.js';
import { getDatabase } from '../db/index.js';
import {
  customers,
  inventoryBalances,
  loyaltyAccounts,
  loyaltyMovements,
  products,
  sites,
  unitXProduct,
  units,
  users,
} from '../db/schema.js';
import { completeSale } from '../application/sales/completeSale.js';
import { returnSale } from '../application/sales/returnSale.js';
import type { CompleteSaleContext } from '../application/sales/types.js';
import { pointsForTotal, writeLoyaltySettings } from '../services/loyalty.js';
import { registerDevice as registerDeviceService } from '../services/devices/devicesService.js';
import { makeFreshContextFactory } from './utils/criticalCommandFixture.js';
import { appRouter } from '../trpc/router.js';

let server: PuntovivoServer;
let tenantId: string;
let userId: string;
let siteId: string;
let baseUnitId: string;
let productId: string;
let customerId: string;
let fresh: ReturnType<typeof makeFreshContextFactory>;

interface LiveDatabase {
  $client: Database.Database;
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

async function sell(args: { quantity: number; unitPrice: number; withCustomer?: boolean }) {
  return completeSale(buildSaleContext(), {
    mode: 'fresh',
    customerId: args.withCustomer === false ? null : customerId,
    items: [
      {
        productId,
        unitId: baseUnitId,
        quantity: args.quantity,
        unitPrice: args.unitPrice,
        discount: 0,
      },
    ],
    paymentMethod: 'cash',
    paymentStatus: 'paid',
    status: 'completed',
    amountReceived: args.quantity * args.unitPrice,
    discountAmount: 0,
  });
}

/** The invariant: the materialized balance always equals its ledger. */
async function expectParity(customer = customerId) {
  const db = getDatabase();
  const account = await db
    .select({ id: loyaltyAccounts.id, points: loyaltyAccounts.points })
    .from(loyaltyAccounts)
    .where(and(eq(loyaltyAccounts.tenantId, tenantId), eq(loyaltyAccounts.customerId, customer)))
    .get();
  if (!account) return;
  const ledger = await db
    .select({ total: sql<number>`coalesce(sum(${loyaltyMovements.points}), 0)` })
    .from(loyaltyMovements)
    .where(eq(loyaltyMovements.accountId, account.id))
    .get();
  expect(account.points).toBe(ledger?.total ?? 0);
}

describe('loyalty', () => {
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
      name: 'loyalty.test',
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

    const now = new Date().toISOString();
    productId = nanoid();
    await db.insert(products).values({
      id: productId,
      tenantId,
      name: 'Loyalty Product',
      sku: 'LOY-1',
      price: 10000,
      cost: 4000,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(unitXProduct).values({
      id: nanoid(),
      productId,
      unitId: baseUnitId,
      equivalence: 1,
      price: 10000,
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
    customerId = nanoid();
    await db.insert(customers).values({
      id: customerId,
      tenantId,
      name: 'Doña Rosa',
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });

    // The register needs an open session for completeSale.
    await appRouter.createCaller(fresh()).cashSessions.open({
      registerName: 'loyalty register',
      openingFloat: 0,
      denominations: [],
    });
  });

  afterAll(async () => {
    await server.close();
  });

  beforeEach(async () => {
    // Each test states its own program config; default is OFF.
    await writeLoyaltySettings(getDatabase(), tenantId, { enabled: false, pointsPerUnit: 0.001 });
  });

  describe('pointsForTotal', () => {
    it('floors to whole points and never earns on a non-positive total', () => {
      // 0.001 points per unit → $25.000 earns 25.
      expect(pointsForTotal(25000, 0.001)).toBe(25);
      // Floors the remainder (25.9 → 25).
      expect(pointsForTotal(25900, 0.001)).toBe(25);
      // Under one point earns nothing.
      expect(pointsForTotal(500, 0.001)).toBe(0);
      expect(pointsForTotal(0, 0.001)).toBe(0);
      expect(pointsForTotal(-5000, 0.001)).toBe(0);
    });
  });

  it('stores balances and ledger deltas with INTEGER affinity', () => {
    const sqlite = (getDatabase() as unknown as LiveDatabase).$client;
    const columnType = (table: string) => {
      const columns = sqlite.prepare(`PRAGMA table_info(${table})`).all() as Array<{
        name: string;
        type: string;
      }>;
      return columns.find(column => column.name === 'points')?.type.toUpperCase();
    };

    expect(columnType('loyalty_accounts')).toBe('INTEGER');
    expect(columnType('loyalty_movements')).toBe('INTEGER');
  });

  it('re-selects the canonical account when first-account creation loses a race', async () => {
    const db = getDatabase();
    const sqlite = (db as unknown as LiveDatabase).$client;
    const racedCustomerId = nanoid();
    const now = new Date().toISOString();
    await db.insert(customers).values({
      id: racedCustomerId,
      tenantId,
      name: 'Concurrent Loyalty Customer',
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });

    // Deterministically model another connection winning between
    // ensureAccount's first SELECT and INSERT. The BEFORE trigger creates the
    // canonical row; ON CONFLICT must absorb the losing INSERT and the service
    // must re-select this id before appending the movement.
    sqlite.exec(`
      CREATE TEMP TRIGGER loyalty_account_race
      BEFORE INSERT ON loyalty_accounts
      WHEN NEW.customer_id = '${racedCustomerId}' AND NEW.id <> 'race-winner'
      BEGIN
        INSERT INTO loyalty_accounts (
          id, tenant_id, customer_id, points, created_at, updated_at
        ) VALUES (
          'race-winner', NEW.tenant_id, NEW.customer_id, 0, NEW.created_at, NEW.updated_at
        );
      END;
    `);

    try {
      const result = await appRouter.createCaller(fresh()).loyalty.adjust({
        customerId: racedCustomerId,
        points: 5,
        note: 'Concurrent account creation',
      });
      expect(result.points).toBe(5);

      const account = await db
        .select({ id: loyaltyAccounts.id, points: loyaltyAccounts.points })
        .from(loyaltyAccounts)
        .where(
          and(
            eq(loyaltyAccounts.tenantId, tenantId),
            eq(loyaltyAccounts.customerId, racedCustomerId)
          )
        )
        .get();
      expect(account).toEqual({ id: 'race-winner', points: 5 });
    } finally {
      sqlite.exec('DROP TRIGGER IF EXISTS loyalty_account_race');
    }
  });

  it('earns nothing while the program is off', async () => {
    await sell({ quantity: 3, unitPrice: 10000 });

    const caller = appRouter.createCaller(fresh());
    const loyalty = await caller.loyalty.forCustomer({ customerId });
    expect(loyalty.points).toBe(0);
    expect(loyalty.movements).toEqual([]);
  });

  it('accrues on a completed sale once enabled, snapshotting the rate', async () => {
    await writeLoyaltySettings(getDatabase(), tenantId, { enabled: true, pointsPerUnit: 0.001 });
    const result = await sell({ quantity: 3, unitPrice: 10000 }); // $30.000 → 30 pts

    expect(result.loyaltyPointsEarned).toBe(30);
    const caller = appRouter.createCaller(fresh());
    const loyalty = await caller.loyalty.forCustomer({ customerId });
    expect(loyalty.points).toBe(30);
    expect(loyalty.movements[0]).toMatchObject({ kind: 'earn', points: 30 });
    await expectParity();

    // The rate is snapshot on the row, so a later change never rewrites it.
    const row = await getDatabase()
      .select({ rateAtEarn: loyaltyMovements.rateAtEarn })
      .from(loyaltyMovements)
      .where(eq(loyaltyMovements.saleId, (result.sale as { id: string }).id))
      .get();
    expect(row?.rateAtEarn).toBeCloseTo(0.001, 9);

    await writeLoyaltySettings(getDatabase(), tenantId, { pointsPerUnit: 0.01 });
    const after = await getDatabase()
      .select({ rateAtEarn: loyaltyMovements.rateAtEarn })
      .from(loyaltyMovements)
      .where(eq(loyaltyMovements.saleId, (result.sale as { id: string }).id))
      .get();
    expect(after?.rateAtEarn).toBeCloseTo(0.001, 9);
  });

  it('hands the accrued points back through the sales.create response', async () => {
    // Regression: the use-case returned the points but the router returned
    // only `result.sale`, so the cashier's toast never learned about them.
    // The live smoke caught what a use-case-level assertion could not —
    // assert on the ROUTER response, the shape the renderer actually reads.
    await writeLoyaltySettings(getDatabase(), tenantId, { enabled: true, pointsPerUnit: 0.01 });
    const before = (await appRouter.createCaller(fresh()).loyalty.forCustomer({ customerId }))
      .points;

    const sale = await appRouter.createCaller(fresh()).sales.create({
      customerId,
      items: [{ productId, unitId: baseUnitId, quantity: 2, unitPrice: 10000, discount: 0 }],
      paymentMethod: 'cash',
      paymentStatus: 'paid',
      status: 'completed',
      amountReceived: 20000,
      discountAmount: 0,
    });

    // $20.000 * 0.01 → 200 pts, and the balance moves by exactly what the
    // payload claims (the ledger is shared across cases in this file).
    expect(sale).toMatchObject({ loyaltyPointsEarned: 200 });
    const loyalty = await appRouter.createCaller(fresh()).loyalty.forCustomer({ customerId });
    expect(loyalty.points).toBe(before + 200);
    await expectParity();
  });

  it('earns the same points when the sale is completed from a suspended draft', async () => {
    // A cashier suspending a change is a workflow detail; the customer paid
    // the same money for the same goods and must earn the same points.
    await writeLoyaltySettings(getDatabase(), tenantId, { enabled: true, pointsPerUnit: 0.01 });
    const caller = appRouter.createCaller(fresh());
    const before = (await caller.loyalty.forCustomer({ customerId })).points;

    const draft = await caller.sales.create({
      customerId,
      items: [{ productId, unitId: baseUnitId, quantity: 1, unitPrice: 10000, discount: 0 }],
      paymentMethod: 'cash',
      paymentStatus: 'pending',
      status: 'draft',
      amountReceived: 0,
      discountAmount: 0,
    });

    // The draft itself earns nothing — no money has changed hands yet.
    expect((await caller.loyalty.forCustomer({ customerId })).points).toBe(before);

    const completed = await appRouter.createCaller(fresh()).sales.completeDraft({
      saleId: draft.id,
      paymentMethod: 'cash',
      paymentStatus: 'paid',
      amountReceived: 10000,
    });

    expect(completed).toMatchObject({ loyaltyPointsEarned: 100 });
    expect((await appRouter.createCaller(fresh()).loyalty.forCustomer({ customerId })).points).toBe(
      before + 100
    );
    await expectParity();
  });

  it('earns points for the customer attached while completing a walk-in draft', async () => {
    // regression: the web only picks a customer in the payment
    // drawer, after the ticket has already been suspended without one. The
    // resolved customer must drive both the completed sale and accrual.
    await writeLoyaltySettings(getDatabase(), tenantId, { enabled: true, pointsPerUnit: 0.01 });
    const caller = appRouter.createCaller(fresh());
    const before = (await caller.loyalty.forCustomer({ customerId })).points;

    const draft = await caller.sales.create({
      items: [{ productId, unitId: baseUnitId, quantity: 1, unitPrice: 10000, discount: 0 }],
      paymentMethod: 'cash',
      paymentStatus: 'pending',
      status: 'draft',
      amountReceived: 0,
      discountAmount: 0,
    });
    expect(draft.customerId ?? null).toBeNull();

    const completed = await appRouter.createCaller(fresh()).sales.completeDraft({
      saleId: draft.id,
      customerId,
      paymentMethod: 'cash',
      paymentStatus: 'paid',
      amountReceived: 10000,
    });

    expect(completed).toMatchObject({ customerId, loyaltyPointsEarned: 100 });
    expect((await caller.loyalty.forCustomer({ customerId })).points).toBe(before + 100);
    await expectParity();
  });

  it('reports zero points through the router while the program is off', async () => {
    const sale = await appRouter.createCaller(fresh()).sales.create({
      customerId,
      items: [{ productId, unitId: baseUnitId, quantity: 1, unitPrice: 10000, discount: 0 }],
      paymentMethod: 'cash',
      paymentStatus: 'paid',
      status: 'completed',
      amountReceived: 10000,
      discountAmount: 0,
    });

    // The field is always present so the renderer never branches on undefined.
    expect(sale).toMatchObject({ loyaltyPointsEarned: 0 });
  });

  it('never accrues for a walk-in sale (no customer)', async () => {
    await writeLoyaltySettings(getDatabase(), tenantId, { enabled: true, pointsPerUnit: 0.001 });
    const before = (await appRouter.createCaller(fresh()).loyalty.forCustomer({ customerId }))
      .points;

    const result = await sell({ quantity: 5, unitPrice: 10000, withCustomer: false });
    expect(result.loyaltyPointsEarned).toBe(0);

    const after = (await appRouter.createCaller(fresh()).loyalty.forCustomer({ customerId }))
      .points;
    expect(after).toBe(before);
  });

  it('takes the points back on a reversal by appending, never erasing', async () => {
    await writeLoyaltySettings(getDatabase(), tenantId, { enabled: true, pointsPerUnit: 0.001 });
    const caller = appRouter.createCaller(fresh());
    const before = (await caller.loyalty.forCustomer({ customerId })).points;

    const result = await sell({ quantity: 4, unitPrice: 10000 }); // +40
    expect(result.loyaltyPointsEarned).toBe(40);
    const saleId = (result.sale as { id: string }).id;
    expect((await caller.loyalty.forCustomer({ customerId })).points).toBe(before + 40);

    await returnSale(buildSaleContext(), { id: saleId, reason: 'loyalty revert test' });

    const after = await caller.loyalty.forCustomer({ customerId });
    expect(after.points).toBe(before);
    // The earn row survives; a negative revert row sits next to it.
    const rows = await getDatabase()
      .select({ kind: loyaltyMovements.kind, points: loyaltyMovements.points })
      .from(loyaltyMovements)
      .where(eq(loyaltyMovements.saleId, saleId))
      .all();
    expect(rows).toEqual(
      expect.arrayContaining([
        { kind: 'earn', points: 40 },
        { kind: 'revert', points: -40 },
      ])
    );
    await expectParity();
  });

  it('adjusts manually with an audited note and refuses to go negative', async () => {
    const caller = appRouter.createCaller(fresh());
    const before = (await caller.loyalty.forCustomer({ customerId })).points;

    const granted = await caller.loyalty.adjust({
      customerId,
      points: 15,
      note: 'Compensación por demora',
    });
    expect(granted.points).toBe(before + 15);
    const loyalty = await caller.loyalty.forCustomer({ customerId });
    expect(loyalty.movements[0]).toMatchObject({
      kind: 'adjust',
      points: 15,
      note: 'Compensación por demora',
    });
    await expectParity();

    // A claw-back beyond the balance is refused, not clamped.
    await expect(
      caller.loyalty.adjust({
        customerId,
        points: -(before + 15 + 1),
        note: 'Ajuste imposible',
      })
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    expect((await caller.loyalty.forCustomer({ customerId })).points).toBe(before + 15);
  });

  it('gates settings and adjustments by role', async () => {
    const cashier = appRouter.createCaller(fresh({ role: 'cashier' }));
    // The cashier tells the customer their balance — that read stays open.
    await expect(cashier.loyalty.forCustomer({ customerId })).resolves.toMatchObject({
      points: expect.any(Number),
    });
    await expect(cashier.loyalty.settings()).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(
      cashier.loyalty.adjust({ customerId, points: 5, note: 'nope' })
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });

    const manager = appRouter.createCaller(fresh({ role: 'manager' }));
    await expect(manager.loyalty.settings()).resolves.toMatchObject({
      enabled: expect.any(Boolean),
    });
    await expect(manager.loyalty.updateSettings({ enabled: true })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
  });

  it('isolates tenants and rejects a foreign customer', async () => {
    const foreignCustomerId = nanoid();
    await expect(
      appRouter.createCaller(fresh()).loyalty.adjust({
        customerId: foreignCustomerId,
        points: 10,
        note: 'Cliente de otro tenant',
      })
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });

    // A read for an unknown customer is an empty balance, not a leak.
    const loyalty = await appRouter
      .createCaller(fresh())
      .loyalty.forCustomer({ customerId: foreignCustomerId });
    expect(loyalty).toEqual({ points: 0, movements: [] });
  });
});
