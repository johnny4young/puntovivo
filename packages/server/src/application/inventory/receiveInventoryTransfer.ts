/**
 * Inventory-transfer receive orchestrator + its line-resolution helper.
 *
 * ENG-206 — promoted from services into the application use-case boundary.
 * `resolveReceivedQuantitiesByItemId` is receive-only, so it is co-located
 * here rather than in the shared `helpers.ts`.
 *
 * @module application/inventory/receiveInventoryTransfer
 */
import { and, eq } from 'drizzle-orm';

import type { DatabaseInstance } from '../../db/index.js';
import {
  inventoryBalances,
  products,
  transferOrderItems,
  transferOrders,
  type TransferOrderStatus,
} from '../../db/schema.js';
import { throwServerError } from '../../lib/errorCodes.js';
import { getPrimarySiteId, getProductStockTotal } from '../../services/inventory-balances.js';
import { assertAggregateStockMutationAllowed } from '../../services/products/lot-tracking.js';
import { getTimestamp, seedMissingBalanceRow } from '../../services/inventory-transfers/helpers.js';
import type {
  ReceiveTransferArgs,
  ReceiveTransferLine,
  ReceivedTransfer,
} from '../../services/inventory-transfers/types.js';

/**
 * Completes a deferred (in_transit) transfer by crediting the destination
 * site and flipping the transfer status to `completed`. Called when the
 * shipment physically arrives at the destination.
 *
 * Rejects with `TRANSFER_NOT_FOUND` if the id doesn't exist for the tenant
 * and `TRANSFER_NOT_IN_TRANSIT` if the transfer is in any state other than
 * `in_transit` (completed transfers were already credited; voided transfers
 * have been reversed).
 */
function resolveReceivedQuantitiesByItemId(
  items: ReadonlyArray<{ id: string; quantity: number }>,
  lines: readonly ReceiveTransferLine[] | undefined
): Map<string, number> {
  if (!lines || lines.length === 0) {
    return new Map(items.map(item => [item.id, item.quantity]));
  }

  const shippedById = new Map(items.map(item => [item.id, item.quantity]));
  const resolved = new Map<string, number>();

  for (const line of lines) {
    const shipped = shippedById.get(line.itemId);
    if (shipped === undefined) {
      throwServerError({
        trpcCode: 'BAD_REQUEST',
        errorCode: 'TRANSFER_RECEIVE_LINE_MISMATCH',
        message: 'Receive payload references a line that does not belong to this transfer',
        details: { itemId: line.itemId },
      });
    }
    if (resolved.has(line.itemId)) {
      // Duplicate ids would otherwise silently collapse — reject so the UI
      // can't accidentally double-credit a line.
      throwServerError({
        trpcCode: 'BAD_REQUEST',
        errorCode: 'TRANSFER_RECEIVE_LINE_MISMATCH',
        message: 'Receive payload contains duplicate line entries',
        details: { itemId: line.itemId },
      });
    }
    if (line.receivedQuantity > shipped) {
      throwServerError({
        trpcCode: 'BAD_REQUEST',
        errorCode: 'TRANSFER_RECEIVED_EXCEEDS_SHIPPED',
        message: 'Received quantity cannot exceed the shipped quantity',
        details: {
          itemId: line.itemId,
          shipped,
          received: line.receivedQuantity,
        },
      });
    }
    resolved.set(line.itemId, line.receivedQuantity);
  }

  // Any line not addressed by the caller defaults to the shipped quantity.
  for (const item of items) {
    if (!resolved.has(item.id)) {
      resolved.set(item.id, item.quantity);
    }
  }

  return resolved;
}

