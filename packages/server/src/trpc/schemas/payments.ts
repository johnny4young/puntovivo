/**
 * Schemas for the `payments.*` Operations router and the
 * `paymentSettings.*` admin router (slice 2).
 *
 * @module trpc/schemas/payments
 */

import { z } from 'zod';

import { PAYMENT_RAIL_IDS } from '../../services/payments/manifest.js';

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

export const startWalletChargeInput = z
  .object({
    siteId: z.string().min(1).max(64),
    amount: z.number().positive().max(1_000_000_000),
  })
  .strict();

export const walletChargeInput = z
  .object({
    chargeId: z.string().min(1).max(64),
  })
  .strict();

// ── Static QR presentations (Fase 5) ────────────────────────────────────────
//
// The client supplies what the cashier chose and nothing else: tenant, actor
// and currency come from the session and the database.

export const startPresentationInput = z
  .object({
    siteId: z.string().min(1).max(64),
    destinationId: z.string().min(1).max(64),
    amount: z.number().positive().max(1_000_000_000),
    /** Stable per checkout attempt, so a re-render or offline retry reuses it. */
    idempotencyKey: z.string().min(1).max(128),
  })
  .strict();

export const presentationInput = z
  .object({
    presentationId: z.string().min(1).max(64),
  })
  .strict();

export const openPresentationsInput = z
  .object({
    siteId: z.string().min(1).max(64),
  })
  .strict();

export const linkPresentationInput = z
  .object({
    presentationId: z.string().min(1).max(64),
    siteId: z.string().min(1).max(64),
    amount: z.number().positive().max(1_000_000_000),
    saleId: z.string().min(1).max(64),
    salePaymentId: z.string().min(1).max(64).nullish(),
  })
  .strict();

export const closePresentationInput = z
  .object({
    presentationId: z.string().min(1).max(64),
    note: z.string().min(1).max(500),
  })
  .strict();

/** Pending transfer tenders, with the filters the reconciliation centre needs. */
export const pendingTransfersInput = z
  .object({
    siteId: z.string().min(1).max(64).optional(),
    status: z
      .enum(['pending', 'customer_reported', 'manual_confirmed', 'provider_confirmed', 'rejected', 'needs_reconciliation'])
      .optional(),
    from: z.string().min(1).max(40).optional(),
    to: z.string().min(1).max(40).optional(),
    limit: z.number().int().positive().max(200).default(100),
  })
  .strict();

/** Money the operator verified against the bank statement. */
export const registerManualDepositInput = z
  .object({
    siteId: z.string().min(1).max(64),
    saleId: z.string().min(1).max(64),
    salePaymentId: z.string().min(1).max(64),
    verifiedAmount: z.number().positive().max(1_000_000_000),
    reference: z.string().min(1).max(120).optional(),
    valueDate: z.string().min(1).max(40).optional(),
    note: z.string().min(1).max(500).optional(),
    idempotencyKey: z.string().min(1).max(128).optional(),
  })
  .strict();
