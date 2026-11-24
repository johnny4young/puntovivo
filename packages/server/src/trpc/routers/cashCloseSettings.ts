/**
 * Tenant-level cash-close settings router.
 *
 * Reads + writes `tenants.settings.cashClose`. Current shape carries a
 * single field (`blindClose`); the namespace is intentionally a nested
 * object so future close-flow settings (recount policy, discrepancy
 * thresholds) can land here without re-shaping the client.
 *
 * - `.get` — managerOrAdmin (serves the admin settings card; the POS
 * modal reads the value from the `auth.me` session payload instead).
 * - `.update` — admin-only. Writes the partial patch back via
 * `writeCashCloseSettings`.
 *
 * @module trpc/routers/cashCloseSettings
 */
import { z } from 'zod';

import { router } from '../init.js';
import { adminProcedure, managerOrAdminProcedure } from '../middleware/roles.js';
import { isValidCashRoundingStep } from '../../lib/money.js';
import { writeAuditLog } from '../../services/audit-logs.js';
import {
  DEFAULT_CASH_CLOSE_SETTINGS,
  resolveCashCloseSettings,
  writeCashCloseSettings,
} from '../../services/cash-close-settings.js';

export const updateCashCloseSettingsInput = z.object({
  blindClose: z.boolean().optional(),
  cashRoundingStep: z
    .number()
    .int()
    .refine(value => isValidCashRoundingStep(value), 'Unsupported cash rounding step')
    .nullable()
    .optional(),
});

export const cashCloseSettingsRouter = router({
  get: managerOrAdminProcedure.query(async ({ ctx }) => {
    const settings = await resolveCashCloseSettings(ctx.db, ctx.tenantId);
    return {
      blindClose: settings.blindClose,
      cashRoundingStep: settings.cashRoundingStep,
      defaults: DEFAULT_CASH_CLOSE_SETTINGS,
    };
  }),

  update: adminProcedure.input(updateCashCloseSettingsInput).mutation(async ({ ctx, input }) => {
    const patch = {
      ...(input.blindClose !== undefined ? { blindClose: input.blindClose } : {}),
      ...(input.cashRoundingStep !== undefined ? { cashRoundingStep: input.cashRoundingStep } : {}),
    };
    const before = await resolveCashCloseSettings(ctx.db, ctx.tenantId);
    const settings = await writeCashCloseSettings(ctx.db, ctx.tenantId, patch);
    if (
      before.blindClose !== settings.blindClose ||
      before.cashRoundingStep !== settings.cashRoundingStep
    ) {
      ctx.db.transaction(tx => {
        writeAuditLog({
          tx,
          tenantId: ctx.tenantId,
          actorId: ctx.user!.id,
          action: 'cash_close.settings.update',
          resourceType: 'tenant',
          resourceId: ctx.tenantId,
          before: { ...before },
          after: { ...settings },
        });
      });
    }
    return {
      blindClose: settings.blindClose,
      cashRoundingStep: settings.cashRoundingStep,
    };
  }),
});

export type CashCloseSettingsRouter = typeof cashCloseSettingsRouter;
