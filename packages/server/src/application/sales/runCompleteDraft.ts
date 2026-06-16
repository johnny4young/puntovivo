/**
 * ENG-178 — Draft-completion path of the `completeSale` use-case,
 * extracted from the former monolithic `completeSale.ts` during the
 * megafile decomposition.
 *
 * The pre-tx guards, the frozen-base total computation, and the
 * `db.transaction(...)` body move VERBATIM; the orchestration shared
 * with the fresh path (payment plan, credit pre-flight, credit ledger,
 * fiscal emit, journal effects, KDS enqueue) is delegated to the shared
 * leaves. Behavior parity is the explicit acceptance criterion — proven
 * by the unchanged caller suite.
 *
 * @module application/sales/runCompleteDraft
 */

import { and, eq, sql } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { salePayments, saleItems, sales } from '../../db/schema.js';
import { throwServerError } from '../../lib/errorCodes.js';
import { roundMoney } from '../../lib/money.js';
import { writeAuditLog } from '../../services/audit-logs.js';
import {
  assertCashSessionStillOpen,
  insertCashMovement,
  requireActiveCashSession,
} from '../../services/cash-session.js';
import { assertServiceChargeMatchesTenant } from '../../services/restaurant/settings.js';
import { enqueueSync } from '../../services/sync/enqueue.js';
import { resolveSalePaymentPlan } from './pricing.js';
import { runCreditPreflight, safelyRecordCreditSaleLedger } from './creditPolicy.js';
import { emitSaleFiscalDocument, enqueueSaleKdsOrder } from './fiscalPostHook.js';
import {
  buildDraftSaleEffects,
  emitCompleteSaleEffects,
  lookupJournalEventId,
  safeUpdateSaleCompletedSummary,
  type PersistedPaymentEffect,
} from './journal-effects.js';
import { getSaleRecord, type CompleteSaleSaleRecord } from './sale-read.js';
import type {
  CompleteSaleContext,
  CompleteSaleInput,
  CompleteSaleLogger,
  CompleteSaleResult,
} from './types.js';

/**
 * Draft-completion path (formerly `sales.completeDraft`): finalize a sale
 * already persisted with `status='draft'`.
 *
 * Invariants:
 * - The draft's items + subtotal + tax + discount are IMMUTABLE from the
 *   create-time call; only tip / service charge are captured at completion.
 *   `baseTotal` is RECOMPUTED from the frozen monetary pieces
 *   (`existing.subtotal + existing.taxAmount - existing.discountAmount`),
 *   NOT from `existing.total`. This is the no-compounding rule: a draft
 *   created with a tip/service-charge already baked into `total` would
 *   otherwise see the second tip/charge stack on top of the first and leave
 *   `total` out of sync with the `tipAmount` / `serviceChargeAmount`
 *   columns. All amounts `roundMoney`-ed, country-agnostic (see `completeSale`).
 *
 * Preconditions: the sale exists, is still `draft` (not already completed),
 * is not suspended (`SALE_COMPLETE_DRAFT_SUSPENDED`), has line items, the
 * actor is the creator OR a manager/admin, and an active cash session exists.
 *
 * Postconditions: the draft is flipped to a completed sale in one
 * transaction (status, totals, payments, stock, cash movement, audit logs);
 * fiscal emission + journal effects fire best-effort post-commit.
 */
