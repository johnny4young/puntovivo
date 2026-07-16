import { and, eq } from 'drizzle-orm';
import { router } from '../init.js';
import {
  criticalCommandAdminProcedure,
  criticalCommandManagerOrAdminProcedure,
} from '../middleware/criticalCommand.js';
import {
  adminProcedure,
  cashierManagerOrAdminProcedure,
  managerOrAdminProcedure,
} from '../middleware/roles.js';
import { asCriticalCommandContext } from '../middleware/commandEnvelope.js';
import { ensureTenantSite } from '../middleware/tenantSite.js';
import {
  evaluateCheckoutLossPreventionInput,
  evaluateShiftActionLossPreventionInput,
  acknowledgeLossPreventionAlertInput,
  listLossPreventionAlertsInput,
  updateLossPreventionSettingsInput,
} from '../schemas/lossPrevention.js';
import {
  acknowledgeLossPreventionAlert,
  evaluateCheckoutLossPrevention,
  evaluateShiftLossPrevention,
  listLossPreventionAlerts,
  resolveLossPreventionSettings,
  writeLossPreventionSettings,
} from '../../services/loss-prevention/index.js';
import { writeAuditLog } from '../../services/audit-logs.js';
import { sales } from '../../db/schema.js';
import { throwServerError } from '../../lib/errorCodes.js';

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

  evaluateShiftAction: cashierManagerOrAdminProcedure
    .input(evaluateShiftActionLossPreventionInput)
    .query(async ({ ctx, input }) => {
      if (input.action === 'cash_drawer_open') {
        await ensureTenantSite(ctx.db, ctx.tenantId, input.siteId);
        return evaluateShiftLossPrevention({
          db: ctx.db,
          tenantId: ctx.tenantId,
          siteId: input.siteId,
          actorId: ctx.user!.id,
          role: ctx.user!.role,
          action: input.action,
        });
      }

      const sale = await ctx.db
        .select({ id: sales.id, total: sales.total })
        .from(sales)
        .where(and(eq(sales.id, input.saleId), eq(sales.tenantId, ctx.tenantId)))
        .get();
      if (!sale) {
        throwServerError({
          trpcCode: 'NOT_FOUND',
          errorCode: 'SALE_NOT_FOUND',
          message: 'Sale not found',
        });
      }
      if (!ctx.siteId) {
        throwServerError({
          trpcCode: 'BAD_REQUEST',
          errorCode: 'CASH_SESSION_SITE_REQUIRED',
          message: 'An active site is required to evaluate shift controls',
        });
      }
      return evaluateShiftLossPrevention({
        db: ctx.db,
        tenantId: ctx.tenantId,
        siteId: ctx.siteId,
        actorId: ctx.user!.id,
        role: ctx.user!.role,
        action: input.action,
        amount: sale.total,
      });
    }),

  listAlerts: managerOrAdminProcedure
    .input(listLossPreventionAlertsInput)
    .query(async ({ ctx, input }) => {
      await ensureTenantSite(ctx.db, ctx.tenantId, input.siteId);
      return listLossPreventionAlerts({
        db: ctx.db,
        tenantId: ctx.tenantId,
        siteId: input.siteId,
        limit: input.limit,
      });
    }),

  acknowledgeAlert: criticalCommandManagerOrAdminProcedure
    .input(acknowledgeLossPreventionAlertInput)
    .mutation(async ({ ctx, input }) => {
      const criticalCtx = asCriticalCommandContext(ctx);
      await ensureTenantSite(criticalCtx.db, criticalCtx.tenantId, input.siteId);
      return acknowledgeLossPreventionAlert({
        db: criticalCtx.db,
        tenantId: criticalCtx.tenantId,
        siteId: input.siteId,
        alertId: input.alertId,
        actorId: criticalCtx.user.id,
        operationId: criticalCtx.envelope.operationId,
      });
    }),

  updateSettings: criticalCommandAdminProcedure
    .input(updateLossPreventionSettingsInput)
    .mutation(({ ctx, input }) => {
      const criticalCtx = asCriticalCommandContext(ctx);
      return criticalCtx.db.transaction(tx => {
        const before = resolveLossPreventionSettings(tx, criticalCtx.tenantId);
        const after = writeLossPreventionSettings(tx, criticalCtx.tenantId, {
          version: 4,
          roles: input.roles,
          alerts: input.alerts ?? before.alerts,
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
