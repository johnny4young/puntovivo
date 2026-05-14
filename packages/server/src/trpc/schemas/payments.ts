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

/**
 * ENG-065d — input for admin `payments.retryOutbox`. The row id is
 * narrowed at the procedure boundary by a tenant-scoped lookup; the
 * Zod-level `nanoid` shape just rejects empty strings.
 */
export const retryPaymentOutboxInput = z.object({
  outboxId: z.string().min(1).max(64),
});
export type RetryPaymentOutboxInput = z.infer<typeof retryPaymentOutboxInput>;

/**
 * ENG-065d — input for admin `payments.markSettled`. The optional
 * `providerTransactionId` lets the operator paste a provider-portal
 * value at override time; an empty string is normalised to omitted
 * (no update on the column).
 */
export const markPaymentOutboxSettledInput = z.object({
  outboxId: z.string().min(1).max(64),
  providerTransactionId: z
    .string()
    .trim()
    .max(256)
    .transform(value => (value.length === 0 ? undefined : value))
    .optional(),
});
export type MarkPaymentOutboxSettledInput = z.infer<
  typeof markPaymentOutboxSettledInput
>;

/**
 * ENG-065d — input for `payments.methodBreakdown`. `windowDays` bounds
 * the aggregation window (defaults to 7 days; max 90 to keep the query
 * lightweight). The router groups by `(rail_id, status)` so the panel
 * renders one row per bucket.
 */
export const paymentMethodBreakdownInput = z.object({
  windowDays: z.number().int().min(1).max(90).default(7),
});
export type PaymentMethodBreakdownInput = z.infer<
  typeof paymentMethodBreakdownInput
>;
