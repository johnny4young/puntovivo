/**
 * ENG-198 — day-close ritual summary (`cashSessions.dayCloseSummary`).
 *
 * Pins the two contracts the ritual depends on:
 *   - role gating happens SERVER-SIDE: cashiers get `margin: null` and
 *     revenue-ordered top products with profit fields nulled; manager/admin
 *     get the full owner view (profit-ordered, real margin);
 *   - the balanced-close streak walks calendar days backwards from the
 *     session's close day — days without closed sessions are transparent,
 *     any unbalanced close breaks the day, and the scan is tenant-wide.
 *
 * Day stats reuse the realized-revenue filter (completed AND not refunded,
 * same UTC day as `closed_at`), asserted here through real completeSale /
 * returnSale round-trips rather than synthetic rows.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { createServer, type PuntovivoServer } from '../index.js';
import { getDatabase } from '../db/index.js';
import {
  cashSessions,
  companies,
  inventoryBalances,
  products,
  sales,
  sites,
  tenants,
  unitXProduct,
  units,
  users,
} from '../db/schema.js';
import { completeSale } from '../application/sales/completeSale.js';
import { returnSale } from '../application/sales/returnSale.js';
import type { CompleteSaleContext } from '../application/sales/types.js';
import { computeDayCloseSummary } from '../services/reports/day-close.js';
import { registerDevice as registerDeviceService } from '../services/devices/devicesService.js';
import { makeFreshContextFactory } from './utils/criticalCommandFixture.js';
import { appRouter } from '../trpc/router.js';

let server: PuntovivoServer;
let tenantId: string;
let userId: string;
let siteId: string;
let baseUnitId: string;
let fresh: ReturnType<typeof makeFreshContextFactory>;
/** The synthetic closed session the seeded-tenant tests summarize. */
let closedSessionId: string;
/** The REAL open session from beforeAll (completeSale needs it active). */
let openSessionId: string;

/** ISO timestamp `days` UTC days before now, at a fixed intra-day time. */
function isoDaysAgo(days: number, time = 'T12:00:00.000Z'): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10) + time;
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

