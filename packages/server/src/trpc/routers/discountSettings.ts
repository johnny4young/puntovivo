/**
 * Tenant-level discount settings router.
 *
 * Reads + writes `tenants.settings.discount`. Current shape carries the
 * expiry-radar tier ladder; the namespace is a nested object so future
 * pricing knobs (max manual discount, clearance rules) land here without
 * re-shaping the client.
 *
 * - `.get` — managerOrAdmin (serves the admin settings card; the radar
 * panel reads the ladder from the `auth.me` session payload instead,
 * same as the  blind-close flag).
 * - `.update` — admin-only: pricing policy is owner territory.
 *
 * @module trpc/routers/discountSettings
 */
import { z } from 'zod';

import { router } from '../init.js';
import { adminProcedure, managerOrAdminProcedure } from '../middleware/roles.js';
import {
  DEFAULT_DISCOUNT_SETTINGS,
  MAX_TIERS,
  TIER_MAX_DAYS_LIMIT,
  resolveDiscountSettings,
  writeDiscountSettings,
} from '../../services/discount-settings.js';

/** One tier row. Bounds mirror `services/discount-settings` normalization. */
const expiryTierInput = z.object({
  maxDays: z.number().int().min(1).max(TIER_MAX_DAYS_LIMIT),
  pct: z.number().int().min(1).max(99),
});

export const updateDiscountSettingsInput = z.object({
  /** Full replacement of the ladder (not a per-tier patch): the rule is
   * order-dependent, so partial edits would be ambiguous. An empty array is
   * rejected here — clearing the ladder is done by omitting the field, which
   * leaves the current value untouched. */
  expiryTiers: z.array(expiryTierInput).min(1).max(MAX_TIERS).optional(),
});

export const discountSettingsRouter = router({
  get: managerOrAdminProcedure.query(async ({ ctx }) => {
    const settings = await resolveDiscountSettings(ctx.db, ctx.tenantId);
    return {
      expiryTiers: settings.expiryTiers,
      defaults: DEFAULT_DISCOUNT_SETTINGS,
    };
  }),

  update: adminProcedure.input(updateDiscountSettingsInput).mutation(async ({ ctx, input }) => {
    // Conditional spread so an absent optional truly omits the field
    // (exactOptionalPropertyTypes — same shape as cashCloseSettings).
    const patch = input.expiryTiers !== undefined ? { expiryTiers: input.expiryTiers } : {};
    const settings = await writeDiscountSettings(ctx.db, ctx.tenantId, patch);
    return { expiryTiers: settings.expiryTiers };
  }),
});

export type DiscountSettingsRouter = typeof discountSettingsRouter;
