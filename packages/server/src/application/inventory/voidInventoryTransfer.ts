/**
 * Inventory-transfer void (reversal) orchestrator.
 *
 * ENG-206 — promoted from services into the application use-case boundary.
 *
 * @module application/inventory/voidInventoryTransfer
 */
import { and, eq } from 'drizzle-orm';

import type { DatabaseInstance } from '../../db/index.js';
import {
  inventoryBalances,
  transferOrderItems,
  transferOrders,
  type TransferOrderStatus,
} from '../../db/schema.js';
import { throwServerError } from '../../lib/errorCodes.js';
import { writeAuditLog } from '../../services/audit-logs.js';
import { getPrimarySiteId, getProductStockTotal } from '../../services/inventory-balances.js';
import {
  getTimestamp,
  seedMissingBalanceRow,
} from '../../services/inventory-transfers/helpers.js';
import type {
  VoidTransferArgs,
  VoidedTransfer,
} from '../../services/inventory-transfers/types.js';

/**
 * Voids a completed transfer by reversing every line item:
 *   - Destination `on_hand` is decremented by the item quantity.
 *   - Origin `on_hand` is incremented by the same quantity.
 * The transfer row's `status` becomes `void`.
 *
 * Rejects with `TRANSFER_ALREADY_VOID` if the transfer is already voided, and
 * with `TRANSFER_VOID_INSUFFICIENT_STOCK` if a later write (sale, outbound
 * transfer) already consumed the destination's balance — the operator must
 * bring stock back first before the void can be applied.
 */
