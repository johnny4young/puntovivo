/**
 * ENG-198 — day-close ritual summary.
 *
 * Computes everything the post-close screen shows for the day a cash session
 * was closed on: the day's realized sales, the session's over/short outcome,
 * the top products, the day's real gross margin (per-lot COGS via the
 * ENG-190 ledger) and the tenant's balanced-close streak.
 *
 * Role gating happens HERE, not in the client: the closer is usually a
 * cashier, and margin/profit are owner data (same philosophy as the ENG-194
 * blind close). With `includeProfit: false` the summary strips `margin` to
 * null and the top products carry revenue only, re-ranked by revenue.
 *
 * Day boundaries are UTC calendar days over `closed_at` / `created_at` —
 * deliberately consistent with `dashboard.summary` today; the tenant-timezone
 * cut is a tracked follow-up.
 *
 * @module services/reports/day-close
 */

import { and, asc, desc, eq, gte, isNotNull, lte, sql } from 'drizzle-orm';
import type { DatabaseInstance } from '../../db/index.js';
import { cashSessions, products, saleItems, sales } from '../../db/schema.js';
import { throwServerError } from '../../lib/errorCodes.js';
import { roundMoney } from '../../lib/money.js';
import { computeProfitMarginReport } from './profit-margin.js';

/**
 * Tolerance under which a closed session counts as balanced for the streak.
 * Mirrors CASH_OVER_SHORT_EPSILON (Operations cash panel) and the ENG-194
 * live-delta epsilon so every surface agrees on "cuadrada".
 */
export const DAY_CLOSE_BALANCED_EPSILON = 0.009;

/** How far back the streak scan looks. A 90-day cap bounds the query and is
 * far beyond any realistic display need ("90+ días" reads as legendary). */
const STREAK_LOOKBACK_DAYS = 90;
const DAY_CLOSE_TOP_PRODUCT_LIMIT = 3;

/** One top product of the day. Profit fields are present only when the
 * caller may see owner data (`includeProfit`); `null` otherwise. */
export interface DayCloseTopProduct {
  productId: string;
  name: string;
  sku: string;
  revenue: number;
  grossProfit: number | null;
  grossMarginPct: number | null;
}

/**
 * The full ritual payload. `margin` is `null` for viewers without profit
 * access (cashiers); `streakDays` counts consecutive calendar days (ending on
 * the session's close day) where EVERY closed session of the tenant was
 * balanced — days without closed sessions are transparent (they neither
 * extend nor break the streak).
 */
export interface DayCloseSummary {
  session: {
    registerName: string;
    closedAt: string;
    actualCount: number | null;
    overShort: number | null;
    balanced: boolean;
  };
  day: {
    /** UTC calendar day (YYYY-MM-DD) the summary covers. */
    date: string;
    salesCount: number;
    revenue: number;
  };
  topProducts: DayCloseTopProduct[];
  margin: { grossProfit: number; grossMarginPct: number } | null;
  streakDays: number;
}

interface ComputeDayCloseSummaryInput {
  tenantId: string;
  sessionId: string;
  /** Authenticated caller; owns the session-ownership check below. */
  viewerUserId: string;
  /** True when the viewer may see owner data (margin/COGS). Visibility
   * ONLY — deliberately independent from the access-control flag below so a
   * future revenue-only privileged view cannot accidentally lose access to
   * other cashiers' sessions. */
  includeProfit: boolean;
  /** True when the viewer may summarize sessions closed by OTHER cashiers
   * (manager/admin today). Access control ONLY. */
  canViewAnyCashierSession: boolean;
}

/** UTC day (YYYY-MM-DD) of an ISO timestamp. */
function utcDayOf(iso: string): string {
  return iso.slice(0, 10);
}

