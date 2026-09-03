/**
 * `discardDraft` use-case service.
 *
 * Discards a parked or actively claimed draft sale: validates state +
 * ownership, restores the stock that was debited at draft creation
 * time, flips `status` to `cancelled`, clears the suspension columns,
 * and writes a `sale.park` audit row marked `discarded:true`.
 *
 * Drafts debit stock at create-time (see `completeSale` fresh path,
 * which writes inventory_movements regardless of `status`). Discarding
 * a draft must therefore credit the same quantities back to
 * `inventory_balances` (the single source of truth). Without the reversal,
 * cancelled drafts would permanently leak inventory. The extracted service
 * preserves that exact reversal invariant.
 *
 * No fiscal emission and no cash movement: drafts never produce a
 * fiscal document, and they never move cash either.
 *
 * @module application/sales/discardDraft
 */

import { reconcileKitchenSaleInTransaction } from '../kds/sale-lifecycle.js';
import { and, eq } from 'drizzle-orm';
import type { DatabaseInstance } from '../../db/index.js';
import { operationEvents, saleItems, sales } from '../../db/schema.js';
import { getProductStockTotals } from '../../services/inventory-balances.js';
import { enqueueSyncInTransaction } from '../../services/sync/enqueue.js';
import { throwServerError } from '../../lib/errorCodes.js';
import { writeAuditLog } from '../../services/audit-logs.js';
import { createModuleLogger } from '../../logging/logger.js';
import { reverseSaleItemsStock } from './inventory-policy.js';
import {
  enqueueInventoryLotUpdatesForSaleInTransaction,
  restoreLotsForSale,
} from '../../services/inventory-lots/index.js';
import { emitCompleteSaleEffects, type JournalEffectInput } from './journal-effects.js';
import { transitionSaleSerials } from '../../services/product-serials.js';
import type { CompleteSaleContext } from './types.js';
import {
  assertTenantBusinessClockCurrent,
  resolveTenantBusinessClock,
} from '../../services/pharmacy/business-clock.js';
import { closeRestaurantCheckForSale } from '../restaurant/service-lifecycle.js';
import { resolveDraftSiteEvidence } from './draft-site.js';
import { ownsActiveDraftClaim } from './draft-ownership.js';

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
  const businessClock = await resolveTenantBusinessClock(ctx.db, ctx.tenantId);
  const journalEventId = await lookupJournalEventId(
    ctx.db,
    ctx.tenantId,
    ctx.envelope?.operationId
  );

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
  const canOverride = actorRole === 'manager' || actorRole === 'admin';
  const ownsActiveClaim = ownsActiveDraftClaim(existing, ctx.user.id, ctx.deviceId);
  const ownsParkedDraft =
    existing.suspendedAt !== null &&
    (existing.createdBy === ctx.user.id || existing.suspendedBy === ctx.user.id);
  if (!ownsActiveClaim && !ownsParkedDraft && !canOverride) {
    throwServerError({
      trpcCode: 'FORBIDDEN',
      errorCode: 'SALE_SUSPEND_OWNERSHIP_REQUIRED',
      message: 'Only the cashier who owns this draft can discard it',
      details: { operation: 'discard' },
    });
  }

  const now = businessClock.nowIso;

  let inventoryMovementIds: string[] = [];
  let auditLogId: string | null = null;
  let restoredLotIds: string[] = [];
  let syncOutboxIds: string[] = [];
  let discardedSaleNumber = existing.saleNumber;

  ctx.db.transaction(
    tx => {
      // Own the aggregate before reading its lines or current stock. Without
      // this in-transaction revalidation, a concurrent checkout could commit
      // while this command still reversed the stale draft snapshot.
      const current = tx
        .select()
        .from(sales)
        .where(and(eq(sales.id, input.saleId), eq(sales.tenantId, ctx.tenantId)))
        .get();
      if (!current) {
        throwServerError({
          trpcCode: 'NOT_FOUND',
          errorCode: 'SALE_NOT_FOUND',
          message: 'Sale not found',
        });
      }
      if (current.status !== 'draft') {
        throwServerError({
          trpcCode: 'BAD_REQUEST',
          errorCode: 'SALE_DRAFT_REQUIRED',
          message: 'Only draft sales can be discarded',
          details: { operation: 'discard', actualStatus: current.status },
        });
      }
      const currentOwnsActiveClaim = ownsActiveDraftClaim(current, ctx.user.id, ctx.deviceId);
      const currentOwnsParkedDraft =
        current.suspendedAt !== null &&
        (current.createdBy === ctx.user.id || current.suspendedBy === ctx.user.id);
      if (!currentOwnsActiveClaim && !currentOwnsParkedDraft && !canOverride) {
        throwServerError({
          trpcCode: 'FORBIDDEN',
          errorCode: 'SALE_SUSPEND_OWNERSHIP_REQUIRED',
          message: 'Only the cashier who owns this draft can discard it',
          details: { operation: 'discard' },
        });
      }

      // Re-derive provenance from the aggregate owned by this writer. Neither
      // the operator's selected site nor a future destination can prove where
      // draft inventory was reserved.
      const draftSite = resolveDraftSiteEvidence(tx as unknown as typeof ctx.db, ctx.tenantId, {
        saleId: current.id,
        cashSessionId: current.cashSessionId,
        tableId: current.tableId,
      });
      const authoritativeSaleSiteId = draftSite.siteId;

      const saleLineItems = tx
        .select({
          id: saleItems.id,
          productId: saleItems.productId,
          quantity: saleItems.quantity,
          unitEquivalence: saleItems.unitEquivalence,
          // Read the sale-time snapshot, never the live product flag: the
          // reversal must credit exactly what the sale debited even if the
          // product later changed between service and physical inventory.
          tracksStock: saleItems.tracksStockSnapshot,
        })
        .from(saleItems)
        .where(eq(saleItems.saleId, input.saleId))
        .all()
        .map(row => ({ ...row, tracksStock: row.tracksStock ?? true }));
      discardedSaleNumber = current.saleNumber;
      if (!authoritativeSaleSiteId && saleLineItems.some(item => item.tracksStock)) {
        throwServerError({
          trpcCode: 'CONFLICT',
          errorCode: 'SALE_DRAFT_SITE_UNKNOWN',
          message: 'Stock cannot be restored without verifiable draft site provenance',
          details: { saleId: input.saleId },
        });
      }
      const productStockState =
        saleLineItems.length === 0
          ? new Map<string, number>()
          : getProductStockTotals(tx as unknown as typeof ctx.db, ctx.tenantId, [
              ...new Set(saleLineItems.map(item => item.productId)),
            ]);

      assertTenantBusinessClockCurrent(tx, ctx.tenantId, businessClock);
      if (saleLineItems.length > 0) {
        inventoryMovementIds = reverseSaleItemsStock({
          tx,
          tenantId: ctx.tenantId,
          siteId: authoritativeSaleSiteId,
          userId: ctx.user.id,
          saleId: input.saleId,
          saleNumber: current.saleNumber,
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
          businessDate: businessClock.businessDate,
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

      const cancelled = tx
        .update(sales)
        .set({
          status: 'cancelled',
          suspendedAt: null,
          suspendedBy: null,
          resumedBy: null,
          resumedDeviceId: null,
          suspendedLabel: null,
          syncStatus: 'pending',
          syncVersion: (current.syncVersion ?? 0) + 1,
          updatedAt: now,
        })
        .where(
          and(
            eq(sales.id, input.saleId),
            eq(sales.tenantId, ctx.tenantId),
            eq(sales.status, 'draft')
          )
        )
        .run();
      if (cancelled.changes !== 1) {
        throwServerError({
          trpcCode: 'CONFLICT',
          errorCode: 'SALE_DRAFT_REQUIRED',
          message: 'The draft changed while it was being discarded',
          details: { operation: 'discard', actualStatus: 'stale_snapshot' },
        });
      }

      closeRestaurantCheckForSale(
        tx as unknown as typeof ctx.db,
        {
          tenantId: ctx.tenantId,
          siteId: draftSite.restaurant?.siteId ?? authoritativeSaleSiteId ?? ctx.siteId,
          actorId: ctx.user.id,
          now,
        },
        input.saleId,
        'cancelled'
      );

      auditLogId = writeAuditLog({
        tx,
        tenantId: ctx.tenantId,
        actorId: ctx.user.id,
        action: 'sale.park',
        resourceType: 'sale',
        resourceId: input.saleId,
        before: {
          status: current.status,
          suspendedAt: current.suspendedAt,
          suspendedBy: current.suspendedBy,
          resumedBy: current.resumedBy,
          resumedDeviceId: current.resumedDeviceId,
        },
        after: {
          status: 'cancelled',
          suspendedAt: null,
          suspendedBy: null,
          resumedBy: null,
          resumedDeviceId: null,
        },
        metadata: {
          discarded: true,
          reversedItems: saleLineItems.length,
        },
      });

      const syncContext = {
        db: tx as unknown as typeof ctx.db,
        tenantId: ctx.tenantId,
        envelope: ctx.envelope ?? null,
        deviceId: ctx.deviceId ?? null,
      };
      syncOutboxIds = [
        enqueueSyncInTransaction(syncContext, {
          entityType: 'sales',
          entityId: input.saleId,
          operation: 'update',
          data: {
            id: input.saleId,
            status: 'cancelled',
            discarded: true,
            syncVersion: (current.syncVersion ?? 0) + 1,
          },
        }).id,
        ...enqueueInventoryLotUpdatesForSaleInTransaction(
          syncContext,
          restoredLotIds,
          input.saleId
        ),
      ];
      reconcileKitchenSaleInTransaction(
        tx as unknown as typeof ctx.db,
        { tenantId: ctx.tenantId, siteId: authoritativeSaleSiteId ?? '', actorId: ctx.user.id },
        input.saleId,
        'discard'
      );
      ctx.completeInTransaction?.(tx as unknown as typeof ctx.db, {
        id: input.saleId,
        status: 'cancelled',
      });
    },
    { behavior: 'immediate' }
  );
  if (journalEventId) {
    const effects: JournalEffectInput[] = [];
    effects.push({
      kind: 'sale_row',
      resourceType: 'sales',
      resourceId: input.saleId,
      effectData: {
        saleNumber: discardedSaleNumber,
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
    for (const outboxId of syncOutboxIds) {
      effects.push({
        kind: 'outbox_enqueue:sync',
        resourceType: 'sync_outbox',
        resourceId: outboxId,
      });
    }
    await emitCompleteSaleEffects(ctx.db, log, journalEventId, effects);
  }

  return {
    id: input.saleId,
    status: 'cancelled',
    journalEventId,
  };
}
