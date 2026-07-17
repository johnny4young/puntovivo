/**
 * ENG-213 — loyalty router (WC-D2 minimum viable).
 *
 * - `.forCustomer` — tenant-wide read: the cashier needs the balance to
 *   tell the customer what they have, so it is NOT manager-gated. The
 *   payload is points + ledger, no cost or margin data.
 * - `.settings` / `.updateSettings` — managerOrAdmin read, admin write:
 *   the accrual rate is a point-liability decision, i.e. owner territory.
 * - `.adjust` — admin-only manual correction, always with a note (the row
 *   is the audit trail; an unexplained balance change is a support ticket
 *   waiting to happen).
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
  adjustPoints,
  getLoyaltyForCustomer,
  resolveLoyaltySettings,
  writeLoyaltySettings,
} from '../../services/loyalty.js';

export const loyaltyForCustomerInput = z.object({
  customerId: z.string().min(1, 'Customer id is required'),
  limit: z.number().int().min(1).max(50).default(20),
});

export const updateLoyaltySettingsInput = z.object({
  enabled: z.boolean().optional(),
  pointsPerUnit: z.number().positive().max(MAX_POINTS_PER_UNIT).optional(),
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
  forCustomer: tenantProcedure.input(loyaltyForCustomerInput).query(async ({ ctx, input }) =>
    getLoyaltyForCustomer(ctx.db, {
      tenantId: ctx.tenantId,
      customerId: input.customerId,
      limit: input.limit,
    })
  ),

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