export function receiveInventoryTransfer(
  db: DatabaseInstance,
  args: ReceiveTransferArgs
): ReceivedTransfer {
  const now = getTimestamp();
  const trimmedDiscrepancyNotes = args.discrepancyNotes?.trim();
  const normalizedDiscrepancyNotes =
    trimmedDiscrepancyNotes && trimmedDiscrepancyNotes.length > 0 ? trimmedDiscrepancyNotes : null;

  return db.transaction(tx => {
    const transfer = tx
      .select({
        id: transferOrders.id,
        status: transferOrders.status,
        fromSiteId: transferOrders.fromSiteId,
        toSiteId: transferOrders.toSiteId,
      })
      .from(transferOrders)
      .where(
        and(eq(transferOrders.id, args.transferId), eq(transferOrders.tenantId, args.tenantId))
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

    if (transfer.status !== 'in_transit') {
      throwServerError({
        trpcCode: 'BAD_REQUEST',
        errorCode: 'TRANSFER_NOT_IN_TRANSIT',
        message: 'Only transfers currently in transit can be received',
        details: { transferId: args.transferId, status: transfer.status },
      });
    }

    const items = tx
      .select({
        id: transferOrderItems.id,
        productId: transferOrderItems.productId,
        quantity: transferOrderItems.quantity,
        tracksLots: products.tracksLots,
        catalogType: products.catalogType,
      })
      .from(transferOrderItems)
      .innerJoin(products, eq(transferOrderItems.productId, products.id))
      .where(eq(transferOrderItems.transferOrderId, args.transferId))
      .all();

    const receivedByItemId = resolveReceivedQuantitiesByItemId(items, args.lines);

    const primarySiteId = getPrimarySiteId(tx, args.tenantId);

    const receivedItems: ReceivedTransfer['receivedItems'] = [];
    let hasDiscrepancy = false;

    for (const item of items) {
      const receivedQuantity = receivedByItemId.get(item.id) ?? item.quantity;
      assertAggregateStockMutationAllowed({
        tracksLots: item.tracksLots,
        catalogType: item.catalogType,
        delta: receivedQuantity,
      });
      if (receivedQuantity !== item.quantity) {
        hasDiscrepancy = true;
      }

      // Seed the destination row even when received is zero so the drawer
      // stays consistent (every line gets a row) and subsequent voids can
      // safely read it.
      seedMissingBalanceRow({
        tx,
        tenantId: args.tenantId,
        siteId: transfer.toSiteId,
        productId: item.productId,
        initialOnHand:
          transfer.toSiteId === primarySiteId
            ? getProductStockTotal(tx, args.tenantId, item.productId)
            : 0,
        now,
      });

      if (receivedQuantity > 0) {
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

        tx.update(inventoryBalances)
          .set({
            onHand: (destinationBalance?.onHand ?? 0) + receivedQuantity,
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

      tx.update(transferOrderItems)
        .set({ receivedQuantity })
        .where(eq(transferOrderItems.id, item.id))
        .run();

      // A partial receive intentionally shrinks total stock by
      // (shipped - received): origin was debited the full shipped quantity at
      // create time but the destination is only credited the received
      // quantity. The tenant-wide total is derived from Σ(balances) on read,
      // so no cache needs recomputing here.

      receivedItems.push({ productId: item.productId, quantity: receivedQuantity });
    }

    const persistedDiscrepancyNotes = hasDiscrepancy ? normalizedDiscrepancyNotes : null;

    tx.update(transferOrders)
      .set({
        status: 'completed',
        receivedAt: now,
        receivedBy: args.receivedBy,
        discrepancyNotes: persistedDiscrepancyNotes,
        syncStatus: 'pending',
        updatedAt: now,
      })
      .where(
        and(eq(transferOrders.id, args.transferId), eq(transferOrders.tenantId, args.tenantId))
      )
      .run();

    return {
      id: args.transferId,
      status: 'completed' as TransferOrderStatus,
      fromSiteId: transfer.fromSiteId,
      toSiteId: transfer.toSiteId,
      receivedAt: now,
      receivedBy: args.receivedBy,
      receivedItems,
      hasDiscrepancy,
      discrepancyNotes: persistedDiscrepancyNotes,
    };
  });
}
