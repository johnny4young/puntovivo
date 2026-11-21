import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { createServer, type PuntovivoServer } from '../index.js';
import { getDatabase } from '../db/index.js';
import {
  cashSessions,
  managerApprovalRequests,
  products,
  sales,
  scheduledShifts,
  sites,
  tenants,
  users,
} from '../db/schema.js';
import { resolveTenantBusinessClock } from '../services/pharmacy/business-clock.js';
import { addCalendarDays, resolveUtcDayWindow } from '../services/reports/day-window.js';
import { computeOperationsToday } from '../services/operations/today.js';
import { reportRegisterIncident } from '../services/register-incidents.js';
import { appRouter } from '../trpc/router.js';
import type { Context } from '../trpc/context.js';

let server: PuntovivoServer;
let tenantId: string;
let adminId: string;
let siteId: string;
let now: Date;
let todayStart: Date;
const openSessionId = nanoid();
const staleSessionId = nanoid();

const hoursAfter = (base: Date, hours: number) =>
  new Date(base.getTime() + hours * 3_600_000).toISOString();

function insertSale(sessionId: string, total: number, completedAt: string) {
  getDatabase()
    .insert(sales)
    .values({
      id: nanoid(),
      tenantId,
      saleNumber: `HOY-${nanoid(6)}`,
      subtotal: total,
      taxAmount: 0,
      discountAmount: 0,
      total,
      paymentMethod: 'cash',
      paymentStatus: 'paid',
      status: 'completed',
      cashSessionId: sessionId,
      createdBy: adminId,
      createdAt: completedAt,
      checkoutCompletedAt: completedAt,
    })
    .run();
}