export function voidInventoryTransfer(
  db: DatabaseInstance,
  args: VoidTransferArgs
): VoidedTransfer {
  const now = getTimestamp();

  return db.transaction(tx => {
    const transfer = tx
      .select({
        id: transferOrders.id,
        status: transferOrders.status,
        fromSiteId: transferOrders.fromSiteId,
        toSiteId: transferOrders.toSiteId,
        notes: transferOrders.notes,
      })
      .from(transferOrders)
      .where(
        and(
          eq(transferOrders.id, args.transferId),
          eq(transferOrders.tenantId, args.tenantId)
        )
      )
      .get();

    if (!transfer) {
      throwServerError({
        trpcCode: 'NOT_FOUND',
        errorCode: 'TRANSFER_NOT_FOUND',
        message: 'Transfer not found',
        details: { transferId: args.transferId },
      });
    }

    if (transfer.status === 'void') {
      throwServerError({
        trpcCode: 'BAD_REQUEST',
        errorCode: 'TRANSFER_ALREADY_VOID',
        message: 'Transfer is already void',
        details: { transferId: args.transferId },
      });
    }

    const items = tx
      .select({
        productId: transferOrderItems.productId,
        quantity: transferOrderItems.quantity,
        receivedQuantity: transferOrderItems.receivedQuantity,
      })
      .from(transferOrderItems)
      .where(eq(transferOrderItems.transferOrderId, args.transferId))
      .all();

    // The destination debit on void matches whatever was credited at receive
    // time. Legacy rows (pre-UI-103) have receivedQuantity = null → coalesce
    // to the shipped quantity to preserve existing void semantics.
    const itemsWithReversal = items.map(item => ({
      ...item,
      destinationDebit: item.receivedQuantity ?? item.quantity,
    }));

    const primarySiteId = getPrimarySiteId(tx, args.tenantId);

    const wasInTransit = transfer.status === 'in_transit';

    // Pre-validate destination stock only when the destination was previously
    // credited (i.e. status was `completed`). Deferred transfers that are
    // still `in_transit` never touched the destination, so there is nothing
    // to reverse on that side.
    const validatedDestinationOnHand = new Map<string, number>();
    if (!wasInTransit) {
      for (const item of itemsWithReversal) {
        if (item.destinationDebit <= 0) {
          // A received=0 line never touched the destination, so there is
          // nothing to validate or debit. Still reachable for fully-lost
          // shipments where the receiver recorded a zero on every line.
          validatedDestinationOnHand.set(item.productId, 0);
          continue;
        }

        const destinationBalance = tx
          .select({ onHand: inventoryBalances.onHand })
          .from(inventoryBalances)
          .where(
            and(
              eq(inventoryBalances.tenantId, args.tenantId),
              eq(inventoryBalances.siteId, transfer.toSiteId),
              eq(inventoryBalances.productId, item.productId)
            )
          )
          .get();

        const available = destinationBalance?.onHand ?? 0;
        if (!destinationBalance || available < item.destinationDebit) {
          throwServerError({
            trpcCode: 'BAD_REQUEST',
            errorCode: 'TRANSFER_VOID_INSUFFICIENT_STOCK',
            message: 'Destination site does not have enough stock to reverse the transfer',
            details: {
              transferId: args.transferId,
              productId: item.productId,
              destinationSiteId: transfer.toSiteId,
              available,
              required: item.destinationDebit,
            },
          });
        }
        validatedDestinationOnHand.set(item.productId, available);
      }
    }

    const reversedItems: VoidedTransfer['reversedItems'] = [];

    for (const item of itemsWithReversal) {
      if (!wasInTransit && item.destinationDebit > 0) {
        // Decrement destination using the pre-validated value — a single read
        // per item keeps the math consistent and avoids a reachable path to a
        // negative balance if the row was somehow removed between loops.
        const destinationOnHand = validatedDestinationOnHand.get(item.productId)!;

        tx.update(inventoryBalances)
          .set({
            onHand: destinationOnHand - item.destinationDebit,
            syncStatus: 'pending',
            updatedAt: now,
          })
          .where(
            and(
              eq(inventoryBalances.tenantId, args.tenantId),
              eq(inventoryBalances.siteId, transfer.toSiteId),
              eq(inventoryBalances.productId, item.productId)
            )
          )
          .run();
      }

      // Credit origin — ensure the row exists first. Applies for BOTH
      // completed and in_transit voids, since origin was always debited on
      // create.
      seedMissingBalanceRow({
        tx,
        tenantId: args.tenantId,
        siteId: transfer.fromSiteId,
        productId: item.productId,
        initialOnHand:
          transfer.fromSiteId === primarySiteId
            ? getProductStockTotal(tx, args.tenantId, item.productId)
            : 0,
        now,
      });

      const originBalance = tx
        .select({ onHand: inventoryBalances.onHand })
        .from(inventoryBalances)
        .where(
          and(
            eq(inventoryBalances.tenantId, args.tenantId),
            eq(inventoryBalances.siteId, transfer.fromSiteId),
            eq(inventoryBalances.productId, item.productId)
          )
        )
        .get();

      tx.update(inventoryBalances)
        .set({
          onHand: (originBalance?.onHand ?? 0) + item.quantity,
          syncStatus: 'pending',
          updatedAt: now,
        })
        .where(
          and(
            eq(inventoryBalances.tenantId, args.tenantId),
            eq(inventoryBalances.siteId, transfer.fromSiteId),
            eq(inventoryBalances.productId, item.productId)
          )
        )
        .run();

      // `inventory_balances` is the single source of truth; the tenant-wide
      // total is derived on read, so there is no cache to recompute here.

      reversedItems.push({ productId: item.productId, quantity: item.quantity });
    }

    // Flip the transfer row to `void`. Preserve existing notes and append
    // a void reason when provided.
    const voidReason = args.reason?.trim();
    const mergedNotes = voidReason
      ? transfer.notes
        ? `${transfer.notes}\n[VOID] ${voidReason}`
        : `[VOID] ${voidReason}`
      : transfer.notes;

    tx.update(transferOrders)
      .set({
        status: 'void',
        notes: mergedNotes,
        syncStatus: 'pending',
        updatedAt: now,
      })
      .where(
        and(
          eq(transferOrders.id, args.transferId),
          eq(transferOrders.tenantId, args.tenantId)
        )
      )
      .run();

    // Phase 8 / Tier-2 #8 — audit this sensitive operation. Inside the same
    // transaction so either both the void and the audit row land, or neither.
    writeAuditLog({
      tx,
      tenantId: args.tenantId,
      actorId: args.voidedBy,
      action: 'transfer.void',
      resourceType: 'transfer_order',
      resourceId: args.transferId,
      before: {
        status: transfer.status,
        fromSiteId: transfer.fromSiteId,
        toSiteId: transfer.toSiteId,
        notes: transfer.notes,
      },
      after: {
        status: 'void',
        notes: mergedNotes,
      },
      metadata: voidReason ? { reason: voidReason } : null,
    });

    return {
      id: args.transferId,
      status: 'void' as TransferOrderStatus,
      fromSiteId: transfer.fromSiteId,
      toSiteId: transfer.toSiteId,
      voidedAt: now,
      voidedBy: args.voidedBy,
      reversedItems,
    };
  });
}
