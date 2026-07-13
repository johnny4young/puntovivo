/** ENG-209 — self-scoped, aggregate-only cashier pace metrics. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { createServer, type PuntovivoServer } from '../index.js';
import { getDatabase } from '../db/index.js';
import { cashSessions, products, saleItems, sales, sites, users } from '../db/schema.js';
import { computeCashierPace } from '../services/reports/cashier-pace.js';
import {
  resolveCheckoutTiming,
  resolveFreshCheckoutTiming,
} from '../application/sales/checkout-timing.js';
import { appRouter } from '../trpc/router.js';
import type { Context } from '../trpc/context.js';

let server: PuntovivoServer;
let tenantId: string;
let siteId: string;
let otherSiteId: string;
let productId: string;
let cashierId: string;
let otherCashierId: string;
let activeSessionId: string;
let fixedNow: Date;

function isoBefore(minutes: number): string {
  return new Date(fixedNow.getTime() - minutes * 60_000).toISOString();
}

async function insertSession(args: {
  cashierId: string;
  status: 'open' | 'closed';
  openedMinutesAgo: number;
  closedMinutesAgo?: number;
  siteId?: string;
  paceItemsPerMinute?: number;
}) {
  const id = nanoid();
  const openedAt = isoBefore(args.openedMinutesAgo);
  const closedAt = args.status === 'closed' ? isoBefore(args.closedMinutesAgo ?? 0) : null;
  await getDatabase()
    .insert(cashSessions)
    .values({
      id,
      tenantId,
      siteId: args.siteId ?? siteId,
      cashierId: args.cashierId,
      registerName: `Pace ${id}`,
      openingFloat: 0,
      openingCountDenominations: [],
      expectedBalance: 0,
      status: args.status,
      openedAt,
      closedAt,
      paceItemsPerMinute: args.paceItemsPerMinute,
      createdAt: openedAt,
      updatedAt: closedAt ?? openedAt,
    });
  return id;
}

async function insertSale(args: {
  sessionId: string;
  cashierId: string;
  quantity: number;
  status?: 'draft' | 'completed' | 'voided';
  checkoutStartedMinutesAgo?: number;
  completedMinutesAgo?: number;
}) {
  const id = nanoid();
  const status = args.status ?? 'completed';
  await getDatabase()
    .insert(sales)
    .values({
      id,
      tenantId,
      saleNumber: `PACE-${nanoid(8)}`,
      subtotal: args.quantity,
      taxAmount: 0,
      discountAmount: 0,
      total: args.quantity,
      paymentMethod: 'cash',
      paymentStatus: status === 'completed' ? 'paid' : 'pending',
      status,
      cashSessionId: args.sessionId,
      createdBy: args.cashierId,
      checkoutStartedAt:
        args.checkoutStartedMinutesAgo === undefined
          ? null
          : isoBefore(args.checkoutStartedMinutesAgo),
      checkoutCompletedAt:
        args.checkoutStartedMinutesAgo === undefined
          ? null
          : isoBefore(args.completedMinutesAgo ?? 1),
      createdAt: isoBefore(args.completedMinutesAgo ?? 1),
      updatedAt: isoBefore(args.completedMinutesAgo ?? 1),
    });
  await getDatabase().insert(saleItems).values({
    id: nanoid(),
    saleId: id,
    productId,
    quantity: args.quantity,
    unitPrice: 1,
    total: args.quantity,
  });
}

function createCallerContext(userId: string, role = 'cashier'): Context {
  return {
    req: {} as Context['req'],
    res: {} as Context['res'],
    db: getDatabase(),
    user: {
      id: userId,
      email: `${userId}@example.com`,
      role,
      tenantId,
    },
    tenantId,
    siteId,
  };
}

describe('cashier pace (ENG-209)', () => {
  beforeAll(async () => {
    fixedNow = new Date('2026-07-13T18:00:00.000Z');
    server = await createServer({ dbPath: ':memory:', verbose: false });
    const db = getDatabase();
    const admin = await db.select().from(users).where(eq(users.email, 'admin@localhost')).get();
    if (!admin) throw new Error('Expected seeded admin');
    tenantId = admin.tenantId;
    const site = await db
      .select()
      .from(sites)
      .where(and(eq(sites.tenantId, tenantId), eq(sites.isActive, true)))
      .get();
    if (!site) throw new Error('Expected seeded site');
    siteId = site.id;
    otherSiteId = nanoid();
    await db.insert(sites).values({
      id: otherSiteId,
      tenantId,
      companyId: site.companyId,
      name: `Pace secondary ${nanoid(6)}`,
      isActive: true,
      createdAt: fixedNow.toISOString(),
      updatedAt: fixedNow.toISOString(),
    });
    productId = nanoid();
    await db.insert(products).values({
      id: productId,
      tenantId,
      name: 'Pace product',
      sku: `PACE-${nanoid(6)}`,
      createdAt: fixedNow.toISOString(),
      updatedAt: fixedNow.toISOString(),
    });

    cashierId = nanoid();
    otherCashierId = nanoid();
    const createdAt = fixedNow.toISOString();
    await db.insert(users).values([
      {
        id: cashierId,
        tenantId,
        email: 'pace-cashier@example.com',
        passwordHash: 'x',
        name: 'Pace Cashier',
        role: 'cashier',
        isActive: true,
        createdAt,
        updatedAt: createdAt,
      },
      {
        id: otherCashierId,
        tenantId,
        email: 'pace-other@example.com',
        passwordHash: 'x',
        name: 'Other Cashier',
        role: 'cashier',
        isActive: true,
        createdAt,
        updatedAt: createdAt,
      },
    ]);

    activeSessionId = await insertSession({
      cashierId,
      status: 'open',
      openedMinutesAgo: 10,
    });
    const bestSessionId = await insertSession({
      cashierId,
      status: 'closed',
      openedMinutesAgo: 30,
      closedMinutesAgo: 25,
      paceItemsPerMinute: 2,
    });
    await insertSession({
      cashierId,
      siteId: otherSiteId,
      status: 'closed',
      openedMinutesAgo: 2,
      closedMinutesAgo: 1,
      paceItemsPerMinute: 99,
    });
    const otherSessionId = await insertSession({
      cashierId: otherCashierId,
      status: 'open',
      openedMinutesAgo: 1,
    });

    // Fresh + resumed-completed sales count once each. Still-draft and voided
    // rows remain outside the performance totals.
    await insertSale({
      sessionId: activeSessionId,
      cashierId,
      quantity: 2,
      checkoutStartedMinutesAgo: 9,
      completedMinutesAgo: 8,
    });
    await insertSale({
      sessionId: activeSessionId,
      cashierId,
      quantity: 3,
      checkoutStartedMinutesAgo: 6,
      completedMinutesAgo: 1,
    });
    await insertSale({ sessionId: activeSessionId, cashierId, quantity: 100, status: 'draft' });
    await insertSale({ sessionId: activeSessionId, cashierId, quantity: 200, status: 'voided' });
    await insertSale({ sessionId: bestSessionId, cashierId, quantity: 10 });
    await insertSale({ sessionId: otherSessionId, cashierId: otherCashierId, quantity: 1000 });
  });

  afterAll(async () => {
    await server.close();
  });

  it('counts completed fresh/resumed work and excludes drafts, voids, and other cashiers', async () => {
    const result = await computeCashierPace({
      db: getDatabase(),
      tenantId,
      siteId,
      cashierId,
      now: fixedNow,
    });

    expect(result).toEqual({
      sessionId: activeSessionId,
      completedSales: 2,
      itemCount: 5,
      itemsPerMinute: 0.5,
      averageCheckoutSeconds: 180,
      personalBestItemsPerMinute: 2,
    });

    // Reprints, refunds, or metadata edits advance updatedAt after checkout.
    // The pace metric must keep the immutable completion boundary.
    await getDatabase()
      .update(sales)
      .set({ updatedAt: fixedNow.toISOString() })
      .where(
        and(
          eq(sales.tenantId, tenantId),
          eq(sales.cashSessionId, activeSessionId),
          eq(sales.status, 'completed')
        )
      );
    const afterLifecycleUpdate = await computeCashierPace({
      db: getDatabase(),
      tenantId,
      siteId,
      cashierId,
      now: fixedNow,
    });
    expect(afterLifecycleUpdate?.averageCheckoutSeconds).toBe(180);
  });

  it('keeps abandoned, future, and uninstrumented carts out of the average', () => {
    expect(resolveCheckoutTiming(isoBefore(30), fixedNow.toISOString())).toEqual({
      checkoutStartedAt: isoBefore(30),
      checkoutCompletedAt: fixedNow.toISOString(),
    });
    expect(resolveCheckoutTiming(undefined, fixedNow.toISOString())).toEqual({
      checkoutStartedAt: null,
      checkoutCompletedAt: null,
    });
    expect(resolveCheckoutTiming(isoBefore(241), fixedNow.toISOString())).toEqual({
      checkoutStartedAt: null,
      checkoutCompletedAt: null,
    });
    expect(
      resolveCheckoutTiming(
        new Date(fixedNow.getTime() + 1_000).toISOString(),
        fixedNow.toISOString()
      )
    ).toEqual({ checkoutStartedAt: null, checkoutCompletedAt: null });
  });

  it.each(['draft', 'cancelled', 'voided'] as const)(
    'does not mark a %s fresh-sale state as a completed checkout',
    status => {
      expect(resolveFreshCheckoutTiming(status, isoBefore(1), fixedNow.toISOString())).toEqual({
        checkoutStartedAt: null,
        checkoutCompletedAt: null,
      });
    }
  );

  it('exposes only the authenticated cashier and rejects non-sales roles', async () => {
    const own = await appRouter.createCaller(createCallerContext(cashierId)).cashSessions.myPace();
    expect(own?.sessionId).toBe(activeSessionId);
    expect(own?.itemCount).toBe(5);
    expect(own?.personalBestItemsPerMinute).toBe(2);

    await expect(
      appRouter.createCaller(createCallerContext(cashierId, 'viewer')).cashSessions.myPace()
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});
