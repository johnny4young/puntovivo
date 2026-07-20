/**
 * Peripherals tRPC Router ().
 *
 * decomposed into per-concern record modules (queries / crud /
 * actions) + a helpers.ts leaf. This barrel re-assembles the flat router so
 * every path (`peripherals.list` … `peripherals.retryHardwareOutbox`) is
 * preserved.
 *
 * @module trpc/routers/peripherals
 */
import { router } from '../../init.js';
import { peripheralsQueryProcedures } from './queries.js';
import { peripheralsCrudProcedures } from './crud.js';
import { peripheralsActionProcedures } from './actions.js';

export const peripheralsRouter = router({
  ...peripheralsQueryProcedures,
  ...peripheralsCrudProcedures,
  ...peripheralsActionProcedures,
});

export type PeripheralsRouter = typeof peripheralsRouter;
