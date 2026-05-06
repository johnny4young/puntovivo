/**
 * ENG-020 / ENG-065b — Reports namespace (`reports.*`) aggregator.
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
 *
 * @module trpc/routers/reports
 */

import { router } from '../../init.js';
import { cashReportsRouter } from './cash.js';
import { fiscalReportsRouter } from './fiscal.js';
import { inventoryReportsRouter } from './inventory.js';

export const reportsRouter = router({
  cash: cashReportsRouter,
  fiscal: fiscalReportsRouter,
  inventory: inventoryReportsRouter,
});

export type ReportsRouter = typeof reportsRouter;