export async function runCompleteDraft(
  ctx: CompleteSaleContext,
  log: CompleteSaleLogger,
  input: Extract<CompleteSaleInput, { mode: 'fromDraft' }>
): Promise<CompleteSaleResult<CompleteSaleSaleRecord>> {
  const existing = await ctx.db
    .select()
    .from(sales)
    .where(and(eq(sales.id, input.saleId), eq(sales.tenantId, ctx.tenantId)))
    .get();

  if (!existing) {
    throwServerError({
      trpcCode: 'NOT_FOUND',
      errorCode: 'SALE_NOT_FOUND',
      message: 'Sale not found',
    });
  }

  if (existing.status !== 'draft') {
    throwServerError({
      trpcCode: 'BAD_REQUEST',
      errorCode: 'SALE_DRAFT_REQUIRED',
      message: 'Only draft sales can be completed',
      details: { operation: 'complete', actualStatus: existing.status },
    });
  }

  if (existing.suspendedAt) {
    throwServerError({
      trpcCode: 'BAD_REQUEST',
      errorCode: 'SALE_COMPLETE_DRAFT_SUSPENDED',
      message: 'Resume the draft with sales.resume before completing it',
      details: { saleId: input.saleId },
    });
  }

  const actorRole = ctx.user.role;
  const isCreator = existing.createdBy === ctx.user.id;
  const canOverride = actorRole === 'manager' || actorRole === 'admin';
  if (!isCreator && !canOverride) {
    throwServerError({
      trpcCode: 'FORBIDDEN',
      errorCode: 'SALE_SUSPEND_OWNERSHIP_REQUIRED',
      message: 'Only the cashier who created this draft can complete it',
      details: { operation: 'complete' },
    });
  }

  const activeCashSession = await requireActiveCashSession(
    ctx.db,
    ctx.tenantId,
    ctx.siteId,
    ctx.user.id
  );

  const lineItemCount = await ctx.db
    .select({ count: sql<number>`count(*)` })
    .from(saleItems)
    .where(eq(saleItems.saleId, input.saleId))
    .get();

  if (!lineItemCount || (lineItemCount.count ?? 0) === 0) {
    throwServerError({
      trpcCode: 'BAD_REQUEST',
      errorCode: 'SALE_WITHOUT_ITEMS',
      message: 'Cannot complete a draft without line items',
    });
  }

  // ENG-039d — tip / propina layered on top of the frozen draft base.
  // The draft's items + subtotal + tax + discount are immutable from
  // the create-time call (sales.create stored them with status='draft');
  // tip is captured at complete-time so the cashier can confirm it
  // after the customer settles. We recompute `baseTotal` from the
  // frozen monetary pieces rather than `existing.total` — a draft that
  // was created with a tip already baked into `total` would otherwise
  // see the second tip compound on top of the first, leaving
  // `total` out of sync with the new `tipAmount` column.
  const tipAmount = roundMoney(Math.max(0, input.tipAmount ?? 0));
  const tipMethod = tipAmount > 0 ? input.tipMethod ?? null : null;
  // ENG-039d3 — service charge layered onto the frozen draft base. The
  // same baseTotal-from-frozen-pieces logic that prevents tip compounding
  // (a draft that was opened with a service charge already in `total`
  // would otherwise see the new charge double-stacked) applies here too.
  const serviceChargeAmount = roundMoney(Math.max(0, input.serviceChargeAmount ?? 0));
  const baseTotal = roundMoney(
    (existing.subtotal ?? 0) +
    (existing.taxAmount ?? 0) -
    (existing.discountAmount ?? 0)
  );
  const restaurantSettings = await assertServiceChargeMatchesTenant({
    db: ctx.db,
    tenantId: ctx.tenantId,
    base: baseTotal,
    serviceChargeAmount,
  });
  const serviceChargeRate =
    serviceChargeAmount > 0 ? restaurantSettings.serviceChargeRate : null;
  const total = roundMoney(baseTotal + tipAmount + serviceChargeAmount);

  // Phase 2 Tier-2 step 5 — resolve the tender list (split or legacy),
  // payment status, change, and cash collected. The draft is always
  // completing, so `collectCash` is unconditionally true.
  const {
    resolvedPayments,
    creditSaleAmount,
    paymentStatus,
    change,
    cashCollectedAmount,
  } = resolveSalePaymentPlan({
    amountReceived: input.amountReceived,
    payments: input.payments,
    paymentMethod: input.paymentMethod,
    requestedStatus: input.paymentStatus,
    total,
    collectCash: true,
  });

  // ENG-014 — same credit-sale pre-flight as the fresh path, but the
  // customer comes from the draft row (`existing.customerId`) rather
  // than from the input. The draft customer is locked at create-time;
  // completeDraft cannot re-assign it.
  const draftCustomerId = existing.customerId;
  const creditProjection = await runCreditPreflight({
    db: ctx.db,
    tenantId: ctx.tenantId,
    creditSaleAmount,
    customerId: draftCustomerId,
    allowOverride: input.creditOverride === true,
    enabled: true,
  });

  const now = new Date().toISOString();
  const nextSyncVersion = (existing.syncVersion ?? 0) + 1;

  let cashMovementId: string | null = null;
  let completionAuditId: string | null = null;
  const paymentEffects: PersistedPaymentEffect[] = [];

  ctx.db.transaction(tx => {
    // ENG-042 TOCTOU defense.
    assertCashSessionStillOpen(tx, ctx.tenantId, activeCashSession.id);

    // Replace any placeholder payment rows the draft might have
    // carried from its initial `sales.create` call with the real
    // tenders captured at complete-time.
    tx.delete(salePayments)
      .where(
        and(eq(salePayments.saleId, input.saleId), eq(salePayments.tenantId, ctx.tenantId))
      )
      .run();

    for (const payment of resolvedPayments.rows) {
      const paymentId = nanoid();
      const tenderAmount = roundMoney(payment.amount);
      tx.insert(salePayments)
        .values({
          id: paymentId,
          tenantId: ctx.tenantId,
          saleId: input.saleId,
          method: payment.method,
          amount: tenderAmount,
          reference: payment.reference,
          syncStatus: 'pending',
          syncVersion: 1,
          createdAt: now,
        })
        .run();
      paymentEffects.push({
        id: paymentId,
        method: payment.method,
        amount: tenderAmount,
      });
    }

    tx.update(sales)
      .set({
        paymentMethod: resolvedPayments.dominantMethod,
        paymentStatus,
        status: 'completed',
        // Re-bind to the active session so cash reports show the
        // income where it physically arrived.
        cashSessionId: activeCashSession.id,
        notes: input.notes ?? existing.notes,
        // ENG-039d — persist the tip captured at complete-time. When
        // no tip was entered we still write 0 / null so a previously
        // partially-staged value never sticks.
        tipAmount,
        tipMethod,
        // ENG-039d3 — persist service charge captured at complete-time.
        serviceChargeAmount,
        serviceChargeRate,
        total,
        syncStatus: 'pending',
        syncVersion: nextSyncVersion,
        updatedAt: now,
      })
      .where(and(eq(sales.id, input.saleId), eq(sales.tenantId, ctx.tenantId)))
      .run();

    cashMovementId = insertCashMovement({
      tx,
      tenantId: ctx.tenantId,
      sessionId: activeCashSession.id,
      type: 'sale',
      amount: cashCollectedAmount,
      referenceId: input.saleId,
      note: `Sale ${existing.saleNumber} · completed from draft`,
      createdBy: ctx.user.id,
      createdAt: now,
    });

    // Parity with void / return / park / resume / discard / reprint:
    // every state-change on an existing sale leaves a `sale.*` audit row.
    completionAuditId = writeAuditLog({
      tx,
      tenantId: ctx.tenantId,
      actorId: ctx.user.id,
      action: 'sale.complete',
      resourceType: 'sale',
      resourceId: input.saleId,
      before: {
        status: 'draft',
        cashSessionId: existing.cashSessionId,
        paymentStatus: existing.paymentStatus,
      },
      after: {
        status: 'completed',
        cashSessionId: activeCashSession.id,
        paymentStatus,
        total,
      },
      metadata: {
        completedFromDraft: true,
        saleNumber: existing.saleNumber,
        ...(input.payments && input.payments.length > 0
          ? { tenderCount: input.payments.length }
          : {}),
        // ENG-039d — surface tip in the audit row only when captured;
        // suppressing the keys at zero keeps audit reads scannable.
        // `tipMethod` is omitted (rather than written as `null`) when
        // the caller did not specify a method.
        ...(tipAmount > 0
          ? { tipAmount, ...(tipMethod ? { tipMethod } : {}) }
          : {}),
        // ENG-039d3 — mirror the tip pattern for service charge.
        ...(serviceChargeAmount > 0
          ? {
              serviceChargeAmount,
              ...(serviceChargeRate !== null ? { serviceChargeRate } : {}),
            }
          : {}),
      },
    });

    // ENG-007 closure — admin authorised a credit sale whose projected
    // balance exceeded the customer's cupo. `overrideApplied` is true
    // only when (exceedsLimit && allowOverride === true), so the row
    // never fires for admin-completed sales that stayed under the limit.
    // `draftCustomerId` is captured from the existing sale row above
    // because the `fromDraft` input shape does not carry `customerId`.
    if (creditProjection?.overrideApplied === true && draftCustomerId) {
      writeAuditLog({
        tx,
        tenantId: ctx.tenantId,
        actorId: ctx.user.id,
        action: 'sale.credit_override',
        resourceType: 'sale',
        resourceId: input.saleId,
        before: null,
        after: {
          customerId: draftCustomerId,
          creditLimit: creditProjection.creditLimit,
          currentBalance: creditProjection.currentBalance,
          projectedBalance: creditProjection.projectedBalance,
          attemptedAmount: creditProjection.attemptedAmount,
        },
        metadata: {
          actorRole: ctx.user.role,
          saleNumber: existing.saleNumber,
          completedFromDraft: true,
        },
      });
    }
  });

  // ENG-064b — sync_outbox emit moved POST-tx (was inline `tx.insert`
  // before the cutover). The helper writes the operation_effects row
  // (kind=outbox_enqueue:sync) itself when the envelope is present.
  await enqueueSync(ctx, {
    entityType: 'sales',
    entityId: input.saleId,
    operation: 'update',
    data: {
      id: input.saleId,
      status: 'completed',
      completedFromDraft: true,
      total,
      paymentStatus,
    },
  });

  // ENG-090 — same best-effort ledger-write as the fresh path. The
  // draft already finalized as `completed`; a ledger failure here
  // does NOT roll the sale back.
  await safelyRecordCreditSaleLedger({
    db: ctx.db,
    log,
    tenantId: ctx.tenantId,
    customerId: draftCustomerId,
    creditSaleAmount,
    saleId: input.saleId,
    createdBy: ctx.user.id,
    note: existing.saleNumber,
    projectedBalance: creditProjection?.projectedBalance ?? null,
    enabled: true,
    logLabel: '[completeSale.fromDraft]',
  });
  void creditProjection;

  // ENG-020 — emit DIAN DEE on first completion of the draft.
  const fiscalEmitId = await emitSaleFiscalDocument({
    db: ctx.db,
    tenantId: ctx.tenantId,
    userId: ctx.user.id,
    log,
    saleId: input.saleId,
    enabled: true,
  });

  const completed = await getSaleRecord(ctx.db, ctx.tenantId, input.saleId);

  const journalEventId = await lookupJournalEventId(
    ctx.db,
    ctx.tenantId,
    ctx.envelope?.operationId
  );
  if (journalEventId) {
    await safeUpdateSaleCompletedSummary(ctx, log, journalEventId, {
      saleId: input.saleId,
      saleNumber: existing.saleNumber,
      siteId: activeCashSession.siteId,
      cashSessionId: activeCashSession.id,
      customerId: completed.customerId,
      subtotal: completed.subtotal,
      taxAmount: completed.taxAmount,
      discountAmount: completed.discountAmount,
      total: completed.total,
      paymentMethod: resolvedPayments.dominantMethod,
    });

    const effects = buildDraftSaleEffects({
      saleId: input.saleId,
      saleNumber: existing.saleNumber,
      total,
      dominantMethod: resolvedPayments.dominantMethod,
      paymentStatus,
      paymentEffects,
      cashMovementId,
      sessionId: activeCashSession.id,
      cashCollectedAmount,
      completionAuditId,
      fiscalEmitId,
    });
    await emitCompleteSaleEffects(ctx.db, log, journalEventId, effects);
  }

  // ENG-098 — push to the kitchen display when the underlying draft
  // carried a tableId. Idempotent against the suspend → complete
  // progression via UNIQUE(tenant_id, sale_id, station). For the
  // common path (suspend already created the card) this is a no-op
  // at the DB layer.
  await enqueueSaleKdsOrder(ctx, existing.tableId, input.saleId);

  return {
    sale: completed as CompleteSaleSaleRecord,
    change,
    journalEventId,
  };
}
