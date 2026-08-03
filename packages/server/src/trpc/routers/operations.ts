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
import {
  acknowledgeOperationalAlert,
  listOperationalAlertsOverview,
  retryOperationalAlertDelivery,
} from '../../services/operations/alerts.js';
import { TRPCError } from '@trpc/server';
import { router } from '../init.js';
import { adminProcedure, managerOrAdminProcedure } from '../middleware/roles.js';
import {
  acknowledgeOperationalAlertOutputSchema,
  operationalAlertDeliveryIdInputSchema,
  operationalAlertIdInputSchema,
  operationalAlertsOverviewOutputSchema,
  operationsNeedsAttentionOutputSchema,
  retryOperationalAlertDeliveryOutputSchema,
} from '../schemas/operations.js';

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

  alertsOverview: managerOrAdminProcedure
    .output(operationalAlertsOverviewOutputSchema)
    .query(({ ctx }) => listOperationalAlertsOverview(ctx.db, ctx.tenantId)),

  acknowledgeAlert: managerOrAdminProcedure
    .input(operationalAlertIdInputSchema)
    .output(acknowledgeOperationalAlertOutputSchema)
    .mutation(({ ctx, input }) => {
      try {
        return acknowledgeOperationalAlert(ctx.db, {
          tenantId: ctx.tenantId,
          userId: ctx.user!.id,
          alertId: input.alertId,
        });
      } catch (error) {
        throw operationalAlertError(error);
      }
    }),

  retryAlertDelivery: adminProcedure
    .input(operationalAlertDeliveryIdInputSchema)
    .output(retryOperationalAlertDeliveryOutputSchema)
    .mutation(({ ctx, input }) => {
      try {
        return retryOperationalAlertDelivery(ctx.db, {
          tenantId: ctx.tenantId,
          userId: ctx.user!.id,
          deliveryId: input.deliveryId,
        });
      } catch (error) {
        throw operationalAlertError(error);
      }
    }),
});

function operationalAlertError(error: unknown): TRPCError {
  const message = error instanceof Error ? error.message : 'OPERATIONAL_ALERT_FAILED';
  if (message.endsWith('_NOT_FOUND')) {
    return new TRPCError({ code: 'NOT_FOUND', message });
  }
  if (
    message.endsWith('_RESOLVED') ||
    message.endsWith('_NOT_DEAD_LETTER') ||
    message.endsWith('_CHANGED')
  ) {
    return new TRPCError({ code: 'CONFLICT', message });
  }
  return new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'OPERATIONAL_ALERT_FAILED' });
}

export type OperationsRouter = typeof operationsRouter;
