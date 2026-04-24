/**
 * ENG-020 — Reports namespace (`reports.*`) aggregator.
 *
 * Holds read-only aggregate surfaces that are NOT tied to a single
 * resource router. First sub-router is `reports.fiscal.*`
 * (ENG-020 Fase A). ENG-021+ adds `reports.dian`, `reports.taxes`,
 * `reports.payments`, etc.
 *
 * @module trpc/routers/reports
 */

import { router } from '../../init.js';
import { fiscalReportsRouter } from './fiscal.js';

export const reportsRouter = router({
  fiscal: fiscalReportsRouter,
});

export type ReportsRouter = typeof reportsRouter;
