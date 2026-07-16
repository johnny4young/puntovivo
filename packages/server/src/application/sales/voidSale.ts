/**
 * ENG-055 — `voidSale` use-case service.
 *
 * Voids a completed sale (direct for admins; manager/cashier with an exact
 * admin grant, decoupled from the caller's register): validates state, restores stock to the site that
 * originally sold it, flips `status` to `voided`, conditionally emits
 * a refund cash movement against the ORIGINAL session if it is still
 * open (closed sessions have over/short locked, so we never touch
 * them), writes a `sale.void` audit row, and post-commit emits a
 * DIAN credit note (NC).
 *
 * Distinction vs `returnSale`:
 *  - Void does NOT require the caller to have an active cash session.
 *    Authorization is either direct admin authority or an exact admin grant;
 *    reversal goes against the ORIGINAL session when applicable.
 *  - Stock always restores; cash movement reversal is conditional.
 *
 * Behavior parity with the previous inline router code is the explicit
 * acceptance criterion (ROADMAP §3b ENG-055).
 *
 * @module application/sales/voidSale
 */

import { and, eq, isNull, ne } from 'drizzle-orm';
import type { DatabaseInstance } from '../../db/index.js';
import { cashSessions, operationEvents, saleItems, sales } from '../../db/schema.js';
import { getProductStockTotals } from '../../services/inventory-balances.js';
import { enqueueSync } from '../../services/sync/enqueue.js';
import { removeKdsOrders } from '../../services/kds/remove.js';
import { throwServerError } from '../../lib/errorCodes.js';
import { writeAuditLog } from '../../services/audit-logs.js';
import {
  getPersistedSaleCashContribution,
  insertCashMovement,
} from '../../services/cash-session.js';
import { safelyEmitFiscalDocument } from '../../services/fiscal/orchestrator.js';
import { createModuleLogger } from '../../logging/logger.js';
import { buildVoidedSaleNotes, getPersistedCashContribution } from './policies.js';
import { reverseSaleItemsStock } from './inventory-policy.js';
import {
  enqueueInventoryLotUpdatesForSale,
  restoreLotsForSale,
} from '../../services/inventory-lots/index.js';
import { getOriginalDeeCufe } from './fiscal-policy.js';
import { emitCompleteSaleEffects, type JournalEffectInput } from './journal-effects.js';
import type { CompleteSaleContext, CompleteSaleResult } from './types.js';
import {
  consumeManagerApprovalGrant,
  enqueueConsumedManagerApprovalBestEffort,
  releaseManagerApprovalClaim,
} from '../../services/manager-approvals.js';
import {
  claimShiftLossPreventionApproval,
  evaluateShiftLossPrevention,
  recordShiftLossPreventionTrigger,
} from '../../services/loss-prevention/index.js';

const fallbackLog = createModuleLogger('application/sales/voidSale');

async function lookupJournalEventId(
  db: DatabaseInstance,
  tenantId: string,
  operationId: string | undefined
): Promise<string | null> {
  if (!operationId) {
    return null;
  }
  const row = await db
    .select({ id: operationEvents.id })
    .from(operationEvents)
    .where(
      and(eq(operationEvents.tenantId, tenantId), eq(operationEvents.operationId, operationId))
    )
    .get();
  return row?.id ?? null;
}

export interface VoidSaleInput {
  id: string;
  // ENG-179b — explicit `| undefined` on Zod-optional field.
  reason?: string | null | undefined;
  approvalRequestId?: string | undefined;
}

export type VoidedSaleRecord = typeof sales.$inferSelect;