describe('operations.today', () => {
  beforeAll(async () => {
    server = await createServer({ dbPath: ':memory:', verbose: false });
    const db = getDatabase();
    const admin = db.select().from(users).where(eq(users.email, 'admin@localhost')).get();
    if (!admin) throw new Error('Expected seeded admin user');
    tenantId = admin.tenantId;
    adminId = admin.id;
    const site = db.select().from(sites).where(eq(sites.tenantId, tenantId)).get();
    if (!site) throw new Error('Expected a seeded site');
    siteId = site.id;

    const clock = await resolveTenantBusinessClock(db, tenantId, new Date());
    todayStart = new Date(resolveUtcDayWindow(clock.businessDate, clock.timezone).startIso);
    now = new Date(todayStart.getTime() + 12 * 3_600_000);
    const lastWeekStart = new Date(
      resolveUtcDayWindow(addCalendarDays(clock.businessDate, -7), clock.timezone).startIso
    );

    db.insert(cashSessions)
      .values([
        {
          id: openSessionId,
          tenantId,
          siteId,
          cashierId: adminId,
          registerName: 'Caja 1',
          openingCountDenominations: [],
          status: 'open',
          openedAt: hoursAfter(todayStart, 7),
        },
        {
          id: staleSessionId,
          tenantId,
          siteId,
          cashierId: adminId,
          registerName: 'Caja 3',
          openingCountDenominations: [],
          status: 'open',
          openedAt: hoursAfter(todayStart, -3),
        },
      ])
      .run();
    insertSale(openSessionId, 30000, hoursAfter(todayStart, 9.5));
    insertSale(openSessionId, 10000, hoursAfter(todayStart, 11.25));
    insertSale(openSessionId, 20000, hoursAfter(lastWeekStart, 9.25));

    db.insert(managerApprovalRequests)
      .values({
        id: nanoid(),
        tenantId,
        siteId,
        requesterId: adminId,
        action: 'sale_refund',
        status: 'pending',
        reason: 'Producto dañado',
        resourceType: 'sale',
        summary: { label: 'Devolución', amount: 48500 },
        requestedAt: hoursAfter(todayStart, 11.5),
        expiresAt: hoursAfter(todayStart, 48),
      })
      .run();
    const receiverId = nanoid();
    const elsewhereId = nanoid();
    const otherSiteId = nanoid();
    db.insert(users)
      .values(
        [
          [receiverId, 'Camila'],
          [elsewhereId, 'Diego'],
        ].map(([id, name]) => ({
          id: id!,
          tenantId,
          email: `${id}@example.test`,
          name: name!,
          passwordHash: 'not-used',
          role: 'cashier' as const,
        }))
      )
      .run();
    db.insert(sites)
      .values({ id: otherSiteId, tenantId, companyId: site.companyId, name: 'Sede Sur' })
      .run();
    const shift = (userId: string, shiftSite: string, from: number, to: number) => ({
      id: nanoid(),
      tenantId,
      userId,
      siteId: shiftSite,
      startsAt: hoursAfter(todayStart, from),
      endsAt: hoursAfter(todayStart, to),
      timeZone: clock.timezone,
      createdByUserId: adminId,
      updatedByUserId: adminId,
    });
    db.insert(scheduledShifts)
      .values([
        shift(adminId, siteId, 7, 14),
        // Starts exactly at the handoff, but at another site.
        shift(elsewhereId, otherSiteId, 14, 20),
        shift(receiverId, siteId, 14.25, 21),
      ])
      .run();
    const productId = nanoid();
    db.insert(products)
      .values({ id: productId, tenantId, name: 'Leche UHT', sku: `HOY-${nanoid(6)}`, price: 4900 })
      .run();
    await reportRegisterIncident(
      db,
      { tenantId, siteId, userId: adminId },
      { kind: 'stockout', productId }
    );
  });

  afterAll(async () => {
    await server.close();
  });

  it('sums today against the same weekday last week, hour by hour', async () => {
    const today = await computeOperationsToday(getDatabase(), tenantId, now);
    expect(today.sales).toMatchObject({
      total: 40000,
      orders: 2,
      averageTicket: 20000,
      comparisonTotal: 20000,
    });
    expect(today.hourly[9]).toMatchObject({ hour: 9, today: 30000, comparison: 20000 });
    expect(today.hourly[11]).toMatchObject({ today: 10000, comparison: 0 });
    expect(today.hourly.reduce((sum, row) => sum + row.today, 0)).toBe(40000);
  });

  it('lists open registers with their sales and the planned handoff', async () => {
    const today = await computeOperationsToday(getDatabase(), tenantId, now);
    const open = today.registers.find(register => register.sessionId === openSessionId);
    expect(open).toMatchObject({
      registerName: 'Caja 1',
      salesTotal: 60000,
      salesCount: 3,
      openedBeforeToday: false,
      scheduledEndAt: hoursAfter(todayStart, 14),
    });
    expect(today.nextHandoff).toMatchObject({
      at: hoursAfter(todayStart, 14),
      fromUserName: open!.cashierName,
      toUserName: 'Camila',
    });
    expect(today.shifts).toHaveLength(3);
  });

  it('leaves the receiver empty when no one starts near the handoff at that site', async () => {
    const late = new Date(todayStart.getTime() + 13.5 * 3_600_000);
    const db = getDatabase();
    const receiverShift = db
      .select()
      .from(scheduledShifts)
      .where(eq(scheduledShifts.startsAt, hoursAfter(todayStart, 14.25)))
      .get()!;
    db.update(scheduledShifts)
      .set({ startsAt: hoursAfter(todayStart, 15.5) })
      .where(eq(scheduledShifts.id, receiverShift.id))
      .run();
    try {
      const today = await computeOperationsToday(db, tenantId, late);
      expect(today.nextHandoff).toMatchObject({ toUserName: null });
    } finally {
      db.update(scheduledShifts)
        .set({ startsAt: receiverShift.startsAt })
        .where(eq(scheduledShifts.id, receiverShift.id))
        .run();
    }
  });

  it('does not name a receiver who is already running another register', async () => {
    const db = getDatabase();
    const camila = db.select().from(users).where(eq(users.name, 'Camila')).get()!;
    const busySessionId = nanoid();
    db.insert(cashSessions)
      .values({
        id: busySessionId,
        tenantId,
        siteId,
        cashierId: camila.id,
        registerName: 'Caja 2',
        openingCountDenominations: [],
        status: 'open',
        openedAt: hoursAfter(todayStart, 11),
      })
      .run();
    try {
      const today = await computeOperationsToday(db, tenantId, now);
      expect(today.nextHandoff).toMatchObject({ registerName: 'Caja 1', toUserName: null });
    } finally {
      db.delete(cashSessions).where(eq(cashSessions.id, busySessionId)).run();
    }
  });

  it('orders the pending queue by what blocks the close', async () => {
    const { pending } = await computeOperationsToday(getDatabase(), tenantId, now);
    const kinds = pending.map(item => `${item.severity}:${item.kind}`);
    expect(kinds.slice(0, 2)).toEqual(['blocks:staleSession', 'blocks:approval']);
    expect(kinds).toContain('beforeClose:incident');
    const approval = pending.find(item => item.kind === 'approval');
    expect(approval).toMatchObject({
      label: 'Devolución',
      amount: 48500,
      origin: 'cashier',
      reason: 'Producto dañado',
      requesterId: adminId,
    });
  });

  it('is for managers only and never leaks another tenant', async () => {
    const foreignTenant = nanoid();
    getDatabase()
      .insert(tenants)
      .values({ id: foreignTenant, slug: nanoid(), name: 'Other' })
      .run();
    const ctx = (role: 'cashier' | 'manager', tenant: string) =>
      ({
        req: { server: server.app, headers: {}, user: { userId: adminId, role, tenantId: tenant } },
        res: {},
        db: getDatabase(),
        user: { id: adminId, email: 'admin@localhost', role, tenantId: tenant },
        tenantId: tenant,
        siteId: null,
      }) as unknown as Context;
    await expect(
      appRouter.createCaller(ctx('cashier', tenantId)).operations.today()
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    const foreign = await appRouter.createCaller(ctx('manager', foreignTenant)).operations.today();
    expect(foreign.registers).toEqual([]);
    expect(foreign.pending.filter(item => item.kind !== 'attention')).toEqual([]);
    expect(foreign.sales.total).toBe(0);
  });
});
