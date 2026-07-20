/**
 * +  — `payments.*` tRPC namespace.
 *
 * Operations Center surface for LATAM software payment rails:
 *
 * - `payments.getContract` exposes the stable rail manifest.
 * - `payments.peekOutbox` tails `payment_outbox` for operator forensics.
 * - `payments.reconciliation` returns a deterministic mismatch snapshot
 * across local tenders and provider outbox rows.
 * - `payments.methodBreakdown` () aggregates the recent window
 * by `(rail, status)` so the operator sees at a glance which rail
 * is failing.
 * - `payments.retryOutbox` () admin override: resets a row to
 * `queued` so the worker re-dispatches it. Refuses to operate on
 * `settled` rows (terminal — operator must reverse via mark-settled
 * if they really want to undo a confirmed settlement).
 * - `payments.markSettled` () admin override: flips a row to
 * `settled` when the provider already confirmed out-of-band. The
 * optional `providerTransactionId` lets the operator paste the
 * provider-portal value at override time.
 *
 * Real provider credential storage and worker-side rail calls remain in
 * follow-up  slices; the retry / mark-settled mutations target
 * the existing `payment_outbox` rows produced by the deterministic
 * adapters + the  statement-import path.
 *
 * @module trpc/routers/payments
 */

import { and, desc, eq, gte, sql } from 'drizzle-orm';
import { paymentOutbox, type PaymentOutboxStatus, type PaymentRailId } from '../../db/schema.js';
import { throwServerError } from '../../lib/errorCodes.js';
import {
  buildPaymentRailsContract,
  getPaymentReconciliation,
} from '../../services/payments/index.js';
import { writeAuditLog } from '../../services/audit-logs.js';
import { router } from '../init.js';
import { adminProcedure, managerOrAdminProcedure } from '../middleware/roles.js';
import {
  markPaymentOutboxSettledInput,
  paymentMethodBreakdownInput,
  paymentReconciliationInput,
  peekPaymentOutboxInput,
  retryPaymentOutboxInput,
} from '../schemas/payments.js';

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

  /**
   * aggregated `(rail × status)` view for the last
   * `windowDays`. Operator sees one row per bucket so a tile like
   * "Wompi has 8 dead_letter rows worth $480k" is one glance away.
   *
   * No JOIN against `sale_payments` in v1 — the "method" axis is
   * provider-bound (rails ARE the method axis from the operator's
   * perspective). If pilots ask for the `sale_payments.method`
   * subdivision, capture as a follow-up.
   */
  methodBreakdown: managerOrAdminProcedure
    .input(paymentMethodBreakdownInput)
    .query(async ({ ctx, input }) => {
      const since = new Date(Date.now() - input.windowDays * 24 * 60 * 60 * 1000).toISOString();
      const rows = await ctx.db
        .select({
          railId: paymentOutbox.railId,
          status: paymentOutbox.status,
          count: sql<number>`count(*)`.as('count'),
          totalAmount: sql<number>`coalesce(sum(${paymentOutbox.amount}), 0)`.as('total_amount'),
        })
        .from(paymentOutbox)
        .where(and(eq(paymentOutbox.tenantId, ctx.tenantId), gte(paymentOutbox.createdAt, since)))
        .groupBy(paymentOutbox.railId, paymentOutbox.status)
        .orderBy(paymentOutbox.railId, paymentOutbox.status)
        .all();

      return {
        windowDays: input.windowDays,
        entries: rows.map(row => ({
          railId: row.railId as PaymentRailId,
          status: row.status as PaymentOutboxStatus,
          count: Number(row.count) || 0,
          totalAmount:
            typeof row.totalAmount === 'number' ? row.totalAmount : Number(row.totalAmount) || 0,
        })),
      };
    }),

  /**
   * Admin override that resets a `payment_outbox` row back to
   * `queued` so the worker re-dispatches it on the next tick.
   *
   * Only failure-side statuses are retriable: `declined`, `timeout`,
   * `retrying`, `dead_letter`. The blocked statuses are:
   * - `settled` — terminal; provider confirmed final settlement.
   * Retry would corrupt downstream reconciliation.
   * - `approved` — provider already authorized the charge (money is
   * on hold or captured). Retry would re-dispatch and could
   * double-charge the customer. Operator who wants to reverse an
   * approved row uses mark-settled or works the chargeback flow
   * instead.
   * - `submitting` — worker is currently holding the claim token.
   * The stale-claim sweep promotes a wedged `submitting` row back
   * to `queued` automatically. Admin retry from the panel would
   * race the worker.
   * - `queued` — already in the retry-ready state; no-op.
   *
   * Refusal surfaces `PAYMENT_OUTBOX_NOT_RETRIABLE`. Wraps the UPDATE +
   * audit log in a single transaction. The audit row carries the prior
   * `{ status, attempts }` in `before` so forensics can replay the
   * lifecycle.
   */
  retryOutbox: adminProcedure.input(retryPaymentOutboxInput).mutation(async ({ ctx, input }) => {
    const existing = await ctx.db
      .select({
        id: paymentOutbox.id,
        status: paymentOutbox.status,
        attempts: paymentOutbox.attempts,
        railId: paymentOutbox.railId,
      })
      .from(paymentOutbox)
      .where(and(eq(paymentOutbox.id, input.outboxId), eq(paymentOutbox.tenantId, ctx.tenantId)))
      .get();

    if (!existing) {
      throwServerError({
        trpcCode: 'NOT_FOUND',
        errorCode: 'PAYMENT_OUTBOX_NOT_FOUND',
        message: `Payment outbox row ${input.outboxId} not found for this tenant`,
        details: { tenantId: ctx.tenantId, outboxId: input.outboxId },
      });
    }

    const RETRIABLE_STATUSES = new Set<PaymentOutboxStatus>([
      'declined',
      'timeout',
      'retrying',
      'dead_letter',
    ]);
    if (!RETRIABLE_STATUSES.has(existing.status)) {
      throwServerError({
        trpcCode: 'BAD_REQUEST',
        errorCode: 'PAYMENT_OUTBOX_NOT_RETRIABLE',
        message: `Payment outbox row ${input.outboxId} is in status '${existing.status}' — only declined/timeout/retrying/dead_letter rows can be retried from the operator panel`,
        details: { outboxId: input.outboxId, currentStatus: existing.status },
      });
    }

    const before = { status: existing.status, attempts: existing.attempts };
    const after = { status: 'queued' as PaymentOutboxStatus, attempts: 0 };
    const nowIso = new Date().toISOString();

    await ctx.db.transaction(tx => {
      tx.update(paymentOutbox)
        .set({
          status: 'queued',
          attempts: 0,
          nextRetryAt: null,
          claimToken: null,
          lockedAt: null,
          lastError: null,
          updatedAt: nowIso,
        })
        .where(and(eq(paymentOutbox.id, input.outboxId), eq(paymentOutbox.tenantId, ctx.tenantId)))
        .run();

      writeAuditLog({
        tx,
        tenantId: ctx.tenantId,
        actorId: ctx.user!.id,
        action: 'payment.retry',
        resourceType: 'payment_outbox',
        resourceId: input.outboxId,
        before,
        after,
        metadata: { railId: existing.railId },
      });
    });

    return { outboxId: input.outboxId, status: 'queued' as const, attempts: 0 };
  }),

  /**
   * Admin override that flips a `payment_outbox` row to
   * `settled` when the provider already confirmed out-of-band. The
   * optional `providerTransactionId` lets the operator paste the
   * provider-portal value so future reconciliation passes match cleanly.
   *
   * Idempotent: if the row is already `settled`, returns the current
   * projection without writing a second audit row.
   */
  markSettled: adminProcedure
    .input(markPaymentOutboxSettledInput)
    .mutation(async ({ ctx, input }) => {
      const existing = await ctx.db
        .select({
          id: paymentOutbox.id,
          status: paymentOutbox.status,
          attempts: paymentOutbox.attempts,
          railId: paymentOutbox.railId,
          providerTransactionId: paymentOutbox.providerTransactionId,
        })
        .from(paymentOutbox)
        .where(and(eq(paymentOutbox.id, input.outboxId), eq(paymentOutbox.tenantId, ctx.tenantId)))
        .get();

      if (!existing) {
        throwServerError({
          trpcCode: 'NOT_FOUND',
          errorCode: 'PAYMENT_OUTBOX_NOT_FOUND',
          message: `Payment outbox row ${input.outboxId} not found for this tenant`,
          details: { tenantId: ctx.tenantId, outboxId: input.outboxId },
        });
      }

      // Idempotent path: row already settled. Update the provider txn
      // id only when the operator supplied one AND it differs from the
      // current value (keeps the audit trail honest about what
      // actually changed). Even on the providerTransactionId-only path
      // we clear `claim_token` + `locked_at` defensively in case a
      // worker crashed mid-settle and left them populated — a settled
      // row should never carry an active claim.
      if (existing.status === 'settled') {
        if (
          input.providerTransactionId &&
          input.providerTransactionId !== existing.providerTransactionId
        ) {
          const before = {
            status: existing.status,
            providerTransactionId: existing.providerTransactionId,
          };
          const after = {
            status: 'settled' as PaymentOutboxStatus,
            providerTransactionId: input.providerTransactionId,
          };
          const nowIso = new Date().toISOString();
          await ctx.db.transaction(tx => {
            tx.update(paymentOutbox)
              .set({
                providerTransactionId: input.providerTransactionId!,
                claimToken: null,
                lockedAt: null,
                updatedAt: nowIso,
              })
              .where(
                and(eq(paymentOutbox.id, input.outboxId), eq(paymentOutbox.tenantId, ctx.tenantId))
              )
              .run();
            writeAuditLog({
              tx,
              tenantId: ctx.tenantId,
              actorId: ctx.user!.id,
              action: 'payment.mark_settled',
              resourceType: 'payment_outbox',
              resourceId: input.outboxId,
              before,
              after,
              metadata: { railId: existing.railId, alreadySettled: true },
            });
          });
          return {
            outboxId: input.outboxId,
            status: 'settled' as const,
            providerTransactionId: input.providerTransactionId,
          };
        }
        return {
          outboxId: input.outboxId,
          status: 'settled' as const,
          providerTransactionId: existing.providerTransactionId,
        };
      }

      const before = {
        status: existing.status,
        providerTransactionId: existing.providerTransactionId,
      };
      const after = {
        status: 'settled' as PaymentOutboxStatus,
        providerTransactionId: input.providerTransactionId ?? existing.providerTransactionId,
      };
      const nowIso = new Date().toISOString();

      await ctx.db.transaction(tx => {
        tx.update(paymentOutbox)
          .set({
            status: 'settled',
            providerTransactionId: input.providerTransactionId ?? existing.providerTransactionId,
            claimToken: null,
            lockedAt: null,
            updatedAt: nowIso,
          })
          .where(
            and(eq(paymentOutbox.id, input.outboxId), eq(paymentOutbox.tenantId, ctx.tenantId))
          )
          .run();

        writeAuditLog({
          tx,
          tenantId: ctx.tenantId,
          actorId: ctx.user!.id,
          action: 'payment.mark_settled',
          resourceType: 'payment_outbox',
          resourceId: input.outboxId,
          before,
          after,
          metadata: { railId: existing.railId },
        });
      });

      return {
        outboxId: input.outboxId,
        status: 'settled' as const,
        providerTransactionId: after.providerTransactionId,
      };
    }),
});

export type PaymentsRouter = typeof paymentsRouter;
