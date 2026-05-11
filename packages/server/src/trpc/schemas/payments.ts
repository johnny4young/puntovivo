/**
 * ENG-038 — Schemas for the `payments.*` Operations router.
 *
 * @module trpc/schemas/payments
 */

import { z } from 'zod';

export const peekPaymentOutboxInput = z.object({
  limit: z.number().int().positive().max(200).default(50),
});
export type PeekPaymentOutboxInput = z.infer<typeof peekPaymentOutboxInput>;

export const paymentReconciliationInput = z.object({
  limit: z.number().int().positive().max(200).default(50),
});
export type PaymentReconciliationInput = z.infer<typeof paymentReconciliationInput>;
