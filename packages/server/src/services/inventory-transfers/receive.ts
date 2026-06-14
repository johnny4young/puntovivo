/**
 * Inventory-transfer receive orchestrator + its line-resolution helper.
 *
 * ENG-178 — extracted verbatim from the former flat
 * `services/inventory-transfers.ts` during the megafile decomposition.
 * `resolveReceivedQuantitiesByItemId` is receive-only, so it is co-located
 * here rather than in the shared `helpers.ts`.
 *
 * @module services/inventory-transfers/receive
 */
import { and, eq, inArray } from 'drizzle-orm';

import type { DatabaseInstance } from '../../db/index.js';
import {
  inventoryBalances,
  products,
  transferOrderItems,
  transferOrders,
  type TransferOrderStatus,
} from '../../db/schema.js';
import { throwServerError } from '../../lib/errorCodes.js';
import {
  getPrimarySiteId,
  syncProductStockFromBalances,
} from '../inventory-balances.js';
import { getTimestamp, seedMissingBalanceRow } from './helpers.js';
import type { ReceiveTransferArgs, ReceiveTransferLine, ReceivedTransfer } from './types.js';

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
    trimmedDiscrepancyNotes && trimmedDiscrepancyNotes.length > 0
      ? trimmedDiscrepancyNotes
      : null;

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
      })
      .from(transferOrderItems)
      .where(eq(transferOrderItems.transferOrderId, args.transferId))
      .all();

    const receivedByItemId = resolveReceivedQuantitiesByItemId(items, args.lines);

    const primarySiteId = getPrimarySiteId(tx, args.tenantId);
    const productStockById = new Map(
      tx
        .select({ id: products.id, stock: products.stock })
        .from(products)
        .where(
          and(
            eq(products.tenantId, args.tenantId),
            inArray(
              products.id,
              items.map(item => item.productId)
            )
          )
        )
        .all()
        .map(product => [product.id, product.stock])
    );

    const receivedItems: ReceivedTransfer['receivedItems'] = [];
    let hasDiscrepancy = false;

    for (const item of items) {
      const receivedQuantity = receivedByItemId.get(item.id) ?? item.quantity;
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
            ? (productStockById.get(item.productId) ?? 0)
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

      // Products.stock drifts by (shipped - received) because origin was
      // debited the full shipped quantity at create time but destination only
      // gets credited the received quantity. Recompute from Σ(balances) to
      // keep the cache honest (intentional shrinkage).
      syncProductStockFromBalances(tx, {
        tenantId: args.tenantId,
        productId: item.productId,
        now,
      });

      receivedItems.push({ productId: item.productId, quantity: receivedQuantity });
    }

    const persistedDiscrepancyNotes = hasDiscrepancy
      ? normalizedDiscrepancyNotes
      : null;

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
        and(
          eq(transferOrders.id, args.transferId),
          eq(transferOrders.tenantId, args.tenantId)
        )
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