export async function voidSale(
  ctx: CompleteSaleContext,
  input: VoidSaleInput
): Promise<CompleteSaleResult<VoidedSaleRecord>> {
  const log = ctx.log ?? fallbackLog;

  const existing = await ctx.db
    .select()
    .from(sales)
    .where(and(eq(sales.id, input.id), eq(sales.tenantId, ctx.tenantId)))
    .get();

  if (!existing) {
    throwServerError({
      trpcCode: 'NOT_FOUND',
      errorCode: 'SALE_NOT_FOUND',
      message: 'Sale not found',
    });
  }

  if (existing.status === 'voided') {
    throwServerError({
      trpcCode: 'BAD_REQUEST',
      errorCode: 'SALE_VOID_ALREADY_VOIDED',
      message: 'Sale is already voided',
    });
  }

  if (existing.paymentStatus === 'refunded') {
    throwServerError({
      trpcCode: 'BAD_REQUEST',
      errorCode: 'SALE_VOID_REFUNDED_FORBIDDEN',
      message: 'Refunded sales cannot be voided',
    });
  }

  if (existing.status !== 'completed') {
    throwServerError({
      trpcCode: 'BAD_REQUEST',
      errorCode: 'SALE_VOID_NOT_COMPLETED',
      message: 'Only completed sales can be voided',
    });
  }

  const saleLineItems = await ctx.db
    .select({
      id: saleItems.id,
      productId: saleItems.productId,
      quantity: saleItems.quantity,
      unitEquivalence: saleItems.unitEquivalence,
    })
    .from(saleItems)
    .where(eq(saleItems.saleId, input.id))
    .all();

  if (saleLineItems.length === 0) {
    throwServerError({
      trpcCode: 'BAD_REQUEST',
      errorCode: 'SALE_WITHOUT_ITEMS',
      message: 'Cannot void a sale without line items',
    });
  }

  const productIds = [...new Set(saleLineItems.map(item => item.productId))];
  const productStockState = getProductStockTotals(ctx.db, ctx.tenantId, productIds);

  // Resolve the target session for the cash reversal: only reverse if
  // the ORIGINAL session is still open; once closed, its over/short is
  // finalized.
  const voidTargetSession = existing.cashSessionId
    ? await ctx.db
        .select({
          id: cashSessions.id,
          status: cashSessions.status,
          siteId: cashSessions.siteId,
        })
        .from(cashSessions)
        .where(
          and(eq(cashSessions.id, existing.cashSessionId), eq(cashSessions.tenantId, ctx.tenantId))
        )
        .get()
    : null;
  const voidReversibleSessionId =
    voidTargetSession && voidTargetSession.status === 'open' ? voidTargetSession.id : null;
  // Phase 2 API-103 — credit the site that originally sold the stock.
  // The reversal happens regardless of whether the cash session is still
  // open — voided stock always goes back on the shelf.
  const originalSaleSiteId = voidTargetSession?.siteId ?? null;

  const nextSyncVersion = (existing.syncVersion ?? 0) + 1;
  const expectedSyncVersion =
    existing.syncVersion === null
      ? isNull(sales.syncVersion)
      : eq(sales.syncVersion, existing.syncVersion);
  const now = new Date().toISOString();

  let inventoryMovementIds: string[] = [];
  let cashMovementId: string | null = null;
  let auditLogId: string | null = null;
  let restoredLotIds: string[] = [];
  const refundCashAmount = await getPersistedSaleCashContribution(ctx.db, {
    tenantId: ctx.tenantId,
    saleId: input.id,
    fallbackAmount: getPersistedCashContribution(existing),
  });

  const lossPreventionEvaluation = evaluateShiftLossPrevention({
    db: ctx.db,
    tenantId: ctx.tenantId,
    siteId: ctx.siteId,
    actorId: ctx.user.id,
    role: ctx.user.role,
    action: 'sale_void',
    amount: existing.total,
  });
  recordShiftLossPreventionTrigger({
    db: ctx.db,
    tenantId: ctx.tenantId,
    actorId: ctx.user.id,
    siteId: ctx.siteId,
    resourceType: 'sale',
    resourceId: input.id,
    evaluation: lossPreventionEvaluation,
    approvalRequestId: input.approvalRequestId,
    operationId: ctx.envelope?.operationId,
  });
  const approvalClaim = claimShiftLossPreventionApproval({
    db: ctx.db,
    tenantId: ctx.tenantId,
    siteId: ctx.siteId,
    requesterId: ctx.user.id,
    requesterRole: ctx.user.role,
    action: 'sale_void',
    resourceType: 'sale',
    resourceId: input.id,
    requestId: input.approvalRequestId,
    evaluation: lossPreventionEvaluation,
  });

  try {
    ctx.db.transaction(tx => {
      const voided = tx
        .update(sales)
        .set({
          status: 'voided',
          notes: buildVoidedSaleNotes(existing.notes, input.reason),
          updatedAt: now,
          syncStatus: 'pending',
          syncVersion: nextSyncVersion,
        })
        .where(
          and(
            eq(sales.id, input.id),
            eq(sales.tenantId, ctx.tenantId),
            eq(sales.status, 'completed'),
            ne(sales.paymentStatus, 'refunded'),
            expectedSyncVersion,
            eq(sales.updatedAt, existing.updatedAt)
          )
        )
        .run();
      if (voided.changes !== 1) {
        throwServerError({
          trpcCode: 'CONFLICT',
          errorCode: 'SALE_VOID_NOT_COMPLETED',
          message: 'The sale changed while it was being voided',
        });
      }

      inventoryMovementIds = reverseSaleItemsStock({
        tx,
        tenantId: ctx.tenantId,
        siteId: originalSaleSiteId,
        userId: ctx.user.id,
        saleId: input.id,
        saleNumber: existing.saleNumber,
        reversalKind: 'void',
        items: saleLineItems,
        productStockState,
        now,
      });

      // Auditoría 2026-07 — restore consumed lots on void.
      restoredLotIds = restoreLotsForSale(tx, {
        tenantId: ctx.tenantId,
        saleId: input.id,
        now,
      }).lotIds;

      if (voidReversibleSessionId) {
        cashMovementId = insertCashMovement({
          tx,
          tenantId: ctx.tenantId,
          sessionId: voidReversibleSessionId,
          type: 'refund',
          amount: refundCashAmount,
          referenceId: input.id,
          note: `Voided sale ${existing.saleNumber}`,
          createdBy: ctx.user.id,
          createdAt: now,
        });
      }

      // Phase 8 / Tier-2 #8 — record the sensitive action in the same
      // transaction as the void so an audit row exists iff the void
      // landed.
      auditLogId = writeAuditLog({
        tx,
        tenantId: ctx.tenantId,
        actorId: ctx.user.id,
        action: 'sale.void',
        resourceType: 'sale',
        resourceId: input.id,
        before: {
          status: existing.status,
          paymentStatus: existing.paymentStatus,
          total: existing.total,
          saleNumber: existing.saleNumber,
        },
        after: {
          status: 'voided',
        },
        metadata: {
          ...(input.reason ? { reason: input.reason } : {}),
          lossPreventionCashSessionId: lossPreventionEvaluation.cashSessionId,
          ...(voidReversibleSessionId ? { reversedCashSessionId: voidReversibleSessionId } : {}),
          ...(approvalClaim
            ? { approvalRequestId: approvalClaim.requestId, approvedBy: approvalClaim.approverId }
            : {}),
        },
      });
      if (approvalClaim) {
        consumeManagerApprovalGrant({
          tx,
          tenantId: ctx.tenantId,
          requesterId: ctx.user.id,
          claim: approvalClaim,
          consumedResourceType: 'sale',
          consumedResourceId: input.id,
          metadata: { saleNumber: existing.saleNumber },
        });
      }
    });
  } catch (error) {
    if (approvalClaim) releaseManagerApprovalClaim(ctx.db, ctx.tenantId, approvalClaim);
    throw error;
  }

  if (approvalClaim) {
    await enqueueConsumedManagerApprovalBestEffort(ctx, approvalClaim);
  }

  await enqueueSync(ctx, {
    entityType: 'sales',
    entityId: input.id,
    operation: 'update',
    data: { id: input.id, status: 'voided', reason: input.reason ?? null },
  });

  // ENG-192 — enqueue the lots the void credited back so the mutation
  // reaches sync_outbox.
  await enqueueInventoryLotUpdatesForSale(ctx, restoredLotIds, input.id);

  // ENG-020 — emit DIAN credit note (NC) for the voided sale. Pulls
  // the original DEE's CUFE so the NC references it. Best-effort.
  const originalCufe = await getOriginalDeeCufe(ctx.db, ctx.tenantId, input.id);
  const fiscalResult = await safelyEmitFiscalDocument({
    db: ctx.db,
    tenantId: ctx.tenantId,
    userId: ctx.user.id,
    log,
    source: 'void',
    sourceId: input.id,
    saleId: input.id,
    kind: 'NC',
    originalCufe,
    reasonCode: input.reason ?? undefined,
  });
  const fiscalEmitId = fiscalResult?.id ?? null;

  const updated = await ctx.db
    .select()
    .from(sales)
    .where(and(eq(sales.id, input.id), eq(sales.tenantId, ctx.tenantId)))
    .get();

  const journalEventId = await lookupJournalEventId(
    ctx.db,
    ctx.tenantId,
    ctx.envelope?.operationId
  );
  if (journalEventId) {
    const effects: JournalEffectInput[] = [];
    effects.push({
      kind: 'sale_row',
      resourceType: 'sales',
      resourceId: input.id,
      effectData: {
        saleNumber: existing.saleNumber,
        status: 'voided',
        reversedCashSessionId: voidReversibleSessionId,
      },
    });
    for (const movementId of inventoryMovementIds) {
      effects.push({
        kind: 'inventory_movement',
        resourceType: 'inventory_movements',
        resourceId: movementId,
      });
    }
    if (cashMovementId) {
      effects.push({
        kind: 'cash_movement',
        resourceType: 'cash_movements',
        resourceId: cashMovementId,
        effectData: {
          sessionId: voidReversibleSessionId,
          amount: refundCashAmount,
        },
      });
    }
    if (auditLogId) {
      effects.push({
        kind: 'audit_log',
        resourceType: 'audit_logs',
        resourceId: auditLogId,
        effectData: { action: 'sale.void' },
      });
    }
    if (fiscalEmitId) {
      effects.push({
        kind: 'fiscal_emit',
        resourceType: 'fiscal_documents',
        resourceId: fiscalEmitId,
      });
    }
    await emitCompleteSaleEffects(ctx.db, log, journalEventId, effects);
  }

  // ENG-098 — drop any kitchen card for the voided sale. No-op when
  // the sale never had a tableId (retail path) or when the card has
  // already aged out via the 5-minute ready TTL.
  await removeKdsOrders({
    ctx: {
      db: ctx.db,
      tenantId: ctx.tenantId,
      siteId: ctx.siteId || null,
      user: { id: ctx.user.id },
      sse: ctx.sse ?? null,
      log: ctx.log,
    },
    saleId: input.id,
    reason: 'void',
  });

  return {
    sale: updated as VoidedSaleRecord,
    change: 0,
    journalEventId,
  };
}
