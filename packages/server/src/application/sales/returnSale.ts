/**
 * ENG-055 — `returnSale` use-case service.
 *
 * Refunds a completed sale: validates state, restores stock to the
 * site that originally sold it, persists a `sale_returns` row, flips
 * `paymentStatus` to `refunded`, emits a refund cash movement against
 * the cashier's active session, writes a `sale.return` audit row, and
 * post-commit emits a DIAN credit note (NC) referencing the original
 * DEE's CUFE.
 *
 * Behavior parity with the previous inline router code is the explicit
 * acceptance criterion (ROADMAP §3b ENG-055). The control flow, shape
 * of the rows written, and ordering of side effects all match what the
 * legacy `sales.returnSale` procedure used to do.
 *
 * @module application/sales/returnSale
 */

import { and, eq, inArray } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import type { DatabaseInstance } from '../../db/index.js';
import {
  cashSessions,
  operationEvents,
  products,
  saleItems,
  salePayments,
  saleReturns,
  sales,
} from '../../db/schema.js';
import { enqueueSync } from '../../services/sync/enqueue.js';
import { throwServerError } from '../../lib/errorCodes.js';
import { writeAuditLog } from '../../services/audit-logs.js';
import {
  assertCashSessionStillOpen,
  getPersistedSaleCashContribution,
  insertCashMovement,
  requireActiveCashSession,
} from '../../services/cash-session.js';
import { safelyEmitFiscalDocument } from '../../services/fiscal/orchestrator.js';
import { createModuleLogger } from '../../logging/logger.js';
import {
  buildReturnedSaleNotes,
  getPersistedCashContribution,
} from './policies.js';
import { reverseSaleItemsStock } from './inventory-policy.js';
import { getOriginalDeeCufe } from './fiscal-policy.js';
import {
  emitCompleteSaleEffects,
  type JournalEffectInput,
} from './journal-effects.js';
import { getSaleRecord } from './sale-read.js';
import { updateOperationSummary } from '../../services/operation-journal/journal.js';
import { resolveTenantLocale } from '../../services/tenant-locale.js';
import type {
  CompleteSaleContext,
  CompleteSaleLogger,
  CompleteSaleResult,
} from './types.js';
import type { CompleteSaleSaleRecord } from './completeSale.js';

const fallbackLog = createModuleLogger('application/sales/returnSale');

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
      and(
        eq(operationEvents.tenantId, tenantId),
        eq(operationEvents.operationId, operationId)
      )
    )
    .get();
  return row?.id ?? null;
}

async function safeUpdateSaleRefundedSummary(
  ctx: CompleteSaleContext,
  log: CompleteSaleLogger,
  journalEventId: string,
  summary: {
    saleReturnId: string;
    originalSaleId: string;
    siteId: string;
    cashSessionId: string;
    refundedAmount: number;
    reasonCode: string | null;
  }
): Promise<void> {
  try {
    const locale = await resolveTenantLocale(ctx.db, ctx.tenantId);
    await updateOperationSummary(ctx.db, journalEventId, {
      ...summary,
      currencyCode: locale.currency,
    });
  } catch (err) {
    log.warn(
      { err, journalEventId },
      'operation summary update failed (non-blocking)'
    );
  }
}

export interface ReturnSaleInput {
  id: string;
  reason?: string | null;
}

