/**
 * Tenant-level restaurant settings router.
 *
 * Reads + writes `tenants.settings.restaurant`. Current shape carries a
 * single field (`serviceChargeRate`); the namespace is intentionally a
 * nested object so future restaurant settings (course timing, table
 * preferences, KDS toggles) can land here without re-shaping the
 * client.
 *
 * - `.get` — managerOrAdmin (the cashier needs the rate at checkout
 * time, but the AuthProvider session already carries it; this
 * endpoint serves the admin / settings page instead).
 * - `.update` — admin-only. Writes the partial patch back via
 * `writeRestaurantSettings`.
 *
 * @module trpc/routers/restaurantSettings
 */
import { z } from 'zod';

import { router } from '../init.js';
import { adminProcedure, managerOrAdminProcedure } from '../middleware/roles.js';
import {
  DEFAULT_RESTAURANT_SETTINGS,
  resolveRestaurantSettings,
  SERVICE_CHARGE_RATE_MAX,
  writeRestaurantSettings,
} from '../../services/restaurant/settings.js';

export const updateRestaurantSettingsInput = z.object({
  serviceChargeRate: z
    .number()
    .min(0, 'serviceChargeRate must be non-negative')
    .max(SERVICE_CHARGE_RATE_MAX, `serviceChargeRate cannot exceed ${SERVICE_CHARGE_RATE_MAX}%`)
    .optional(),
});

export const restaurantSettingsRouter = router({
  get: managerOrAdminProcedure.query(async ({ ctx }) => {
    const settings = await resolveRestaurantSettings(ctx.db, ctx.tenantId);
    return {
      serviceChargeRate: settings.serviceChargeRate,
      defaults: DEFAULT_RESTAURANT_SETTINGS,
      maxRate: SERVICE_CHARGE_RATE_MAX,
    };
  }),

  update: adminProcedure.input(updateRestaurantSettingsInput).mutation(async ({ ctx, input }) => {
    // `input.serviceChargeRate` may be `undefined` under
    // Zod's optional; `exactOptionalPropertyTypes` rejects spreading
    // an explicit-undefined field into `Partial<RestaurantSettings>`.
    // Build the patch with a conditional spread so absent input
    // truly omits the field.
    const patch =
      input.serviceChargeRate !== undefined ? { serviceChargeRate: input.serviceChargeRate } : {};
    const next = await writeRestaurantSettings(ctx.db, ctx.tenantId, patch);
    return { serviceChargeRate: next.serviceChargeRate };
  }),
});