export function computeDayCloseSummary(
  db: DatabaseInstance,
  input: ComputeDayCloseSummaryInput
): DayCloseSummary {
  const session = db
    .select({
      registerName: cashSessions.registerName,
      cashierId: cashSessions.cashierId,
      status: cashSessions.status,
      closedAt: cashSessions.closedAt,
      actualCount: cashSessions.actualCount,
      overShort: cashSessions.overShort,
    })
    .from(cashSessions)
    .where(and(eq(cashSessions.tenantId, input.tenantId), eq(cashSessions.id, input.sessionId)))
    .get();

  if (!session || (!input.canViewAnyCashierSession && session.cashierId !== input.viewerUserId)) {
    throwServerError({
      trpcCode: 'NOT_FOUND',
      errorCode: 'CASH_SESSION_NOT_FOUND',
      message: 'Cash session not found for this tenant',
      details: { sessionId: input.sessionId },
    });
  }
  if (session.status !== 'closed' || !session.closedAt) {
    throwServerError({
      trpcCode: 'BAD_REQUEST',
      errorCode: 'CASH_SESSION_NOT_CLOSED',
      message: 'The day-close summary is only available for a closed session',
      details: { sessionId: input.sessionId },
    });
  }

  const day = utcDayOf(session.closedAt);
  const dayStart = `${day}T00:00:00.000Z`;
  const dayEnd = `${day}T23:59:59.999Z`;
  const eligibleSales = and(
    eq(sales.tenantId, input.tenantId),
    eq(sales.status, 'completed'),
    sql`${sales.paymentStatus} != 'refunded'`,
    gte(sales.createdAt, dayStart),
    lte(sales.createdAt, dayEnd)
  );

  // Realized revenue of the day — the same filter dashboard.summary and the
  // profit report use, so every surface tells one story.
  const dayStats = db
    .select({
      salesCount: sql<number>`count(*)`,
      revenue: sql<number>`coalesce(sum(${sales.total}), 0)`,
    })
    .from(sales)
    .where(eligibleSales)
    .get();

  let topProducts: DayCloseTopProduct[];
  let margin: DayCloseSummary['margin'];
  if (input.includeProfit) {
    // Owner view: real per-lot COGS/margin from ENG-190, bounded to the three
    // profit leaders the ritual renders.
    const profitReport = computeProfitMarginReport(db, {
      tenantId: input.tenantId,
      fromDate: dayStart,
      toDate: dayEnd,
      limit: DAY_CLOSE_TOP_PRODUCT_LIMIT,
    });
    topProducts = profitReport.products.map(row => ({
      productId: row.productId,
      name: row.name,
      sku: row.sku,
      revenue: row.revenue,
      grossProfit: row.grossProfit,
      grossMarginPct: row.grossMarginPct,
    }));
    margin = {
      grossProfit: profitReport.summary.grossProfit,
      grossMarginPct: profitReport.summary.grossMarginPct,
    };
  } else {
    // Cashier view: do not compute owner-only COGS/margin at all. Aggregate
    // revenue directly and let SQLite enforce the top-three bound, avoiding
    // both profit-order leakage and an unbounded JS materialization.
    const productRevenue = sql<number>`coalesce(sum(${saleItems.total}), 0)`;
    const revenueLeaders = db
      .select({
        productId: saleItems.productId,
        name: products.name,
        sku: products.sku,
        revenue: productRevenue,
      })
      .from(saleItems)
      .innerJoin(sales, eq(saleItems.saleId, sales.id))
      .innerJoin(products, eq(saleItems.productId, products.id))
      .where(eligibleSales)
      .groupBy(saleItems.productId, products.name, products.sku)
      .orderBy(desc(productRevenue), asc(products.name), asc(saleItems.productId))
      .limit(DAY_CLOSE_TOP_PRODUCT_LIMIT)
      .all();

    topProducts = revenueLeaders.map(row => ({
      productId: row.productId,
      name: row.name,
      sku: row.sku,
      // ENG-176a — aggregated monetary values cross the money boundary here.
      revenue: roundMoney(row.revenue),
      grossProfit: null,
      grossMarginPct: null,
    }));
    margin = null;
  }

  // Streak: one grouped scan of the tenant's closed sessions, then walk the
  // days backwards from the session's close day. Days without sessions are
  // transparent; a day with any unbalanced close breaks the streak.
  const lookbackStart = new Date(
    Date.parse(dayStart) - (STREAK_LOOKBACK_DAYS - 1) * 24 * 60 * 60 * 1000
  ).toISOString();
  const dayRows = db
    .select({
      day: sql<string>`date(${cashSessions.closedAt})`,
      maxAbsOverShort: sql<number>`max(abs(coalesce(${cashSessions.overShort}, 0)))`,
    })
    .from(cashSessions)
    .where(
      and(
        eq(cashSessions.tenantId, input.tenantId),
        eq(cashSessions.status, 'closed'),
        isNotNull(cashSessions.closedAt),
        gte(cashSessions.closedAt, lookbackStart),
        sql`${cashSessions.closedAt} <= ${dayEnd}`
      )
    )
    .groupBy(sql`date(${cashSessions.closedAt})`)
    .all();

  const balancedByDay = new Map(
    dayRows.map(row => [row.day, row.maxAbsOverShort <= DAY_CLOSE_BALANCED_EPSILON])
  );
  let streakDays = 0;
  const cursor = new Date(`${day}T00:00:00.000Z`);
  for (let i = 0; i < STREAK_LOOKBACK_DAYS; i++) {
    const cursorDay = cursor.toISOString().slice(0, 10);
    const dayBalanced = balancedByDay.get(cursorDay);
    if (dayBalanced === false) break;
    if (dayBalanced === true) streakDays += 1;
    // undefined → no closed sessions that day → transparent.
    cursor.setUTCDate(cursor.getUTCDate() - 1);
  }

  const overShort = session.overShort ?? null;

  return {
    session: {
      registerName: session.registerName,
      closedAt: session.closedAt,
      actualCount: session.actualCount ?? null,
      overShort,
      balanced: Math.abs(overShort ?? 0) <= DAY_CLOSE_BALANCED_EPSILON,
    },
    day: {
      date: day,
      salesCount: dayStats?.salesCount ?? 0,
      // ENG-176a — the SQL float sum is a monetary accumulation; round it.
      revenue: roundMoney(dayStats?.revenue ?? 0),
    },
    topProducts,
    margin,
    streakDays,
  };
}