export async function returnSale(
  ctx: CompleteSaleContext,
  input: ReturnSaleInput
): Promise<CompleteSaleResult<CompleteSaleSaleRecord>> {
  const log = ctx.log ?? fallbackLog;

  const activeCashSession = await requireActiveCashSession(
    ctx.db,
    ctx.tenantId,
    ctx.siteId,
    ctx.user.id
  );

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
      errorCode: 'SALE_RETURN_VOIDED_FORBIDDEN',
      message: 'Voided sales cannot be refunded',
    });
  }

  if (existing.status !== 'completed') {
    throwServerError({
      trpcCode: 'BAD_REQUEST',
      errorCode: 'SALE_RETURN_NOT_COMPLETED',
      message: 'Only completed sales can be refunded',
    });
  }

  if (existing.paymentStatus === 'refunded') {
    throwServerError({
      trpcCode: 'BAD_REQUEST',
      errorCode: 'SALE_RETURN_ALREADY_REFUNDED',
      message: 'Sale is already refunded',
    });
  }

  const existingReturn = await ctx.db
    .select({ id: saleReturns.id })
    .from(saleReturns)
    .where(
      and(eq(saleReturns.saleId, input.id), eq(saleReturns.tenantId, ctx.tenantId))
    )
    .get();

  if (existingReturn) {
    throwServerError({
      trpcCode: 'BAD_REQUEST',
      errorCode: 'SALE_RETURN_DUPLICATE',
      message: 'Sale already has a recorded refund',
    });
  }

  // ENG-014 — refund of a sale that included a credit tender (split
  // cash + credit, "apartado") requires reversing both the cash
  // movement and the customer-ledger entry, with operator-facing copy
  // for partial reversals. That dedicated flow lives behind a future
  // ticket; until it lands, block the refund here so an operator
  // cannot leave a half-reversed sale in the database.
  const creditTenderRows = await ctx.db
    .select({ id: salePayments.id })
    .from(salePayments)
    .where(
      and(
        eq(salePayments.tenantId, ctx.tenantId),
        eq(salePayments.saleId, input.id),
        eq(salePayments.method, 'credit')
      )
    )
    .all();
  if (creditTenderRows.length > 0) {
    throwServerError({
      trpcCode: 'BAD_REQUEST',
      errorCode: 'REFUND_PARTIAL_CREDIT_NOT_SUPPORTED',
      message: 'Refunds for sales with a credit tender are not yet supported',
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
      message: 'Cannot refund a sale without line items',
    });
  }

  const productIds = [...new Set(saleLineItems.map(item => item.productId))];
  const currentProducts = await ctx.db
    .select({ id: products.id, stock: products.stock })
    .from(products)
    .where(and(eq(products.tenantId, ctx.tenantId), inArray(products.id, productIds)))
    .all();
  const productStockState = new Map(
    currentProducts.map(product => [product.id, product.stock])
  );

  // Phase 2 API-103 — credit back the site that originally sold the stock,
  // not the refunding cashier's active site. Falls back to null for legacy
  // sales without a cash session — `applyInventoryBalanceDelta` treats
  // that as a safe no-op.
  const originalSaleSiteId = existing.cashSessionId
    ? (
        await ctx.db
          .select({ siteId: cashSessions.siteId })
          .from(cashSessions)
          .where(
            and(
              eq(cashSessions.id, existing.cashSessionId),
              eq(cashSessions.tenantId, ctx.tenantId)
            )
          )
          .get()
      )?.siteId ?? null
    : null;

  const nextSyncVersion = (existing.syncVersion ?? 0) + 1;
  const now = new Date().toISOString();
  const refundId = nanoid();
  const refundCashAmount = await getPersistedSaleCashContribution(ctx.db, {
    tenantId: ctx.tenantId,
    saleId: input.id,
    fallbackAmount: getPersistedCashContribution(existing),
  });

  let inventoryMovementIds: string[] = [];
  let cashMovementId: string | null = null;
  let auditLogId: string | null = null;

  ctx.db.transaction(tx => {
    // ENG-042 TOCTOU defense: refunds bind the cash movement to
    // activeCashSession.id; a session closed mid-flight would attach
    // the refund to a closed shift.
    assertCashSessionStillOpen(tx, ctx.tenantId, activeCashSession.id);

    inventoryMovementIds = reverseSaleItemsStock({
      tx,
      tenantId: ctx.tenantId,
      siteId: originalSaleSiteId,
      userId: ctx.user.id,
      saleId: input.id,
      saleNumber: existing.saleNumber,
      reversalKind: 'return',
      items: saleLineItems,
      productStockState,
      now,
    });

    tx.insert(saleReturns)
      .values({
        id: refundId,
        tenantId: ctx.tenantId,
        saleId: input.id,
        refundAmount: existing.total,
        reason: input.reason ?? null,
        createdBy: ctx.user.id,
        syncStatus: 'pending',
        syncVersion: 1,
        createdAt: now,
        updatedAt: now,
      })
      .run();

    tx.update(sales)
      .set({
        paymentStatus: 'refunded',
        notes: buildReturnedSaleNotes(existing.notes, input.reason),
        updatedAt: now,
        syncStatus: 'pending',
        syncVersion: nextSyncVersion,
      })
      .where(and(eq(sales.id, input.id), eq(sales.tenantId, ctx.tenantId)))
      .run();

    cashMovementId = insertCashMovement({
      tx,
      tenantId: ctx.tenantId,
      sessionId: activeCashSession.id,
      type: 'refund',
      amount: refundCashAmount,
      referenceId: input.id,
      note: `Refunded sale ${existing.saleNumber}`,
      createdBy: ctx.user.id,
      createdAt: now,
    });

    // Phase 8 / Tier-2 #8 — refunds are sensitive: stock restored,
    // payment reversed, drawer balance moves. Audit row is in-tx so it
    // is either persisted with the refund or rolls back with it.
    auditLogId = writeAuditLog({
      tx,
      tenantId: ctx.tenantId,
      actorId: ctx.user.id,
      action: 'sale.return',
      resourceType: 'sale',
      resourceId: input.id,
      before: {
        paymentStatus: existing.paymentStatus,
        status: existing.status,
        total: existing.total,
        saleNumber: existing.saleNumber,
      },
      after: {
        paymentStatus: 'refunded',
        refundId,
        refundAmount: existing.total,
      },
      metadata: {
        ...(input.reason ? { reason: input.reason } : {}),
        refundCashSessionId: activeCashSession.id,
      },
    });
  });

  await enqueueSync(ctx, {
    entityType: 'sale_returns',
    entityId: refundId,
    operation: 'create',
    data: {
      id: refundId,
      saleId: input.id,
      refundAmount: existing.total,
      reason: input.reason ?? null,
    },
  });

  await enqueueSync(ctx, {
    entityType: 'sales',
    entityId: input.id,
    operation: 'update',
    data: {
      id: input.id,
      paymentStatus: 'refunded',
      reason: input.reason ?? null,
      returnId: refundId,
    },
  });

  // ENG-020 — emit DIAN credit note (NC) for the refunded sale.
  const originalCufe = await getOriginalDeeCufe(ctx.db, ctx.tenantId, input.id);
  const fiscalResult = await safelyEmitFiscalDocument({
    db: ctx.db,
    tenantId: ctx.tenantId,
    userId: ctx.user.id,
    log,
    source: 'return',
    sourceId: refundId,
    saleId: input.id,
    kind: 'NC',
    originalCufe,
    reasonCode: input.reason ?? undefined,
  });
  const fiscalEmitId = fiscalResult?.id ?? null;

  const updated = await getSaleRecord(ctx.db, ctx.tenantId, input.id);

  const journalEventId = await lookupJournalEventId(
    ctx.db,
    ctx.tenantId,
    ctx.envelope?.operationId
  );
  if (journalEventId) {
    await safeUpdateSaleRefundedSummary(ctx, log, journalEventId, {
      saleReturnId: refundId,
      originalSaleId: input.id,
      siteId: originalSaleSiteId ?? activeCashSession.siteId,
      cashSessionId: activeCashSession.id,
      refundedAmount: existing.total,
      reasonCode: input.reason ?? null,
    });

    const effects: JournalEffectInput[] = [];
    effects.push({
      kind: 'sale_row',
      resourceType: 'sales',
      resourceId: input.id,
      effectData: {
        saleNumber: existing.saleNumber,
        paymentStatus: 'refunded',
        refundId,
      },
    });
    effects.push({
      kind: 'sale_return_row',
      resourceType: 'sale_returns',
      resourceId: refundId,
      effectData: { refundAmount: existing.total },
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
          sessionId: activeCashSession.id,
          amount: refundCashAmount,
        },
      });
    }
    if (auditLogId) {
      effects.push({
        kind: 'audit_log',
        resourceType: 'audit_logs',
        resourceId: auditLogId,
        effectData: { action: 'sale.return' },
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

  return {
    sale: updated as CompleteSaleSaleRecord,
    change: 0,
    journalEventId,
  };
}
