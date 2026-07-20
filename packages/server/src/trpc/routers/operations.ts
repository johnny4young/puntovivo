/**
 * Operations router.
 *
 * Backs the Operations "Needs attention" landing: one tenant-scoped,
 * read-only aggregation of the retryable outbox / sync failures so the
 * page can highlight what failed (and where to fix it) before the flat
 * per-surface tabs.
 *
 * @module trpc/routers/operations
 */
import { computeNeedsAttention } from '../../services/operations/attention.js';
import { router } from '../init.js';
import { managerOrAdminProcedure } from '../middleware/roles.js';
import { operationsNeedsAttentionOutputSchema } from '../schemas/operations.js';

export const operationsRouter = router({
  /**
   * Aggregate the retryable-failure counts (sync conflicts / backlog,
   * fiscal-document rejections, hardware-print failures, payment
   * failures) for the active tenant. Cheap (a handful of indexed
   * COUNT(*)); read-only and emits no audit row. Manager / admin only
   * (the Operations surface is itself gated to those roles).
   */
  needsAttention: managerOrAdminProcedure
    .output(operationsNeedsAttentionOutputSchema)
    .query(async ({ ctx }) => {
      return computeNeedsAttention(ctx.db, ctx.tenantId);
    }),
});

export type OperationsRouter = typeof operationsRouter;
