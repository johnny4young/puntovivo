/**
 * ENG-038 — Schemas for the `payments.*` Operations router and the
 * `paymentSettings.*` admin router (slice 2).
 *
 * @module trpc/schemas/payments
 */

import { z } from 'zod';

import { PAYMENT_RAIL_IDS } from '../../services/payments/manifest.js';

export const peekPaymentOutboxInput = z.object({
  limit: z.number().int().positive().max(200).default(50),
});
export type PeekPaymentOutboxInput = z.infer<typeof peekPaymentOutboxInput>;

export const paymentReconciliationInput = z.object({
  limit: z.number().int().positive().max(200).default(50),
});
export type PaymentReconciliationInput = z.infer<typeof paymentReconciliationInput>;

/**
 * ENG-038 slice 2 — input for `paymentSettings.updateRail`. The
 * router-side handler narrows `credentials` against the rail's
 * declared descriptor (`CREDENTIAL_FIELDS_BY_RAIL`) before persisting,
 * so undeclared keys throw BAD_REQUEST.
 *
 * Empty-string values are accepted and clear the stored field; `null`
 * is equivalent for callers that prefer JSON-null semantics.
 */
const credentialValueSchema = z
  .union([z.string().max(2048), z.null()])
  .optional();

export const updatePaymentRailSettingsInput = z.object({
  railId: z.enum(PAYMENT_RAIL_IDS),
  credentials: z.record(z.string().min(1), credentialValueSchema),
});
export type UpdatePaymentRailSettingsInput = z.infer<
  typeof updatePaymentRailSettingsInput
>;
