/**
 * () — cashier pace metrics for the opt-in POS HUD.
 *
 * Everything derives from rows that already exist (`cash_sessions` +
 * `sales` + `sale_items`); nothing is written. The HUD motivates, it does
 * not surveil: the metrics are ALWAYS the calling cashier's own — the
 * active session is resolved for (tenant, site, ctx.user) and the personal
 * best scans only that same cashier's closed sessions. Owners read team
 * performance through the normal reports, never through this endpoint.
 *
 * Item counts are BASE units (`quantity × unit_equivalence`) so a case of
 * 12 counts as 12 — pace should reward real throughput, not line count.
 *
 * @module services/cashier-pace
 */

import { and, eq, gte, sql } from 'drizzle-orm';
import type { DatabaseInstance } from '../db/index.js';
import { cashSessions, saleItems, sales } from '../db/schema.js';

/** Pace snapshot of the caller's ACTIVE session, or null without one. */
export interface CashierPace {
  sessionId: string;
  /** Minutes since the session opened (>= 1 so rates never divide by 0). */
  sessionMinutes: number;
  /** Completed, non-refunded sales bound to this session. */
  salesCount: number;
  /** Base units sold across those sales (3-decimal quantities kept raw). */
  itemsQty: number;
  /** itemsQty / sessionMinutes, rounded to 1 decimal. */
  itemsPerMinute: number;
  /** Average seconds between consecutive sales; null under 2 sales. */
  avgSecondsBetweenSales: number | null;
  /**
   * Best items/minute across the cashier's CLOSED sessions of the last 90
   * days (sessions with at least {@link PERSONAL_BEST_MIN_SALES} sales, so
   * a 2-minute smoke-test session cannot set an unbeatable record). Null
   * when no qualifying history exists yet.
   */
  personalBestItemsPerMinute: number | null;
  /** True when the current session's rate meets or beats the best. */
  isPersonalBest: boolean;
}

/** Sessions need this many sales before they can set a personal best. */
export const PERSONAL_BEST_MIN_SALES = 3;

/** How far back the personal-best scan looks (days). */
const PERSONAL_BEST_LOOKBACK_DAYS = 90;

const DAY_MS = 24 * 60 * 60 * 1000;

function roundRate(value: number): number {
  return Math.round(value * 10) / 10;
}

/** Realized-sale filter shared by both scans (dashboard convention). */
function eligibleSalesOf(tenantId: string) {
  return and(
    eq(sales.tenantId, tenantId),
    eq(sales.status, 'completed'),
    sql`${sales.paymentStatus} != 'refunded'`
  );
}

/**
 * Compute the pace snapshot for one ACTIVE session (the router resolves the
 * caller's session and passes it in). `nowIso` is injectable for tests.
 */
export function computeCashierPace(
  db: DatabaseInstance,
  input: {
    tenantId: string;
    cashierId: string;
    session: { id: string; openedAt: string };
    nowIso?: string;
  }
): CashierPace {
  const nowIso = input.nowIso ?? new Date().toISOString();
  const sessionMinutes = Math.max(
    1,
    (Date.parse(nowIso) - Date.parse(input.session.openedAt)) / 60000
  );

  const current = db
    .select({
      salesCount: sql<number>`count(distinct ${sales.id})`,
      itemsQty: sql<number>`coalesce(sum(${saleItems.quantity} * ${saleItems.unitEquivalence}), 0)`,
      firstSaleAt: sql<string | null>`min(${sales.createdAt})`,
      lastSaleAt: sql<string | null>`max(${sales.createdAt})`,
    })
    .from(sales)
    .leftJoin(saleItems, eq(saleItems.saleId, sales.id))
    .where(and(eligibleSalesOf(input.tenantId), eq(sales.cashSessionId, input.session.id)))
    .get();

  const salesCount = current?.salesCount ?? 0;
  const itemsQty = current?.itemsQty ?? 0;
  const itemsPerMinute = roundRate(itemsQty / sessionMinutes);
  const avgSecondsBetweenSales =
    salesCount >= 2 && current?.firstSaleAt && current.lastSaleAt
      ? Math.round(
          (Date.parse(current.lastSaleAt) - Date.parse(current.firstSaleAt)) /
            1000 /
            (salesCount - 1)
        )
      : null;

  // Personal best: one grouped scan over the cashier's closed sessions.
  const lookbackStart = new Date(
    Date.parse(nowIso) - PERSONAL_BEST_LOOKBACK_DAYS * DAY_MS
  ).toISOString();
  const history = db
    .select({
      openedAt: cashSessions.openedAt,
      closedAt: cashSessions.closedAt,
      salesCount: sql<number>`count(distinct ${sales.id})`,
      itemsQty: sql<number>`coalesce(sum(${saleItems.quantity} * ${saleItems.unitEquivalence}), 0)`,
    })
    .from(cashSessions)
    .innerJoin(
      sales,
      and(eq(sales.cashSessionId, cashSessions.id), eligibleSalesOf(input.tenantId))
    )
    .leftJoin(saleItems, eq(saleItems.saleId, sales.id))
    .where(
      and(
        eq(cashSessions.tenantId, input.tenantId),
        eq(cashSessions.cashierId, input.cashierId),
        eq(cashSessions.status, 'closed'),
        gte(cashSessions.closedAt, lookbackStart)
      )
    )
    .groupBy(cashSessions.id, cashSessions.openedAt, cashSessions.closedAt)
    .all();

  let personalBestItemsPerMinute: number | null = null;
  for (const row of history) {
    if (row.salesCount < PERSONAL_BEST_MIN_SALES || !row.closedAt) continue;
    const minutes = Math.max(1, (Date.parse(row.closedAt) - Date.parse(row.openedAt)) / 60000);
    const rate = roundRate(row.itemsQty / minutes);
    if (personalBestItemsPerMinute === null || rate > personalBestItemsPerMinute) {
      personalBestItemsPerMinute = rate;
    }
  }

  return {
    sessionId: input.session.id,
    sessionMinutes: Math.round(sessionMinutes),
    salesCount,
    itemsQty,
    itemsPerMinute,
    avgSecondsBetweenSales,
    personalBestItemsPerMinute,
    isPersonalBest:
      personalBestItemsPerMinute !== null &&
      salesCount >= PERSONAL_BEST_MIN_SALES &&
      itemsPerMinute >= personalBestItemsPerMinute,
  };
}
