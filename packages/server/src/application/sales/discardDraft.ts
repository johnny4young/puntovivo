/**
 * `discardDraft` use-case service.
 *
 * Discards a suspended (or orphan) draft sale: validates state +
 * ownership, restores the stock that was debited at draft creation
 * time, flips `status` to `cancelled`, clears the suspension columns,
 * and writes a `sale.park` audit row marked `discarded:true`.
 *
 * Drafts debit stock at create-time (see `completeSale` fresh path,
 * which writes inventory_movements regardless of `status`). Discarding
 * a draft must therefore credit the same quantities back to
 * `inventory_balances` (the single source of truth). Without the reversal,
 * cancelled drafts would permanently leak inventory —  fixed
 * a latent bug here,  just preserves the same fix in the
 * extracted service.
 *
 * No fiscal emission and no cash movement: drafts never produce a
 * fiscal document, and they never move cash either.
 *
 * @module application/sales/discardDraft
 */

import { and, eq } from 'drizzle-orm';
import type { DatabaseInstance } from '../../db/index.js';
import { cashSessions, operationEvents, saleItems, sales } from '../../db/schema.js';
import { getProductStockTotals } from '../../services/inventory-balances.js';
import { enqueueSync } from '../../services/sync/enqueue.js';
import { removeKdsOrders } from '../../services/kds/remove.js';
import { throwServerError } from '../../lib/errorCodes.js';
import { writeAuditLog } from '../../services/audit-logs.js';
import { createModuleLogger } from '../../logging/logger.js';
import { reverseSaleItemsStock } from './inventory-policy.js';
import {
  enqueueInventoryLotUpdatesForSale,
  restoreLotsForSale,
} from '../../services/inventory-lots/index.js';
import { emitCompleteSaleEffects, type JournalEffectInput } from './journal-effects.js';
import { transitionSaleSerials } from '../../services/product-serials.js';
import type { CompleteSaleContext } from './types.js';

const fallbackLog = createModuleLogger('application/sales/discardDraft');

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

export interface DiscardDraftInput {
  saleId: string;
}

export interface DiscardDraftResult {
  id: string;
  status: 'cancelled';
  /**
   * Journal `operation_events` row id when the call carried an
   * envelope; null otherwise.
   */
  journalEventId: string | null;
}

export async function discardDraft(
  ctx: CompleteSaleContext,
  input: DiscardDraftInput
): Promise<DiscardDraftResult> {
  const log = ctx.log ?? fallbackLog;

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
      message: 'Only draft sales can be discarded',
      details: { operation: 'discard', actualStatus: existing.status },
    });
  }

  const actorRole = ctx.user.role;
  const isCreator = existing.createdBy === ctx.user.id;
  const isSuspender = existing.suspendedBy === ctx.user.id;
  const canOverride = actorRole === 'manager' || actorRole === 'admin';
  if (!isCreator && !isSuspender && !canOverride) {
    throwServerError({
      trpcCode: 'FORBIDDEN',
      errorCode: 'SALE_SUSPEND_OWNERSHIP_REQUIRED',
      message: 'Only the cashier who created or suspended this draft can discard it',
      details: { operation: 'discard' },
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
    .where(eq(saleItems.saleId, input.saleId))
    .all();

  // Empty drafts exist (cashier created a blank draft, then changed
  // their mind). Discarding one is a no-op on stock; status flip + audit
  // still happen.
  const hasItems = saleLineItems.length > 0;

  // Resolve the original cash session's siteId so the inventory balance
  // credit lands on the site that was debited. Falls back to null for
  // drafts with no cash session link (legacy or orphan).
  const originalSaleSiteId = existing.cashSessionId
    ? ((
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
      )?.siteId ?? null)
    : null;

  const productStockState = hasItems
    ? getProductStockTotals(ctx.db, ctx.tenantId, [
        ...new Set(saleLineItems.map(item => item.productId)),
      ])
    : new Map<string, number>();
  const nextSyncVersion = (existing.syncVersion ?? 0) + 1;
  const now = new Date().toISOString();

  let inventoryMovementIds: string[] = [];
  let auditLogId: string | null = null;
  let restoredLotIds: string[] = [];

  ctx.db.transaction(tx => {
    if (hasItems) {
      inventoryMovementIds = reverseSaleItemsStock({
        tx,
        tenantId: ctx.tenantId,
        siteId: originalSaleSiteId,
        userId: ctx.user.id,
        saleId: input.saleId,
        saleNumber: existing.saleNumber,
        reversalKind: 'discard',
        items: saleLineItems,
        productStockState,
        now,
      });
      // Auditoría 2026-07 — restore consumed lots on draft discard.
      restoredLotIds = restoreLotsForSale(tx, {
        tenantId: ctx.tenantId,
        saleId: input.saleId,
        now,
      }).lotIds;
      transitionSaleSerials(tx as unknown as typeof ctx.db, {
        tenantId: ctx.tenantId,
        saleItemIds: saleLineItems.map(item => item.id),
        from: 'reserved',
        to: 'in_stock',
        clearSaleItem: true,
        now,
        syncContext: { ...ctx, db: tx as unknown as typeof ctx.db },
      });
    }

    tx.update(sales)
      .set({
        status: 'cancelled',
        suspendedAt: null,
        suspendedBy: null,
        suspendedLabel: null,
        syncStatus: 'pending',
        syncVersion: nextSyncVersion,
        updatedAt: now,
      })
      .where(and(eq(sales.id, input.saleId), eq(sales.tenantId, ctx.tenantId)))
      .run();

    auditLogId = writeAuditLog({
      tx,
      tenantId: ctx.tenantId,
      actorId: ctx.user.id,
      action: 'sale.park',
      resourceType: 'sale',
      resourceId: input.saleId,
      before: {
        status: existing.status,
        suspendedAt: existing.suspendedAt,
        suspendedBy: existing.suspendedBy,
      },
      after: { status: 'cancelled' },
      metadata: {
        discarded: true,
        reversedItems: saleLineItems.length,
      },
    });
  });

  await enqueueSync(ctx, {
    entityType: 'sales',
    entityId: input.saleId,
    operation: 'update',
    data: { id: input.saleId, status: 'cancelled', discarded: true },
  });

  // enqueue the lots the discard credited back so the mutation
  // reaches sync_outbox.
  await enqueueInventoryLotUpdatesForSale(ctx, restoredLotIds, input.saleId);

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
      resourceId: input.saleId,
      effectData: {
        saleNumber: existing.saleNumber,
        status: 'cancelled',
        discarded: true,
      },
    });
    for (const movementId of inventoryMovementIds) {
      effects.push({
        kind: 'inventory_movement',
        resourceType: 'inventory_movements',
        resourceId: movementId,
      });
    }
    if (auditLogId) {
      effects.push({
        kind: 'audit_log',
        resourceType: 'audit_logs',
        resourceId: auditLogId,
        effectData: { action: 'sale.park', discarded: true },
      });
    }
    await emitCompleteSaleEffects(ctx.db, log, journalEventId, effects);
  }

  // drop any kitchen card for the discarded draft so the
  // cook does not keep cooking food for a sale the cashier killed.
  // No-op when no card exists.
  await removeKdsOrders({
    ctx: {
      db: ctx.db,
      tenantId: ctx.tenantId,
      siteId: ctx.siteId || null,
      user: { id: ctx.user.id },
      sse: ctx.sse ?? null,
      log: ctx.log,
    },
    saleId: input.saleId,
    reason: 'discard',
  });

  return {
    id: input.saleId,
    status: 'cancelled',
    journalEventId,
  };
}
