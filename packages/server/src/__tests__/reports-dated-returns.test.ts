/**
 * A return is a dated event, not a retroactive edit to the sale that produced
 * it. Reports used to correlate lifetime returns onto the sale row and then
 * window on the SALE date, which meant a return booked today rewrote the day
 * the ticket was sold — restating closed periods and signed day closes — while
 * contributing nothing to today.
 *
 * These cases pin both directions of that: the closed period must not move,
 * and the period the refund actually happened in must carry it.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq, sql } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { createServer, type PuntovivoServer } from '../index.js';
import { getDatabase } from '../db/index.js';
import { cashSessions, sales, saleReturns, sites, users } from '../db/schema.js';
import {
  datedRevenueSaleConditions,
  windowReturnedAmountSql,
} from '../services/reports/net-sales.js';

let server: PuntovivoServer;
let tenantId: string;
let userId: string;
let siteId: string;
let cashSessionId: string;

const YESTERDAY = '2026-08-20';
const TODAY = '2026-08-21';
const dayStart = (day: string) => `${day}T00:00:00.000Z`;
/**
 * The window helpers take a HALF-OPEN upper bound, so a day's window ends at
 * the next day's start. Passing the inclusive `23:59:59.999` here is the same
 * mistake the callers were making, and it is why a refund booked in that final
 * millisecond went missing from the day that earned it.
 */
const dayEndExclusive = (day: string) =>
  new Date(Date.parse(`${day}T00:00:00.000Z`) + 24 * 60 * 60 * 1000).toISOString();
const lastInstantOf = (day: string) => `${day}T23:59:59.999Z`;

beforeAll(async () => {
  server = await createServer({ dbPath: ':memory:', verbose: false });
  const db = getDatabase();
  const admin = await db.select().from(users).where(eq(users.email, 'admin@localhost')).get();
  if (!admin) throw new Error('Expected seeded admin');
  tenantId = admin.tenantId;
  userId = admin.id;
  const site = await db.select().from(sites).where(eq(sites.tenantId, tenantId)).get();
  if (!site) throw new Error('Expected seeded site');
  siteId = site.id;
  // A completed sale needs a drawer: chk_sales_cash_session_or_draft.
  cashSessionId = nanoid();
  await db.insert(cashSessions).values({
    id: cashSessionId,
    tenantId,
    siteId,
    cashierId: userId,
    registerName: 'Dated returns register',
    openingFloat: 0,
    openingCountDenominations: [],
    expectedBalance: 0,
    status: 'closed',
    openedAt: `${YESTERDAY}T08:00:00.000Z`,
    closedAt: `${YESTERDAY}T20:00:00.000Z`,
    createdAt: `${YESTERDAY}T08:00:00.000Z`,
    updatedAt: `${YESTERDAY}T20:00:00.000Z`,
  });
});

afterAll(async () => {
  await server.close();
});

