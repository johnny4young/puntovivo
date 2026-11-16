/**
 * Schemas for the `payments.*` Operations router and the
 * `paymentSettings.*` admin router (slice 2).
 *
 * @module trpc/schemas/payments
 */

import { z } from 'zod';

import { PAYMENT_RAIL_IDS } from '../../services/payments/manifest.js';
import {
  TRANSFER_HANDLE_KINDS,
  TRANSFER_HANDLE_VALUE_MAX,
  TRANSFER_HANDLES_MAX,
  TRANSFER_QR_PAYLOAD_MAX,
} from '../../services/payments/transfer-handles.js';

export const peekPaymentOutboxInput = z
  .object({
    limit: z.number().int().positive().max(200).default(50),
  })
  .strict();
export type PeekPaymentOutboxInput = z.infer<typeof peekPaymentOutboxInput>;

export const paymentReconciliationInput = z
  .object({
    limit: z.number().int().positive().max(200).default(50),
  })
  .strict();
export type PaymentReconciliationInput = z.infer<typeof paymentReconciliationInput>;

/**
 * slice 2 — input for `paymentSettings.updateRail`. The
 * router-side handler narrows `credentials` against the rail's
 * declared descriptor (`CREDENTIAL_FIELDS_BY_RAIL`) before persisting,
 * so undeclared keys throw BAD_REQUEST.
 *
 * Empty-string values are accepted and clear the stored field; `null`
 * is equivalent for callers that prefer JSON-null semantics.
 */
const credentialValueSchema = z.union([z.string().max(2048), z.null()]).optional();

export const updatePaymentRailSettingsInput = z
  .object({
    railId: z.enum(PAYMENT_RAIL_IDS),
    credentials: z.record(z.string().min(1), credentialValueSchema),
  })
  .strict();
export type UpdatePaymentRailSettingsInput = z.infer<typeof updatePaymentRailSettingsInput>;

/** Transfer handles shown at checkout. An empty list clears the configuration. */
export const updateTransferHandlesInput = z
  .object({
    handles: z
      .array(
        z
          .object({
            kind: z.enum(TRANSFER_HANDLE_KINDS),
            value: z.string().trim().min(1).max(TRANSFER_HANDLE_VALUE_MAX),
          })
          .strict()
      )
      .max(TRANSFER_HANDLES_MAX),
    qrPayload: z.string().trim().max(TRANSFER_QR_PAYLOAD_MAX).nullable().optional(),
  })
  .strict();
export type UpdateTransferHandlesInput = z.infer<typeof updateTransferHandlesInput>;

/**
 * input for admin `payments.retryOutbox`. The row id is
 * narrowed at the procedure boundary by a tenant-scoped lookup; the
 * Zod-level `nanoid` shape just rejects empty strings.
 */
export const retryPaymentOutboxInput = z
  .object({
    outboxId: z.string().min(1).max(64),
  })
  .strict();
export type RetryPaymentOutboxInput = z.infer<typeof retryPaymentOutboxInput>;

/**
 * input for admin `payments.markSettled`. The optional
 * `providerTransactionId` lets the operator paste a provider-portal
 * value at override time; an empty string is normalised to omitted
 * (no update on the column).
 */
export const markPaymentOutboxSettledInput = z
  .object({
    outboxId: z.string().min(1).max(64),
    providerTransactionId: z
      .string()
      .trim()
      .max(256)
      .transform(value => (value.length === 0 ? undefined : value))
      .optional(),
  })
  .strict();
export type MarkPaymentOutboxSettledInput = z.infer<typeof markPaymentOutboxSettledInput>;

/**
 * input for `payments.methodBreakdown`. `windowDays` bounds
 * the aggregation window (defaults to 7 days; max 90 to keep the query
 * lightweight). The router groups by `(rail_id, status)` so the panel
 * renders one row per bucket.
 */
export const paymentMethodBreakdownInput = z
  .object({
    windowDays: z.number().int().min(1).max(90).default(7),
  })
  .strict();
export type PaymentMethodBreakdownInput = z.infer<typeof paymentMethodBreakdownInput>;

/** Bounded operations-panel query; review status is optional for audit history. */
export const listPaymentProposalsInput = z
  .object({
    limit: z.number().int().positive().max(200).default(50),
    status: z.enum(['pending', 'approved', 'rejected']).optional(),
  })
  .strict();

/** The server, not the client, supplies every statement and tender value. */
export const reviewPaymentProposalInput = z
  .object({
    proposalId: z.string().min(1).max(64),
    decision: z.enum(['approve', 'reject']),
  })
  .strict();
