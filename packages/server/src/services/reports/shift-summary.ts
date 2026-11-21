/**
 * The caller's own shift so far, for the handoff sheet: completed sales of the
 * open session and their spread over the shift. Revenue covers every tender,
 * so it never reveals the drawer's expected cash under a blind close.
 */
import { and, asc, eq, sql } from 'drizzle-orm';
import type { DatabaseInstance } from '../../db/index.js';
import { sales } from '../../db/schema.js';
import { roundMoney } from '../../lib/money.js';
import { getActiveCashSessionForCashier } from '../cash-session.js';

export const SHIFT_SUMMARY_SLICES = 12;

export interface ShiftSummary {
  sessionId: string;
  openedAt: string;
  salesCount: number;
  revenue: number;
  /** Revenue per equal slice of the shift, oldest first. */
  slices: number[];
}

export async function computeShiftSummary({
  db,
  tenantId,
  siteId,
  cashierId,
  now = new Date(),
}: {
  db: DatabaseInstance;
  tenantId: string;
  siteId: string;
  cashierId: string;
  now?: Date;
}): Promise<ShiftSummary | null> {
  const session = await getActiveCashSessionForCashier(db, tenantId, siteId, cashierId);
  if (!session) return null;

  const rows = db
    .select({
      at: sql<string>`coalesce(${sales.checkoutCompletedAt}, ${sales.createdAt})`,
      total: sales.total,
    })
    .from(sales)
    .where(
      and(
        eq(sales.tenantId, tenantId),
        eq(sales.cashSessionId, session.id),
        eq(sales.status, 'completed'),
        sql`(${sales.returnState} is null or ${sales.returnState} != 'refunded')`
      )
    )
    .orderBy(asc(sales.createdAt))
    .all();

  const start = Date.parse(session.openedAt);
  const span = Math.max(1, now.getTime() - start);
  const slices = Array.from({ length: SHIFT_SUMMARY_SLICES }, () => 0);
  let revenue = 0;
  for (const row of rows) {
    revenue = roundMoney(revenue + row.total);
    const at = Date.parse(row.at.includes('T') ? row.at : `${row.at.replace(' ', 'T')}Z`);
    const offset = Number.isFinite(at) ? (at - start) / span : 1;
    const index = Math.min(
      SHIFT_SUMMARY_SLICES - 1,
      Math.max(0, Math.floor(offset * SHIFT_SUMMARY_SLICES))
    );
    slices[index] = roundMoney(slices[index]! + row.total);
  }

  return {
    sessionId: session.id,
    openedAt: session.openedAt,
    salesCount: rows.length,
    revenue,
    slices,
  };
}
