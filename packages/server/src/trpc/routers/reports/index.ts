/**
 * ENG-020 / ENG-065b / ENG-065c — Reports namespace (`reports.*`) aggregator.
 *
 * Holds read-only aggregate surfaces that are NOT tied to a single
 * resource router. Sub-routers shipped so far:
 *   - `reports.fiscal.*` (ENG-020 + ENG-065a) — fiscal documents list
 *     + retry mutation, used by the Fiscal Documents page and the
 *     Operations Center Fiscal Health tab.
 *   - `reports.cash.*` (ENG-065b) — tenant-wide cash reconciliation
 *     for the Operations Center Cash tab.
 *   - `reports.inventory.*` (ENG-065b) — per-product cache-vs-cache
 *     discrepancy scan for the Operations Center Inventory tab.
 *   - `reports.diagnostics.*` (ENG-065c) — admin-only bulk export of
 *     `operation_events` + outboxes for support tickets, surfaced as
 *     the Operations Center Diagnostics tab.
 *   - `reports.profit.*` (ENG-190) — realized margin / COGS report over
 *     the `sale_item_lots` ledger, surfaced as the admin Profitability
 *     page.
 *
 * @module trpc/routers/reports
 */

import { router } from '../../init.js';
import { cashReportsRouter } from './cash.js';
import { diagnosticsReportsRouter } from './diagnostics/index.js';
import { fiscalReportsRouter } from './fiscal.js';
import { inventoryReportsRouter } from './inventory.js';
import { profitReportsRouter } from './profit.js';

export const reportsRouter = router({
  cash: cashReportsRouter,
  diagnostics: diagnosticsReportsRouter,
  fiscal: fiscalReportsRouter,
  inventory: inventoryReportsRouter,
  profit: profitReportsRouter,
});

export type ReportsRouter = typeof reportsRouter;
