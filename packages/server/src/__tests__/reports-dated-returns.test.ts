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
const dayEnd = (day: string) => `${day}T23:59:59.999Z`;

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
        sql`select ${windowReturnedAmountSql(tenantId, dayStart(YESTERDAY), dayEnd(YESTERDAY))} as amount`
      )) as { amount: number } | undefined;
      const refundsToday = (await db.get(
        sql`select ${windowReturnedAmountSql(tenantId, dayStart(TODAY), dayEnd(TODAY))} as amount`
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
