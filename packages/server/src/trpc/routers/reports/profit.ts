/**
 * ENG-190 — Profit / margin reports sub-router (`reports.profit.*`).
 *
 * Read-only gross-margin surface for the admin Profitability page. COGS is
 * sourced from the per-lot ledger (`sale_item_lots`) for lot-tracked lines and
 * the `cost_at_sale` snapshot otherwise — see
 * `services/reports/profit-margin.ts` for the correctness invariants.
 *
 * Manager + admin gated (consistent with the cash / inventory / fiscal report
 * procedures); the web surface is admin-only via the finance workspace.
 *
 * @module trpc/routers/reports/profit
 */

import { router } from '../../init.js';
import { managerOrAdminProcedure } from '../../middleware/roles.js';
import { profitMarginInput } from '../../schemas/reports.js';
import { computeProfitMarginReport } from '../../../services/reports/profit-margin.js';

export const profitReportsRouter = router({
  /**
   * Realized gross margin over a date range: a range-wide summary
   * (revenue / COGS / gross profit / margin %, plus the lot-vs-snapshot COGS
   * split) and a per-product breakdown ordered by gross profit descending.
   */
  margin: managerOrAdminProcedure.input(profitMarginInput).query(({ ctx, input }) =>
    computeProfitMarginReport(ctx.db, {
      tenantId: ctx.tenantId,
      fromDate: input.fromDate,
      toDate: input.toDate,
      limit: input.limit,
    })
  ),
});

export type ProfitReportsRouter = typeof profitReportsRouter;