async function seedProduct(name: string, sku: string, price: number, cost: number) {
  const db = getDatabase();
  const id = nanoid();
  const now = new Date().toISOString();
  await db.insert(products).values({
    id,
    tenantId,
    name,
    sku,
    price,
    price2: price,
    price3: price,
    cost,
    marginPercent1: 0,
    marginPercent2: 0,
    marginPercent3: 0,
    marginAmount1: 0,
    marginAmount2: 0,
    marginAmount3: 0,
    taxRate: 0,
    initialCost: cost,
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

async function sellProduct(productId: string, quantity: number, unitPrice: number) {
  const result = await completeSale(buildSaleContext(), {
    mode: 'fresh',
    customerId: null,
    items: [{ productId, unitId: baseUnitId, quantity, unitPrice, discount: 0 }],
    paymentMethod: 'cash',
    paymentStatus: 'paid',
    status: 'completed',
    amountReceived: quantity * unitPrice,
    discountAmount: 0,
  });
  return (result.sale as { id: string }).id;
}

/** Bare tenant (tenant + company + site + user) for isolated streak scans. */
async function seedBareTenant(label: string) {
  const db = getDatabase();
  const now = new Date().toISOString();
  const tid = nanoid();
  const uid = nanoid();
  const cid = nanoid();
  const sid = nanoid();
  await db.insert(tenants).values({
    id: tid,
    name: `Streak ${label}`,
    slug: `streak-${label}-${nanoid(6)}`.toLowerCase(),
    settings: {},
    isActive: true,
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(users).values({
    id: uid,
    tenantId: tid,
    email: `streak-${label}-${nanoid(6)}@example.com`.toLowerCase(),
    passwordHash: 'x',
    name: label,
    role: 'admin',
    isActive: true,
    createdAt: now,
    updatedAt: now,
  });
  await db
    .insert(companies)
    .values({ id: cid, tenantId: tid, name: `${label} co`, createdAt: now, updatedAt: now });
  await db.insert(sites).values({
    id: sid,
    tenantId: tid,
    companyId: cid,
    name: `${label} site`,
    isActive: true,
    createdAt: now,
    updatedAt: now,
  });
  return { tenantId: tid, siteId: sid, userId: uid };
}

/** Insert a closed session `daysAgo` with a controlled over/short. */
async function insertClosedSession(
  owner: { tenantId: string; siteId: string; userId: string },
  daysAgo: number,
  overShort: number,
  registerName = 'ritual register'
): Promise<string> {
  const db = getDatabase();
  const id = nanoid();
  const closedAt = isoDaysAgo(daysAgo);
  const openedAt = isoDaysAgo(daysAgo, 'T08:00:00.000Z');
  await db.insert(cashSessions).values({
    id,
    tenantId: owner.tenantId,
    siteId: owner.siteId,
    cashierId: owner.userId,
    registerName,
    openingFloat: 100,
    openingCountDenominations: [],
    expectedBalance: 100,
    actualCount: 100 + overShort,
    overShort,
    status: 'closed',
    openedAt,
    closedAt,
    createdAt: openedAt,
    updatedAt: closedAt,
  });
  return id;
}

describe('day-close summary (ENG-198)', () => {
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
      name: 'day-close-summary.test',
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
    const opened = await appRouter.createCaller(fresh()).cashSessions.open({
      registerName: 'live register',
      openingFloat: 500,
      denominations: [{ value: 100, count: 5 }],
    });
    openSessionId = opened.id;

    const productId = await seedProduct('Ritual Star', 'DC-STAR', 100, 40);
    await sellProduct(productId, 2, 100);
    closedSessionId = await insertClosedSession({ tenantId, siteId, userId }, 0, 0);
  });

  afterAll(async () => {
    await server.close();
  });

  it('returns the full owner view for an admin (day stats, margin, top products, streak)', async () => {
    const summary = await appRouter
      .createCaller(fresh())
      .cashSessions.dayCloseSummary({ sessionId: closedSessionId });

    expect(summary.session.registerName).toBe('ritual register');
    expect(summary.session.overShort).toBe(0);
    expect(summary.session.balanced).toBe(true);
    expect(summary.day.date).toBe(new Date().toISOString().slice(0, 10));
    expect(summary.day.salesCount).toBe(1);
    expect(summary.day.revenue).toBeCloseTo(200, 2);
    expect(summary.pulse).toEqual({
      averageTicket: 200,
      previousWeekRevenue: 0,
      revenueChangePct: null,
    });
    expect(summary.margin).not.toBeNull();
    expect(summary.margin?.grossProfit).toBeCloseTo(120, 2);
    expect(summary.margin?.grossMarginPct).toBeCloseTo(60, 2);
    expect(summary.topProducts).toHaveLength(1);
    expect(summary.topProducts[0]).toMatchObject({
      revenue: 200,
      grossProfit: 120,
      grossMarginPct: 60,
    });
    // Only closed session of the tenant; the live open one is transparent.
    expect(summary.streakDays).toBe(1);
  });

  it('strips owner data for a cashier and re-ranks top products by revenue', async () => {
    // High revenue, thin profit — omitted from the profit-ranked top 3, but
    // it must lead the cashier's independently selected revenue top 3.
    const thinId = await seedProduct('Ritual Thin', 'DC-THIN', 150, 145);
    await sellProduct(thinId, 2, 150);
    const profitLeaderId = await seedProduct('Ritual Profit A', 'DC-PROFIT-A', 180, 10);
    await sellProduct(profitLeaderId, 1, 180);
    const secondProfitId = await seedProduct('Ritual Profit B', 'DC-PROFIT-B', 170, 10);
    await sellProduct(secondProfitId, 1, 170);

    const admin = await appRouter
      .createCaller(fresh())
      .cashSessions.dayCloseSummary({ sessionId: closedSessionId });
    const cashier = await appRouter
      .createCaller(fresh({ role: 'cashier' }))
      .cashSessions.dayCloseSummary({ sessionId: closedSessionId });

    // Admin: top 3 ordered by gross profit; the thin product is fourth and
    // therefore absent from the owner list.
    expect(admin.topProducts).toHaveLength(3);
    expect(admin.topProducts.map(product => product.productId)).toEqual([
      profitLeaderId,
      secondProfitId,
      expect.any(String),
    ]);
    expect(admin.topProducts.map(product => product.productId)).not.toContain(thinId);

    // Cashier: margin hidden, profit fields nulled, ordered by revenue
    // (thin 300 > star 200 > profit leader 180).
    expect(cashier.margin).toBeNull();
    expect(cashier.topProducts).toHaveLength(3);
    expect(cashier.topProducts[0]?.productId).toBe(thinId);
    expect(cashier.topProducts[0]?.revenue).toBeCloseTo(300, 2);
    expect(cashier.topProducts[1]?.revenue).toBeCloseTo(200, 2);
    expect(cashier.topProducts[2]?.productId).toBe(profitLeaderId);
    for (const product of cashier.topProducts) {
      expect(product.grossProfit).toBeNull();
      expect(product.grossMarginPct).toBeNull();
    }
    // The shared fields agree between the two views.
    expect(cashier.day).toEqual(admin.day);
    expect(cashier.pulse).toBeNull();
    expect(cashier.streakDays).toBe(admin.streakDays);
    expect(cashier.session).toEqual(admin.session);
  });

  it('excludes refunded sales from the day stats', async () => {
    const caller = appRouter.createCaller(fresh());
    const before = await caller.cashSessions.dayCloseSummary({ sessionId: closedSessionId });

    const productId = await seedProduct('Ritual Refund', 'DC-REF', 80, 30);
    const saleId = await sellProduct(productId, 1, 80);
    await returnSale(buildSaleContext(), { id: saleId, reason: 'day-close exclusion test' });

    const after = await caller.cashSessions.dayCloseSummary({ sessionId: closedSessionId });
    expect(after.day).toEqual(before.day);
    expect(after.margin).toEqual(before.margin);
  });

  it('excludes sales from other days', async () => {
    const db = getDatabase();
    const caller = appRouter.createCaller(fresh());
    const before = await caller.cashSessions.dayCloseSummary({ sessionId: closedSessionId });

    const productId = await seedProduct('Ritual Yesterday', 'DC-YDAY', 60, 20);
    const saleId = await sellProduct(productId, 1, 60);
    await db
      .update(sales)
      .set({ createdAt: isoDaysAgo(1) })
      .where(eq(sales.id, saleId));

    const after = await caller.cashSessions.dayCloseSummary({ sessionId: closedSessionId });
    expect(after.day).toEqual(before.day);
  });

  it('builds the tenant-scoped pulse against the same weekday one week earlier', async () => {
    const db = getDatabase();
    const caller = appRouter.createCaller(fresh());
    const current = await caller.cashSessions.dayCloseSummary({ sessionId: closedSessionId });

    const previousProductId = await seedProduct('Ritual Previous Week', 'DC-PREV', 100, 50);
    const previousSaleId = await sellProduct(previousProductId, 1, 100);
    await db
      .update(sales)
      .set({ createdAt: isoDaysAgo(7), updatedAt: isoDaysAgo(7) })
      .where(eq(sales.id, previousSaleId));

    // A large foreign-tenant sale in the same comparison window must not
    // influence either the baseline or percentage delta.
    const foreign = await seedBareTenant('pulse-scope');
    const foreignSessionId = await insertClosedSession(foreign, 7, 0);
    await db.insert(sales).values({
      id: nanoid(),
      tenantId: foreign.tenantId,
      saleNumber: 'PULSE-FOREIGN-1',
      subtotal: 9_999,
      taxAmount: 0,
      discountAmount: 0,
      total: 9_999,
      paymentMethod: 'cash',
      paymentStatus: 'paid',
      status: 'completed',
      cashSessionId: foreignSessionId,
      createdBy: foreign.userId,
      createdAt: isoDaysAgo(7),
      updatedAt: isoDaysAgo(7),
    });

    const summary = await caller.cashSessions.dayCloseSummary({ sessionId: closedSessionId });
    expect(summary.day).toEqual(current.day);
    expect(summary.pulse).not.toBeNull();
    expect(summary.pulse?.averageTicket).toBeCloseTo(
      current.day.revenue / current.day.salesCount,
      2
    );
    expect(summary.pulse?.previousWeekRevenue).toBe(100);
    expect(summary.pulse?.revenueChangePct).toBeCloseTo(
      ((current.day.revenue - 100) / 100) * 100,
      1
    );
  });

  it('counts consecutive balanced days into the streak', async () => {
    const owner = await seedBareTenant('consec');
    await insertClosedSession(owner, 2, 0);
    await insertClosedSession(owner, 1, 0);
    const sessionId = await insertClosedSession(owner, 0, 0);

    const summary = computeDayCloseSummary(getDatabase(), {
      tenantId: owner.tenantId,
      sessionId,
      viewerUserId: owner.userId,
      includeProfit: true,
      canViewAnyCashierSession: true,
    });
    expect(summary.streakDays).toBe(3);
    // Bare tenant has no sales; the owner view still shapes correctly.
    expect(summary.day.salesCount).toBe(0);
    expect(summary.pulse).toEqual({
      averageTicket: 0,
      previousWeekRevenue: 0,
      revenueChangePct: null,
    });
    expect(summary.topProducts).toEqual([]);
    expect(summary.margin).toEqual({ grossProfit: 0, grossMarginPct: 0 });
  });

  it('treats days without closed sessions as transparent', async () => {
    const owner = await seedBareTenant('gap');
    await insertClosedSession(owner, 3, 0);
    await insertClosedSession(owner, 2, 0);
    // Day 1 has no sessions at all.
    const sessionId = await insertClosedSession(owner, 0, 0);

    const summary = computeDayCloseSummary(getDatabase(), {
      tenantId: owner.tenantId,
      sessionId,
      viewerUserId: owner.userId,
      includeProfit: false,
      canViewAnyCashierSession: false,
    });
    expect(summary.streakDays).toBe(3);
    expect(summary.margin).toBeNull();
  });

  it('breaks the streak on the first day with any unbalanced close', async () => {
    const owner = await seedBareTenant('brk');
    await insertClosedSession(owner, 2, 0);
    await insertClosedSession(owner, 1, 0.01); // smallest stored breaker
    const sessionId = await insertClosedSession(owner, 0, 0);

    const summary = computeDayCloseSummary(getDatabase(), {
      tenantId: owner.tenantId,
      sessionId,
      viewerUserId: owner.userId,
      includeProfit: true,
      canViewAnyCashierSession: true,
    });
    expect(summary.streakDays).toBe(1);
  });

  it('yields a zero streak when the close day itself is unbalanced', async () => {
    const owner = await seedBareTenant('today');
    await insertClosedSession(owner, 1, 0);
    // Two sessions today: the summarized one balances, a sibling does not —
    // the streak is a tenant-day metric, so the day still breaks.
    const sessionId = await insertClosedSession(owner, 0, 0);
    await insertClosedSession(owner, 0, -5.5, 'second register');

    const summary = computeDayCloseSummary(getDatabase(), {
      tenantId: owner.tenantId,
      sessionId,
      viewerUserId: owner.userId,
      includeProfit: true,
      canViewAnyCashierSession: true,
    });
    expect(summary.session.balanced).toBe(true);
    expect(summary.streakDays).toBe(0);
  });

  it('rejects sessions from another tenant with NOT_FOUND', async () => {
    const owner = await seedBareTenant('foreign');
    const foreignSessionId = await insertClosedSession(owner, 0, 0);

    const caller = appRouter.createCaller(fresh());
    await expect(
      caller.cashSessions.dayCloseSummary({ sessionId: foreignSessionId })
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(
      caller.cashSessions.dayCloseSummary({ sessionId: 'does-not-exist' })
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it("rejects another cashier's session with NOT_FOUND", async () => {
    const otherCashierId = nanoid();
    const now = new Date().toISOString();
    await getDatabase()
      .insert(users)
      .values({
        id: otherCashierId,
        tenantId,
        email: `day-close-other-${nanoid(6)}@example.com`,
        passwordHash: 'x',
        name: 'Other cashier',
        role: 'cashier',
        isActive: true,
        createdAt: now,
        updatedAt: now,
      });

    await expect(
      appRouter
        .createCaller(fresh({ userId: otherCashierId, role: 'cashier' }))
        .cashSessions.dayCloseSummary({ sessionId: closedSessionId })
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('grants cross-cashier access independently from profit visibility', async () => {
    // Pins the decoupling: a privileged revenue-only view (access yes,
    // profit no) must reach another cashier's session and get margin null.
    const owner = await seedBareTenant('decouple');
    const sessionId = await insertClosedSession(owner, 0, 0);

    const summary = computeDayCloseSummary(getDatabase(), {
      tenantId: owner.tenantId,
      sessionId,
      viewerUserId: 'someone-else-entirely',
      includeProfit: false,
      canViewAnyCashierSession: true,
    });
    expect(summary.session.balanced).toBe(true);
    expect(summary.margin).toBeNull();
    expect(summary.pulse).toBeNull();
  });

  it('caps the balanced streak at exactly 90 calendar days', async () => {
    const owner = await seedBareTenant('cap');
    let sessionId = '';
    for (let daysAgo = 90; daysAgo >= 0; daysAgo -= 1) {
      sessionId = await insertClosedSession(owner, daysAgo, 0);
    }

    const summary = computeDayCloseSummary(getDatabase(), {
      tenantId: owner.tenantId,
      sessionId,
      viewerUserId: owner.userId,
      includeProfit: true,
      canViewAnyCashierSession: true,
    });
    expect(summary.streakDays).toBe(90);
  });

  it('rejects a still-open session with BAD_REQUEST', async () => {
    await expect(
      appRouter.createCaller(fresh()).cashSessions.dayCloseSummary({ sessionId: openSessionId })
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });

  it('rejects viewers with FORBIDDEN', async () => {
    await expect(
      appRouter
        .createCaller(fresh({ role: 'viewer' }))
        .cashSessions.dayCloseSummary({ sessionId: closedSessionId })
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});
