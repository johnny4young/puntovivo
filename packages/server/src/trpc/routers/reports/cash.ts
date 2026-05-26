/**
 * ENG-065b — Cash reports sub-router (`reports.cash.*`).
 *
 * Tenant-wide read-only aggregates for the Operations Center Cash tab.
 *
 * The legacy `cashSessions.report` is per-(siteId, cashier) — it drives
 * the in-shift sales screen. This sub-router intentionally drops the
 * site + cashier filters so a manager / admin can see the cash position
 * across every site they operate without having to switch context.
 *
 * Read-only — manager + admin gated. There is no actionable mutation
 * here because cash reconciliation is a physical-world action; the
 * panel surfaces information so the operator knows where to look.
 *
 * Shape stays minimal and stable so the web panel renders the rows
 * directly without mapping.
 *
 * @module trpc/routers/reports/cash
 */

import { and, eq, gte } from 'drizzle-orm';
import { router } from '../../init.js';
import { managerOrAdminProcedure } from '../../middleware/roles.js';
import { cashSessions, sites, users } from '../../../db/schema.js';
import { cashReconciliationInput } from '../../schemas/reports.js';
import { roundMoney as roundCurrency } from '../../../lib/money.js';

/** Sessions are flagged for review when |overShort| exceeds this. */
const CASH_OVER_SHORT_EPSILON = 0.009;

/** Aggregation window for closed sessions (days). */
const RECENT_CLOSURE_WINDOW_DAYS = 30;

function isoDaysAgo(days: number): string {
  const ms = Date.now() - days * 24 * 60 * 60 * 1000;
  return new Date(ms).toISOString();
}

export const cashReportsRouter = router({
  /**
   * Tenant-wide cash reconciliation snapshot for the Operations Center.
   *
   * Returns:
   *   - `summary` — tile values (open sessions, closed in window, net
   *     over/short, largest |overShort|, review count).
   *   - `bySite` — per-site breakdown so the operator knows which site
   *     is bleeding cash.
   *   - `recentDiscrepancies` — top |overShort| closed sessions in the
   *     30-day window, capped by `input.limit`.
   *
   * The 30-day cutoff keeps the query bounded for tenants with deep
   * historical data and matches operator expectations ("show me what's
   * pending review this month").
   */
  reconciliation: managerOrAdminProcedure
    .input(cashReconciliationInput)
    .query(async ({ ctx, input }) => {
      const sinceIso = isoDaysAgo(RECENT_CLOSURE_WINDOW_DAYS);

      // 1. Open sessions across the tenant (no date cutoff — every open
      //    session matters for the live counter).
      const openRows = await ctx.db
        .select({
          siteId: cashSessions.siteId,
          siteName: sites.name,
        })
        .from(cashSessions)
        .innerJoin(sites, eq(cashSessions.siteId, sites.id))
        .where(
          and(
            eq(cashSessions.tenantId, ctx.tenantId),
            eq(cashSessions.status, 'open')
          )
        )
        .all();

      // 2. Closed sessions in the 30-day window — drives both the
      //    summary tiles and the bySite breakdown.
      const closedRows = await ctx.db
        .select({
          id: cashSessions.id,
          siteId: cashSessions.siteId,
          siteName: sites.name,
          cashierName: users.name,
          expectedBalance: cashSessions.expectedBalance,
          actualCount: cashSessions.actualCount,
          overShort: cashSessions.overShort,
          closedAt: cashSessions.closedAt,
        })
        .from(cashSessions)
        .innerJoin(sites, eq(cashSessions.siteId, sites.id))
        .innerJoin(users, eq(cashSessions.cashierId, users.id))
        .where(
          and(
            eq(cashSessions.tenantId, ctx.tenantId),
            eq(cashSessions.status, 'closed'),
            gte(cashSessions.closedAt, sinceIso)
          )
        )
        .all();

      // 3. Aggregate the summary.
      const reviewClosures = closedRows.filter(
        row => Math.abs(row.overShort ?? 0) > CASH_OVER_SHORT_EPSILON
      );
      const netOverShort = roundCurrency(
        closedRows.reduce((sum, row) => sum + (row.overShort ?? 0), 0)
      );
      const largestDiscrepancy = roundCurrency(
        closedRows.reduce(
          (max, row) => Math.max(max, Math.abs(row.overShort ?? 0)),
          0
        )
      );

      const summary = {
        openSessionCount: openRows.length,
        closedRecentCount: closedRows.length,
        reviewCount: reviewClosures.length,
        netOverShort,
        largestDiscrepancy,
        windowDays: RECENT_CLOSURE_WINDOW_DAYS,
      };

      // 4. Group both open + closed sets by siteId for the bySite tile.
      type SiteAccumulator = {
        siteId: string;
        siteName: string;
        openSessions: number;
        closedSessions: number;
        netOverShort: number;
        overShortCount: number;
      };
      const bySiteMap = new Map<string, SiteAccumulator>();

      function getOrCreateSiteRow(siteId: string, siteName: string): SiteAccumulator {
        const existing = bySiteMap.get(siteId);
        if (existing) return existing;
        const created: SiteAccumulator = {
          siteId,
          siteName,
          openSessions: 0,
          closedSessions: 0,
          netOverShort: 0,
          overShortCount: 0,
        };
        bySiteMap.set(siteId, created);
        return created;
      }

      for (const row of openRows) {
        const site = getOrCreateSiteRow(row.siteId, row.siteName);
        site.openSessions += 1;
      }
      for (const row of closedRows) {
        const site = getOrCreateSiteRow(row.siteId, row.siteName);
        site.closedSessions += 1;
        site.netOverShort += row.overShort ?? 0;
        if (Math.abs(row.overShort ?? 0) > CASH_OVER_SHORT_EPSILON) {
          site.overShortCount += 1;
        }
      }

      const bySite = [...bySiteMap.values()]
        .map(row => ({
          ...row,
          netOverShort: roundCurrency(row.netOverShort),
        }))
        .sort((a, b) => a.siteName.localeCompare(b.siteName));

      // 5. Top |overShort| closures, capped by limit.
      const recentDiscrepancies = reviewClosures
        .map(row => ({
          sessionId: row.id,
          siteId: row.siteId,
          siteName: row.siteName,
          cashierName: row.cashierName,
          closedAt: row.closedAt ?? '',
          expectedBalance: row.expectedBalance,
          actualCount: row.actualCount ?? 0,
          overShort: row.overShort ?? 0,
        }))
        .sort((a, b) => Math.abs(b.overShort) - Math.abs(a.overShort))
        .slice(0, input.limit);

      return {
        summary,
        bySite,
        recentDiscrepancies,
      };
    }),
});

export type CashReportsRouter = typeof cashReportsRouter;

// Re-exported for tests so the assertion threshold tracks the source.
export const __TEST_CASH_OVER_SHORT_EPSILON = CASH_OVER_SHORT_EPSILON;
export const __TEST_RECENT_CLOSURE_WINDOW_DAYS = RECENT_CLOSURE_WINDOW_DAYS;
