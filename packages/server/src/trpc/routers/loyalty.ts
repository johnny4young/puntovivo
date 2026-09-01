/**
 * loyalty router ( minimum viable).
 *
 * - `.forCustomer` — tenant-wide read: the cashier needs the balance to
 * tell the customer what they have, so it is NOT manager-gated. The
 * payload is points + ledger, no cost or margin data.
 * - `.settings` / `.updateSettings` — managerOrAdmin read, admin write:
 * the accrual rate is a point-liability decision, i.e. owner territory.
 * - `.adjust` — admin-only manual correction, always with a note (the row
 * is the audit trail; an unexplained balance change is a support ticket
 * waiting to happen).
 *
 * Accrual itself has no procedure: it happens inside the sale transaction
 * (`application/sales/runFreshSale`), never as a separate client call.
 *
 * @module trpc/routers/loyalty
 */
import { z } from 'zod';

import { router } from '../init.js';
import { tenantProcedure } from '../middleware/tenant.js';
import { adminProcedure, managerOrAdminProcedure } from '../middleware/roles.js';
import {
  DEFAULT_LOYALTY_SETTINGS,
  MAX_POINTS_PER_UNIT,
  MAX_VALUE_PER_POINT,
  adjustPoints,
  getLoyaltyForCustomer,
  resolveLoyaltySettings,
  writeLoyaltySettings,
} from '../../services/loyalty.js';
import { resolveTenantCurrency } from '../../lib/currency.js';
import { getStoreCreditForCustomer } from '../../services/store-credit.js';

export const loyaltyForCustomerInput = z.object({
  customerId: z.string().min(1, 'Customer id is required'),
  limit: z.number().int().min(1).max(50).default(20),
});

export const updateLoyaltySettingsInput = z.object({
  enabled: z.boolean().optional(),
  pointsPerUnit: z.number().positive().max(MAX_POINTS_PER_UNIT).optional(),
  redemptionEnabled: z.boolean().optional(),
  valuePerPoint: z.number().positive().max(MAX_VALUE_PER_POINT).optional(),
});

export const adjustLoyaltyInput = z.object({
  customerId: z.string().min(1, 'Customer id is required'),
  /** Signed, non-zero: the sign IS the intent (grant vs claw back). */
  points: z
    .number()
    .int()
    .refine(value => value !== 0, 'The adjustment cannot be zero'),
  note: z.string().trim().min(3, 'Explain the adjustment').max(240),
});

export const loyaltyRouter = router({
  forCustomer: tenantProcedure.input(loyaltyForCustomerInput).query(async ({ ctx, input }) => {
    const currencyCode = await resolveTenantCurrency(ctx.db, ctx.tenantId);
    const [loyalty, storeCredit, settings] = await Promise.all([
      getLoyaltyForCustomer(ctx.db, {
        tenantId: ctx.tenantId,
        customerId: input.customerId,
        limit: input.limit,
      }),
      getStoreCreditForCustomer(ctx.db, {
        tenantId: ctx.tenantId,
        customerId: input.customerId,
        currencyCode,
        limit: input.limit,
      }),
      resolveLoyaltySettings(ctx.db, ctx.tenantId),
    ]);
    // Cashiers need only the effective redemption contract to price a
    // points tender. Keep the accrual rate and the rest of the owner-facing
    // settings behind `.settings`; exposing this two-field projection avoids
    // either trusting renderer configuration or granting manager access.
    return {
      ...loyalty,
      storeCredit,
      redemption: {
        // This is the effective checkout capability, not the raw owner
        // toggle. The sale transaction requires both program accrual and
        // redemption to be enabled, so the cashier projection must match.
        enabled: settings.enabled && settings.redemptionEnabled,
        valuePerPoint: settings.valuePerPoint,
      },
    };
  }),

  settings: managerOrAdminProcedure.query(async ({ ctx }) => {
    const settings = await resolveLoyaltySettings(ctx.db, ctx.tenantId);
    return { ...settings, defaults: DEFAULT_LOYALTY_SETTINGS };
  }),

  updateSettings: adminProcedure
    .input(updateLoyaltySettingsInput)
    .mutation(async ({ ctx, input }) => {
      // Conditional spread so an absent optional truly omits the field
      // (exactOptionalPropertyTypes — same shape as cashCloseSettings).
      const patch = {
        ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
        ...(input.pointsPerUnit !== undefined ? { pointsPerUnit: input.pointsPerUnit } : {}),
        ...(input.redemptionEnabled !== undefined
          ? { redemptionEnabled: input.redemptionEnabled }
          : {}),
        ...(input.valuePerPoint !== undefined ? { valuePerPoint: input.valuePerPoint } : {}),
      };
      return writeLoyaltySettings(ctx.db, ctx.tenantId, patch);
    }),

  adjust: adminProcedure.input(adjustLoyaltyInput).mutation(async ({ ctx, input }) =>
    adjustPoints(ctx.db, {
      tenantId: ctx.tenantId,
      customerId: input.customerId,
      actorId: ctx.user!.id,
      points: input.points,
      note: input.note,
    })
  ),
});

export type LoyaltyRouter = typeof loyaltyRouter;