describe('returns are booked on the date they happen', () => {
  it('counts a refund booked in the last millisecond of the day', async () => {
    // The window helpers are half-open, and every caller was handing them the
    // inclusive end-of-day used by the sale-side comparison beside them. A
    // refund recorded at 23:59:59.999 was therefore dropped from the day's
    // refunds while a sale at that same instant was kept, so the two halves
    // of one net figure disagreed about a single millisecond.
    const db = getDatabase();
    const saleId = nanoid();
    const returnId = nanoid();

    await db.insert(sales).values({
      id: saleId,
      tenantId,
      saleNumber: `VTA-EDGE-${nanoid(5)}`,
      siteId,
      subtotal: 100,
      taxAmount: 0,
      discountAmount: 0,
      total: 100,
      paymentMethod: 'cash',
      paymentStatus: 'paid',
      status: 'completed',
      cashSessionId,
      checkoutCompletedAt: `${TODAY}T10:00:00.000Z`,
      createdBy: userId,
      createdAt: `${TODAY}T10:00:00.000Z`,
      updatedAt: `${TODAY}T10:00:00.000Z`,
    });
    await db.insert(saleReturns).values({
      id: returnId,
      tenantId,
      saleId,
      destination: 'original',
      subtotal: 25,
      tipAmount: 0,
      serviceChargeAmount: 0,
      discountAmount: 0,
      taxAmount: 0,
      refundAmount: 25,
      currencyCode: 'COP',
      createdBy: userId,
      createdAt: lastInstantOf(TODAY),
    });

    try {
      const refundsToday = (await db.get(
        sql`select ${windowReturnedAmountSql(tenantId, dayStart(TODAY), dayEndExclusive(TODAY))} as amount`
      )) as { amount: number } | undefined;
      expect(Number(refundsToday?.amount ?? 0)).toBe(25);

      // And it must not leak into the following day.
      const refundsTomorrow = (await db.get(
        sql`select ${windowReturnedAmountSql(tenantId, dayEndExclusive(TODAY), dayEndExclusive('2026-08-22'))} as amount`
      )) as { amount: number } | undefined;
      expect(Number(refundsTomorrow?.amount ?? 0)).toBe(0);
    } finally {
      await db.delete(saleReturns).where(eq(saleReturns.id, returnId));
      await db.delete(sales).where(and(eq(sales.id, saleId), eq(sales.tenantId, tenantId)));
    }
  });

  it('a refund booked today does not move yesterday, and lands in today', async () => {
    const db = getDatabase();
    const saleId = nanoid();
    const returnId = nanoid();

    // Sold yesterday.
    await db.insert(sales).values({
      id: saleId,
      tenantId,
      saleNumber: `VTA-DATED-${nanoid(5)}`,
      siteId,
      subtotal: 100,
      taxAmount: 0,
      discountAmount: 0,
      total: 100,
      paymentMethod: 'cash',
      paymentStatus: 'paid',
      status: 'completed',
      cashSessionId,
      checkoutCompletedAt: `${YESTERDAY}T10:00:00.000Z`,
      createdBy: userId,
      createdAt: `${YESTERDAY}T10:00:00.000Z`,
      updatedAt: `${YESTERDAY}T10:00:00.000Z`,
    });

    // Returned today, for 40.
    await db.insert(saleReturns).values({
      id: returnId,
      tenantId,
      saleId,
      destination: 'original',
      subtotal: 40,
      tipAmount: 0,
      serviceChargeAmount: 0,
      discountAmount: 0,
      taxAmount: 0,
      refundAmount: 40,
      currencyCode: 'COP',
      createdBy: userId,
      createdAt: `${TODAY}T09:00:00.000Z`,
    });

    try {
      const refundsYesterday = (await db.get(
        sql`select ${windowReturnedAmountSql(tenantId, dayStart(YESTERDAY), dayEndExclusive(YESTERDAY))} as amount`
      )) as { amount: number } | undefined;
      const refundsToday = (await db.get(
        sql`select ${windowReturnedAmountSql(tenantId, dayStart(TODAY), dayEndExclusive(TODAY))} as amount`
      )) as { amount: number } | undefined;

      // The closed day is untouched...
      expect(Number(refundsYesterday?.amount ?? 0)).toBe(0);
      // ...and the refund belongs to the day it was actually booked.
      expect(Number(refundsToday?.amount ?? 0)).toBe(40);
    } finally {
      await db.delete(saleReturns).where(eq(saleReturns.id, returnId));
      await db.delete(sales).where(and(eq(sales.id, saleId), eq(sales.tenantId, tenantId)));
    }
  });

  it('gross revenue keeps the returned sale, so the refund is not subtracted twice', () => {
    // The dated model books the refund as its own event, so the sale side must
    // NOT also filter the returned ticket out. Doing both would remove it
    // twice AND remove it from the day it was actually sold, which is the
    // retroactive restatement this model exists to stop. Sold and returned on
    // the same day therefore nets to zero rather than to minus the total.
    const conditions = datedRevenueSaleConditions(tenantId);
    expect(conditions).toHaveLength(2);
    const rendered = conditions.map(condition => String(condition)).join(' ');
    expect(rendered).not.toMatch(/return_state/i);
  });
});
