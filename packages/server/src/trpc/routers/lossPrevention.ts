import { router } from '../init.js';
import { criticalCommandAdminProcedure } from '../middleware/criticalCommand.js';
import { adminProcedure, cashierManagerOrAdminProcedure } from '../middleware/roles.js';
import { asCriticalCommandContext } from '../middleware/commandEnvelope.js';
import {
  evaluateCheckoutLossPreventionInput,
  updateLossPreventionSettingsInput,
} from '../schemas/lossPrevention.js';
import {
  evaluateCheckoutLossPrevention,
  resolveLossPreventionSettings,
  writeLossPreventionSettings,
} from '../../services/loss-prevention/index.js';
import { writeAuditLog } from '../../services/audit-logs.js';

export const lossPreventionRouter = router({
  getSettings: adminProcedure.query(({ ctx }) =>
    resolveLossPreventionSettings(ctx.db, ctx.tenantId)
  ),

  evaluateCheckout: cashierManagerOrAdminProcedure
    .input(evaluateCheckoutLossPreventionInput)
    .query(({ ctx, input }) =>
      evaluateCheckoutLossPrevention({
        db: ctx.db,
        tenantId: ctx.tenantId,
        role: ctx.user!.role,
        isCompletion: true,
        items: input.items,
        discountAmount: input.discountAmount,
      })
    ),

  updateSettings: criticalCommandAdminProcedure
    .input(updateLossPreventionSettingsInput)
    .mutation(({ ctx, input }) => {
      const criticalCtx = asCriticalCommandContext(ctx);
      return criticalCtx.db.transaction(tx => {
        const before = resolveLossPreventionSettings(tx, criticalCtx.tenantId);
        const after = writeLossPreventionSettings(tx, criticalCtx.tenantId, {
          version: 1,
          roles: input.roles,
        });
        writeAuditLog({
          tx,
          tenantId: criticalCtx.tenantId,
          actorId: criticalCtx.user.id,
          action: 'loss_prevention.settings.updated',
          resourceType: 'loss_prevention_rule',
          resourceId: criticalCtx.tenantId,
          before: { ...before },
          after: { ...after },
          operationId: criticalCtx.envelope.operationId,
        });
        return after;
      });
    }),
});
