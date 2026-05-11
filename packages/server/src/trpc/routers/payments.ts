/**
 * ENG-038 — `payments.*` tRPC namespace.
 *
 * Read-only Operations Center surface for LATAM software payment rails:
 *
 *   - `payments.getContract` exposes the stable rail manifest.
 *   - `payments.peekOutbox` tails `payment_outbox` for operator forensics.
 *   - `payments.reconciliation` returns a deterministic mismatch snapshot
 *     across local tenders and provider outbox rows.
 *
 * Real provider credential storage and worker-side rail calls remain in
 * follow-up ENG-038 slices; this router is intentionally manager/admin
 * read-only.
 *
 * @module trpc/routers/payments
 */

import { desc, eq } from 'drizzle-orm';
import { paymentOutbox } from '../../db/schema.js';
import {
  buildPaymentRailsContract,
  getPaymentReconciliation,
} from '../../services/payments/index.js';
import { router } from '../init.js';
import { managerOrAdminProcedure } from '../middleware/roles.js';
import { paymentReconciliationInput, peekPaymentOutboxInput } from '../schemas/payments.js';

export const paymentsRouter = router({
  getContract: managerOrAdminProcedure.query(() => {
    return buildPaymentRailsContract();
  }),

  peekOutbox: managerOrAdminProcedure
    .input(peekPaymentOutboxInput)
    .query(async ({ ctx, input }) => {
      const rows = await ctx.db
        .select({
          id: paymentOutbox.id,
          railId: paymentOutbox.railId,
          kind: paymentOutbox.kind,
          status: paymentOutbox.status,
          salePaymentId: paymentOutbox.salePaymentId,
          amount: paymentOutbox.amount,
          currencyCode: paymentOutbox.currencyCode,
          reference: paymentOutbox.reference,
          providerTransactionId: paymentOutbox.providerTransactionId,
          payloadVersion: paymentOutbox.payloadVersion,
          attempts: paymentOutbox.attempts,
          nextRetryAt: paymentOutbox.nextRetryAt,
          lastError: paymentOutbox.lastError,
          priority: paymentOutbox.priority,
          idempotencyKey: paymentOutbox.idempotencyKey,
          createdAt: paymentOutbox.createdAt,
          updatedAt: paymentOutbox.updatedAt,
        })
        .from(paymentOutbox)
        .where(eq(paymentOutbox.tenantId, ctx.tenantId))
        .orderBy(desc(paymentOutbox.priority), paymentOutbox.createdAt)
        .limit(input.limit)
        .all();
      return rows;
    }),

  reconciliation: managerOrAdminProcedure
    .input(paymentReconciliationInput)
    .query(async ({ ctx, input }) => {
      return getPaymentReconciliation(ctx.db, ctx.tenantId, input);
    }),
});

export type PaymentsRouter = typeof paymentsRouter;
