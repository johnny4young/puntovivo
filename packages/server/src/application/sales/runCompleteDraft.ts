/**
 * Draft-completion path of the `completeSale` use-case,
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

import { and, eq, isNull } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import type { UserRole } from '@puntovivo/shared/roles';
import {
  getCheckoutApprovalDiscountAmount,
  type CheckoutApprovalContext,
} from '@puntovivo/shared/checkout-approval';
import { salePayments, saleItems, sales } from '../../db/schema.js';
import { throwServerError } from '../../lib/errorCodes.js';
import { roundMoney } from '../../lib/money.js';
import { writeAuditLog } from '../../services/audit-logs.js';
import {
  evaluateCheckoutLossPrevention,
  recordCheckoutLossPreventionTriggers,
} from '../../services/loss-prevention/index.js';
import { checkoutApprovalResourceId } from '../../services/manager-approvals.js';
import {
  assertCashSessionStillOpen,
  insertCashMovement,
  requireActiveCashSession,
} from '../../services/cash-session.js';
import { assertServiceChargeMatchesTenant } from '../../services/restaurant/settings.js';
import { transitionSaleSerials } from '../../services/product-serials.js';
import { enqueueSync } from '../../services/sync/enqueue.js';
import { earnPointsForSale, resolveLoyaltySettings } from '../../services/loyalty.js';
import { validateCustomer } from './item-resolution.js';
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
import { resolveCheckoutTiming } from './checkout-timing.js';
import type {
  CompleteSaleContext,
  CompleteSaleInput,
  CompleteSaleLogger,
  CompleteSaleResult,
} from './types.js';
import {
  claimCheckoutApprovals,
  consumeCheckoutApprovals,
  enqueueCheckoutApprovalConsumptions,
  releaseCheckoutApprovals,
  requiredCheckoutApprovalActions,
} from './checkout-approvals.js';

/**
 * Draft-completion path (formerly `sales.completeDraft`): finalize a sale
 * already persisted with `status='draft'`.
 *
 * Invariants:
 * - The draft's items + subtotal + tax + discount are IMMUTABLE from the
 * create-time call; only tip / service charge are captured at completion.
 * `baseTotal` is RECOMPUTED from the frozen monetary pieces
 * (`existing.subtotal + existing.taxAmount - existing.discountAmount`),
 * NOT from `existing.total`. This is the no-compounding rule: a draft
 * created with a tip/service-charge already baked into `total` would
 * otherwise see the second tip/charge stack on top of the first and leave
 * `total` out of sync with the `tipAmount` / `serviceChargeAmount`
 * columns. All amounts `roundMoney`-ed, country-agnostic (see `completeSale`).
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

  const draftApprovalItems = await ctx.db
    .select({
      id: saleItems.id,
      productId: saleItems.productId,
      unitId: saleItems.unitId,
      quantity: saleItems.quantity,
      unitPrice: saleItems.unitPrice,
      discount: saleItems.discount,
    })
    .from(saleItems)
    .where(eq(saleItems.saleId, input.saleId))
    .all();

  if (draftApprovalItems.length === 0) {
    throwServerError({
      trpcCode: 'BAD_REQUEST',
      errorCode: 'SALE_WITHOUT_ITEMS',
      message: 'Cannot complete a draft without line items',
    });
  }

  // tip / propina layered on top of the frozen draft base.
  // The draft's items + subtotal + tax + discount are immutable from
  // the create-time call (sales.create stored them with status='draft');
  // tip is captured at complete-time so the cashier can confirm it
  // after the customer settles. We recompute `baseTotal` from the
  // frozen monetary pieces rather than `existing.total` — a draft that
  // was created with a tip already baked into `total` would otherwise
  // see the second tip compound on top of the first, leaving
  // `total` out of sync with the new `tipAmount` column.
  const tipAmount = roundMoney(Math.max(0, input.tipAmount ?? 0));
  const tipMethod = tipAmount > 0 ? (input.tipMethod ?? null) : null;
  // service charge layered onto the frozen draft base. The
  // same baseTotal-from-frozen-pieces logic that prevents tip compounding
  // (a draft that was opened with a service charge already in `total`
  // would otherwise see the new charge double-stacked) applies here too.
  const serviceChargeAmount = roundMoney(Math.max(0, input.serviceChargeAmount ?? 0));
  const baseTotal = roundMoney(
    (existing.subtotal ?? 0) + (existing.taxAmount ?? 0) - (existing.discountAmount ?? 0)
  );
  const restaurantSettings = await assertServiceChargeMatchesTenant({
    db: ctx.db,
    tenantId: ctx.tenantId,
    base: baseTotal,
    serviceChargeAmount,
  });
  const serviceChargeRate = serviceChargeAmount > 0 ? restaurantSettings.serviceChargeRate : null;
  const total = roundMoney(baseTotal + tipAmount + serviceChargeAmount);

  // resolve the tender list (split or legacy),
  // payment status, change, and cash collected. The draft is always
  // completing, so `collectCash` is unconditionally true.
  const { resolvedPayments, creditSaleAmount, paymentStatus, change, cashCollectedAmount } =
    resolveSalePaymentPlan({
      amountReceived: input.amountReceived,
      payments: input.payments,
      paymentMethod: input.paymentMethod,
      requestedStatus: input.paymentStatus,
      total,
      collectCash: true,
    });

  // the customer is resolved from the input when it carries one,
  // falling back to whatever the draft stored.  used to lock the
  // draft's customer at create-time, but the payment drawer is the only
  // customer-attach surface in the app and a suspended change is created
  // without one, so the lock silently recorded every resumed sale as a
  // walk-in. `undefined` (field omitted) keeps the stored value; an
  // explicit `null` clears it.
  //
  // Validation runs BEFORE the credit pre-flight below, and the pre-flight
  // then projects against the RESOLVED customer — so re-assigning at
  // payment time cannot dodge the new customer's cupo.
  const draftCustomerId =
    input.customerId === undefined ? existing.customerId : (input.customerId ?? null);
  if (input.customerId !== undefined && input.customerId !== existing.customerId) {
    await validateCustomer(ctx.db, ctx.tenantId, draftCustomerId);
  }
  // resolved before the tx (a settings read is a DB round trip and
  // the tx body is sync). A resumed draft is the same sale as a fresh one for
  // the customer, so it must earn the same points.
  const loyaltySettings = await resolveLoyaltySettings(ctx.db, ctx.tenantId);

  let loyaltyPointsEarned = 0;
  const creditProjection = await runCreditPreflight({
    db: ctx.db,
    tenantId: ctx.tenantId,
    creditSaleAmount,
    customerId: draftCustomerId,
    allowOverride: input.creditOverride === true,
    enabled: true,
  });

  const now = new Date().toISOString();
  const checkoutTiming = resolveCheckoutTiming(input.checkoutStartedAt, now);
  const nextSyncVersion = (existing.syncVersion ?? 0) + 1;
  const expectedSyncVersion =
    existing.syncVersion === null
      ? isNull(sales.syncVersion)
      : eq(sales.syncVersion, existing.syncVersion);

  let cashMovementId: string | null = null;
  let completionAuditId: string | null = null;
  const paymentEffects: PersistedPaymentEffect[] = [];

  const approvalContext: CheckoutApprovalContext = {
    mode: 'fromDraft',
    saleId: input.saleId,
    customerId: draftCustomerId,
    items: draftApprovalItems.map(item => ({
      productId: item.productId,
      unitId: item.unitId ?? '',
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      discount: item.discount,
    })),
    paymentMethod: input.paymentMethod,
    payments: (input.payments ?? []).map(payment => ({
      method: payment.method,
      amount: payment.amount,
      reference: payment.reference,
    })),
    amountReceived: input.amountReceived ?? null,
    discountAmount: getCheckoutApprovalDiscountAmount(
      draftApprovalItems,
      existing.discountAmount ?? 0
    ),
    total,
    creditAmount: creditSaleAmount,
    tipAmount,
    serviceChargeAmount,
    currencyCode: existing.currencyCode ?? 'COP',
  };
  const baselineApprovalActions = requiredCheckoutApprovalActions({
    role: ctx.user.role as UserRole,
    isCompletion: true,
    // discounts now use the configured per-role threshold.
    hasDiscount: false,
    hasCreditTender: creditSaleAmount > 0,
    creditOverride: input.creditOverride === true,
  });
  const lossPreventionEvaluation = await evaluateCheckoutLossPrevention({
    db: ctx.db,
    tenantId: ctx.tenantId,
    role: ctx.user.role,
    isCompletion: true,
    items: approvalContext.items,
    discountAmount: approvalContext.discountAmount,
  });
  const requiredApprovalActions = [
    ...new Set([...baselineApprovalActions, ...lossPreventionEvaluation.requiredActions]),
  ];
  recordCheckoutLossPreventionTriggers({
    db: ctx.db,
    tenantId: ctx.tenantId,
    actorId: ctx.user.id,
    siteId: activeCashSession.siteId,
    checkoutResourceId: checkoutApprovalResourceId(approvalContext),
    mode: 'fromDraft',
    evaluation: lossPreventionEvaluation,
    providedActions: (input.approvalRequests ?? []).map(reference => reference.action),
    operationId: ctx.envelope?.operationId,
  });
  const approvalClaims = claimCheckoutApprovals({
    db: ctx.db,
    tenantId: ctx.tenantId,
    siteId: activeCashSession.siteId,
    requesterId: ctx.user.id,
    requiredActions: requiredApprovalActions,
    references: input.approvalRequests,
    context: approvalContext,
  });

  try {
    ctx.db.transaction(tx => {
      // TOCTOU defense.
      assertCashSessionStillOpen(tx, ctx.tenantId, activeCashSession.id);

      // claim the exact draft snapshot before writing any
      // payments or consuming approvals. Suspend, discard, split, and draft
      // edits advance syncVersion/updatedAt, so a concurrent lifecycle change
      // cannot be resurrected as a completed sale from this stale snapshot.
      const completedDraft = tx
        .update(sales)
        .set({
          paymentMethod: resolvedPayments.dominantMethod,
          paymentStatus,
          status: 'completed',
          // persist the customer attached at payment time. Resolves
          // to the draft's stored value when the caller omitted the field, so
          // an older client that never sends it is a no-op.
          customerId: draftCustomerId,
          // Re-bind to the active session so cash reports show the
          // income where it physically arrived.
          cashSessionId: activeCashSession.id,
          notes: input.notes ?? existing.notes,
          // persist the tip captured at complete-time. When
          // no tip was entered we still write 0 / null so a previously
          // partially-staged value never sticks.
          tipAmount,
          tipMethod,
          // persist service charge captured at complete-time.
          serviceChargeAmount,
          serviceChargeRate,
          total,
          ...checkoutTiming,
          syncStatus: 'pending',
          syncVersion: nextSyncVersion,
          updatedAt: now,
        })
        .where(
          and(
            eq(sales.id, input.saleId),
            eq(sales.tenantId, ctx.tenantId),
            eq(sales.status, 'draft'),
            isNull(sales.suspendedAt),
            expectedSyncVersion,
            eq(sales.updatedAt, existing.updatedAt)
          )
        )
        .run();
      if (completedDraft.changes !== 1) {
        throwServerError({
          trpcCode: 'CONFLICT',
          errorCode: 'SALE_DRAFT_REQUIRED',
          message: 'The draft changed while checkout was being completed',
          details: { operation: 'complete', actualStatus: 'stale_snapshot' },
        });
      }

      // Replace any placeholder payment rows the draft might have
      // carried from its initial `sales.create` call with the real
      // tenders captured at complete-time.
      tx.delete(salePayments)
        .where(and(eq(salePayments.saleId, input.saleId), eq(salePayments.tenantId, ctx.tenantId)))
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

      // a resumed draft earns exactly like a fresh sale: same money,
      // same customer, so the same points. Suspending a change is a cashier
      // workflow detail the customer never agreed to be charged for. Mirrors
      // the fresh path: idempotent per (account, sale), wrapped in a SAVEPOINT
      // so a half-written ledger can never ride to COMMIT, and best-effort so
      // a loyalty failure never blocks the register.
      try {
        tx.transaction(loyaltyTx => {
          loyaltyPointsEarned = earnPointsForSale(loyaltyTx, {
            tenantId: ctx.tenantId,
            customerId: draftCustomerId ?? null,
            saleId: input.saleId,
            total,
            settings: loyaltySettings,
            nowIso: now,
          });
        });
      } catch (error) {
        loyaltyPointsEarned = 0;
        log?.warn?.({ err: error, saleId: input.saleId }, 'loyalty accrual skipped');
      }

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
          // the customer became mutable at completion, and a
          // manager can complete someone else's draft. Re-assigning moves the
          // receivable, the loyalty accrual, and the fiscal buyer, so the
          // before/after pair has to carry it or the change is
          // unreconstructible from the audit log.
          customerId: existing.customerId,
        },
        after: {
          status: 'completed',
          cashSessionId: activeCashSession.id,
          paymentStatus,
          total,
          customerId: draftCustomerId,
        },
        metadata: {
          completedFromDraft: true,
          saleNumber: existing.saleNumber,
          ...(input.payments && input.payments.length > 0
            ? { tenderCount: input.payments.length }
            : {}),
          // surface tip in the audit row only when captured;
          // suppressing the keys at zero keeps audit reads scannable.
          // `tipMethod` is omitted (rather than written as `null`) when
          // the caller did not specify a method.
          ...(tipAmount > 0 ? { tipAmount, ...(tipMethod ? { tipMethod } : {}) } : {}),
          // mirror the tip pattern for service charge.
          ...(serviceChargeAmount > 0
            ? {
                serviceChargeAmount,
                ...(serviceChargeRate !== null ? { serviceChargeRate } : {}),
              }
            : {}),
        },
      });

      // closure — admin authorised a credit sale whose projected
      // balance exceeded the customer's cupo. `overrideApplied` is true
      // only when (exceedsLimit && allowOverride === true), so the row
      // never fires for admin-completed sales that stayed under the limit.
      // `draftCustomerId` is the customer resolved above — the input's when
      // it carried one, the draft row's otherwise ().
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
      consumeCheckoutApprovals({
        tx,
        tenantId: ctx.tenantId,
        requesterId: ctx.user.id,
        claims: approvalClaims,
        saleId: input.saleId,
        saleNumber: existing.saleNumber,
      });
      transitionSaleSerials(tx as unknown as typeof ctx.db, {
        tenantId: ctx.tenantId,
        saleItemIds: draftApprovalItems.map(item => item.id),
        from: 'reserved',
        to: 'sold',
        now,
        syncContext: { ...ctx, db: tx as unknown as typeof ctx.db },
      });
    });
  } catch (error) {
    releaseCheckoutApprovals(ctx.db, ctx.tenantId, approvalClaims);
    throw error;
  }

  await enqueueCheckoutApprovalConsumptions(ctx, approvalClaims);

  // sync_outbox emit moved POST-tx (was inline `tx.insert`
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
      // the completion can attach or re-assign the customer, so
      // the peer must learn about it or it keeps the draft's stale value.
      customerId: draftCustomerId,
    },
  });

  // same best-effort ledger-write as the fresh path. The
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

  // emit DIAN DEE on first completion of the draft.
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

  // push to the kitchen display when the underlying draft
  // carried a tableId. Idempotent against the suspend → complete
  // progression via UNIQUE(tenant_id, sale_id, station). For the
  // common path (suspend already created the card) this is a no-op
  // at the DB layer.
  await enqueueSaleKdsOrder(ctx, existing.tableId, input.saleId);

  return {
    sale: completed as CompleteSaleSaleRecord,
    change,
    journalEventId,
    loyaltyPointsEarned,
  };
}
