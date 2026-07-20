/**
 * Sales tRPC Router
 *
 * Sales management with transactional creation.
 *
 * Procedures:
 * - sales.list       (tenant) - List sales with pagination/filtering
 * - sales.getById    (tenant) - Get a single sale with items
 * - sales.create     (tenant) - Create sale + items + inventory movements (transaction)
 * - sales.update     (tenant, manager/admin) - Update payment method/status/notes
 * - sales.returnSale (sales role; cashier grant) - Refund and restore stock
 * - sales.void       (sales role; manager/cashier grant) - Void a sale
 *
 * this barrel preserves the public surface of the former flat
 * `trpc/routers/sales.ts` (1479 LOC), decomposed into per-concern procedure
 * modules during the megafile wave. The procedure bodies moved verbatim;
 * only the file layout changed. The procedure paths (`sales.create`, etc.)
 * and `AppRouter`'s inferred shape are unchanged, so the web client and the
 * caller-based tests are unaffected.
 *
 * /  — sale lifecycle orchestration lives in
 * `application/sales/`. The router keeps the lightweight reads
 * (summary, list, getById, listDrafts) and the suspend / resume /
 * changeTable / splitDraft / getForReprint procedures inline; the rest
 * are thin wrappers around the application services.
 *
 * @module trpc/routers/sales
 */
import { router } from '../../init.js';
import { salesQueryProcedures } from './queries.js';
import { salesLifecycleProcedures } from './lifecycle.js';
import { salesDraftProcedures } from './drafts.js';
import { salesSplitDraftProcedures } from './splitDraft.js';

export const salesRouter = router({
  ...salesQueryProcedures,
  ...salesLifecycleProcedures,
  ...salesDraftProcedures,
  ...salesSplitDraftProcedures,
});
