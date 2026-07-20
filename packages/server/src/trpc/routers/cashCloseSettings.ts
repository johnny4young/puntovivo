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
import {
  DEFAULT_CASH_CLOSE_SETTINGS,
  resolveCashCloseSettings,
  writeCashCloseSettings,
} from '../../services/cash-close-settings.js';

export const updateCashCloseSettingsInput = z.object({
  blindClose: z.boolean().optional(),
});

export const cashCloseSettingsRouter = router({
  get: managerOrAdminProcedure.query(async ({ ctx }) => {
    const settings = await resolveCashCloseSettings(ctx.db, ctx.tenantId);
    return {
      blindClose: settings.blindClose,
      defaults: DEFAULT_CASH_CLOSE_SETTINGS,
    };
  }),

  update: adminProcedure.input(updateCashCloseSettingsInput).mutation(async ({ ctx, input }) => {
    // Conditional spread so an absent optional truly omits the field
    // (exactOptionalPropertyTypes — same shape as restaurantSettings).
    const patch = input.blindClose !== undefined ? { blindClose: input.blindClose } : {};
    const settings = await writeCashCloseSettings(ctx.db, ctx.tenantId, patch);
    return { blindClose: settings.blindClose };
  }),
});

export type CashCloseSettingsRouter = typeof cashCloseSettingsRouter;
