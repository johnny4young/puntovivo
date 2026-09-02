/**
 * Inventory-transfer receive orchestrator + its line-resolution helper.
 *
 * promoted from services into the application use-case boundary.
 * `resolveReceivedQuantitiesByItemId` is receive-only, so it is co-located
 * here rather than in the shared `helpers.ts`.
 *
 * @module application/inventory/receiveInventoryTransfer
 */
import { roundQuantity } from '@puntovivo/shared/unit-math';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { nanoid } from 'nanoid';

import type { DatabaseInstance } from '../../db/index.js';
import {
  inventoryBalances,
  inventoryMovements,
  products,
  sites,
  transferOrderItemLots,
  transferOrderItems,
  transferOrders,
  type TransferOrderStatus,
} from '../../db/schema.js';
import { throwServerError } from '../../lib/errorCodes.js';
import { QUANTITY_EPSILON } from '../../lib/quantity.js';
import { writeAuditLog } from '../../services/audit-logs.js';
import {
  assertAggregateStockMutationAllowed,
  assertServiceStockMutationAllowed,
} from '../../services/products/lot-tracking.js';
import { receiveTransferredProductSerials } from '../../services/product-serials.js';
import {
  getTimestamp,
  requireFiniteTransferQuantity,
  seedMissingBalanceRow,
} from '../../services/inventory-transfers/helpers.js';
import type {
  ReceiveTransferArgs,
  ReceiveTransferLine,
  ReceivedTransfer,
} from '../../services/inventory-transfers/types.js';
import { receiveTransferItemLots } from './transferLots.js';
import { getInventoryTransferSyncAggregate } from '../../services/inventory-transfers/index.js';
import { enqueueSyncInTransaction } from '../../services/sync/enqueue.js';
import {
  assertLotTrackingMatchesProvenance,
  enqueueInventoryLotSnapshotsInTransaction,
} from '../../services/inventory-lots/index.js';

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
    const receivedQuantity = requireFiniteTransferQuantity(
      line.receivedQuantity,
      { itemId: line.itemId, received: line.receivedQuantity },
      'BAD_REQUEST'
    );
    if (receivedQuantity < 0) {
      throwServerError({
        trpcCode: 'BAD_REQUEST',
        errorCode: 'INVENTORY_QUANTITY_OUT_OF_RANGE',
        message: 'Received quantity must be non-negative',
        details: { itemId: line.itemId, received: receivedQuantity },
      });
    }
    if (receivedQuantity - shipped > QUANTITY_EPSILON) {
      throwServerError({
        trpcCode: 'BAD_REQUEST',
        errorCode: 'TRANSFER_RECEIVED_EXCEEDS_SHIPPED',
        message: 'Received quantity cannot exceed the shipped quantity',
        details: {
          itemId: line.itemId,
          shipped,
          received: receivedQuantity,
        },
      });
    }
    resolved.set(
      line.itemId,
      receivedQuantity <= QUANTITY_EPSILON
        ? 0
        : Math.abs(receivedQuantity - shipped) <= QUANTITY_EPSILON
          ? shipped
          : roundQuantity(receivedQuantity, 12)
    );
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

  return db.transaction(
    tx => {
      const transfer = tx
        .select({
          id: transferOrders.id,
          status: transferOrders.status,
          fromSiteId: transferOrders.fromSiteId,
          toSiteId: transferOrders.toSiteId,
          syncVersion: transferOrders.syncVersion,
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
          tracksStock: products.tracksStock,
          tracksLots: products.tracksLots,
          tracksSerials: products.tracksSerials,
          catalogType: products.catalogType,
        })
        .from(transferOrderItems)
        .innerJoin(
          products,
          and(eq(transferOrderItems.productId, products.id), eq(products.tenantId, args.tenantId))
        )
        .where(eq(transferOrderItems.transferOrderId, args.transferId))
        .all();
      const itemIds = items.map(item => item.id);
      const lotProvenanceItemIds = new Set(
        itemIds.length === 0
          ? []
          : tx
              .select({ transferOrderItemId: transferOrderItemLots.transferOrderItemId })
              .from(transferOrderItemLots)
              .where(
                and(
                  eq(transferOrderItemLots.tenantId, args.tenantId),
                  inArray(transferOrderItemLots.transferOrderItemId, itemIds)
                )
              )
              .all()
              .map(row => row.transferOrderItemId)
      );

      const receivedByItemId = resolveReceivedQuantitiesByItemId(items, args.lines);

      const transferSites = tx
        .select({ id: sites.id, name: sites.name })
        .from(sites)
        .where(
          and(
            eq(sites.tenantId, args.tenantId),
            inArray(sites.id, [transfer.fromSiteId, transfer.toSiteId])
          )
        )
        .all();
      const transferSiteById = new Map(transferSites.map(site => [site.id, site]));

      const receivedItems: ReceivedTransfer['receivedItems'] = [];
      const movementIds: string[] = [];
      const mutatedLotIds: string[] = [];
      let hasDiscrepancy = false;
      let totalQuantityShipped = 0;
      let totalQuantityReceived = 0;

      for (const item of items) {
        let receivedQuantity = receivedByItemId.get(item.id) ?? item.quantity;
        let destinationResultingBalanceVersion: number | null = null;
        totalQuantityShipped = requireFiniteTransferQuantity(
          roundQuantity(totalQuantityShipped + item.quantity, 12),
          { transferId: args.transferId, itemId: item.id }
        );
        assertServiceStockMutationAllowed({
          tracksStock: item.tracksStock,
          delta: receivedQuantity,
        });
        assertLotTrackingMatchesProvenance({
          tracksLots: item.tracksLots,
          hasLotProvenance: lotProvenanceItemIds.has(item.id),
          referenceId: item.id,
        });
        if (item.tracksSerials) {
          if (receivedQuantity !== item.quantity) {
            throwServerError({
              trpcCode: 'BAD_REQUEST',
              errorCode: 'PRODUCT_SERIAL_SELECTION_REQUIRED',
              message:
                'Serialized transfers must be received by exact identity without quantity variance',
            });
          }
          receiveTransferredProductSerials(tx as unknown as DatabaseInstance, {
            tenantId: args.tenantId,
            transferOrderItemId: item.id,
            productId: item.productId,
            fromSiteId: transfer.fromSiteId,
            toSiteId: transfer.toSiteId,
            quantity: item.quantity,
            now,
            syncContext: args.syncContext
              ? { ...args.syncContext, db: tx as unknown as DatabaseInstance }
              : undefined,
          });
        } else if (item.tracksLots) {
          const requestedLine = args.lines?.find(line => line.itemId === item.id);
          if (requestedLine && !requestedLine.lotAllocations) {
            throwServerError({
              trpcCode: 'BAD_REQUEST',
              errorCode: 'LOT_ALLOCATION_REQUIRED',
              message: 'A lot-tracked receipt must confirm every shipped lot quantity',
            });
          }
          const lotReceipt = receiveTransferItemLots(tx as unknown as DatabaseInstance, {
            tenantId: args.tenantId,
            toSiteId: transfer.toSiteId,
            transferOrderItemId: item.id,
            productId: item.productId,
            requested: requestedLine?.lotAllocations,
            now,
          });
          if (Math.abs(lotReceipt.receivedQuantity - receivedQuantity) > QUANTITY_EPSILON) {
            throwServerError({
              trpcCode: 'BAD_REQUEST',
              errorCode: 'LOT_ALLOCATION_QUANTITY_MISMATCH',
              message: 'Received lot quantities must equal the transfer line receipt quantity',
              details: {
                itemId: item.id,
                allocated: lotReceipt.receivedQuantity,
                required: receivedQuantity,
              },
            });
          }
          receivedQuantity = lotReceipt.receivedQuantity;
          mutatedLotIds.push(...lotReceipt.destinationLotIds);
        } else {
          assertAggregateStockMutationAllowed({
            tracksStock: item.tracksStock,
            tracksLots: item.tracksLots,
            tracksSerials: false,
            catalogType: item.catalogType,
            delta: receivedQuantity,
          });
        }
        // Lot receipt can canonicalize sub-operational residue to zero. Audit
        // and shortage totals must use the same persisted quantity as the line,
        // not the pre-validation request approximation.
        totalQuantityReceived = requireFiniteTransferQuantity(
          roundQuantity(totalQuantityReceived + receivedQuantity, 12),
          { transferId: args.transferId, itemId: item.id }
        );
        if (Math.abs(receivedQuantity - item.quantity) > QUANTITY_EPSILON) {
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
          initialOnHand: 0,
          now,
        });

        if (receivedQuantity > 0) {
          const destinationBalance = tx
            .select({ onHand: inventoryBalances.onHand, version: inventoryBalances.version })
            .from(inventoryBalances)
            .where(
              and(
                eq(inventoryBalances.tenantId, args.tenantId),
                eq(inventoryBalances.siteId, transfer.toSiteId),
                eq(inventoryBalances.productId, item.productId)
              )
            )
            .get();
          const previousDestinationOnHand = requireFiniteTransferQuantity(
            destinationBalance?.onHand ?? 0,
            { productId: item.productId, siteId: transfer.toSiteId }
          );
          destinationResultingBalanceVersion = (destinationBalance?.version ?? 0) + 1;

          const nextDestinationOnHand = requireFiniteTransferQuantity(
            roundQuantity(previousDestinationOnHand + receivedQuantity, 12),
            { productId: item.productId, siteId: transfer.toSiteId }
          );
          tx.update(inventoryBalances)
            .set({
              onHand: nextDestinationOnHand,
              syncStatus: 'pending',
              version: sql`${inventoryBalances.version} + 1`,
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

          const movementId = nanoid();
          tx.insert(inventoryMovements)
            .values({
              id: movementId,
              tenantId: args.tenantId,
              productId: item.productId,
              siteId: transfer.toSiteId,
              type: 'transfer',
              quantity: receivedQuantity,
              previousStock: previousDestinationOnHand,
              newStock: nextDestinationOnHand,
              reference: args.transferId,
              notes: transfer.fromSiteId,
              createdBy: args.receivedBy,
              syncStatus: 'pending',
              syncVersion: 1,
              createdAt: now,
            })
            .run();
          movementIds.push(movementId);
        }

        tx.update(transferOrderItems)
          .set({ receivedQuantity, destinationResultingBalanceVersion })
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

      const lifecycleUpdate = tx
        .update(transferOrders)
        .set({
          status: 'completed',
          receivedAt: now,
          receivedBy: args.receivedBy,
          discrepancyNotes: persistedDiscrepancyNotes,
          syncStatus: 'pending',
          syncVersion: (transfer.syncVersion ?? 0) + 1,
          updatedAt: now,
        })
        .where(
          and(
            eq(transferOrders.id, args.transferId),
            eq(transferOrders.tenantId, args.tenantId),
            eq(transferOrders.status, 'in_transit')
          )
        )
        .run();
      if (lifecycleUpdate.changes !== 1) {
        throwServerError({
          trpcCode: 'CONFLICT',
          errorCode: 'TRANSFER_NOT_IN_TRANSIT',
          message: 'Transfer state changed while its receipt was being recorded',
        });
      }

      const fromSiteName = transferSiteById.get(transfer.fromSiteId)?.name ?? transfer.fromSiteId;
      const toSiteName = transferSiteById.get(transfer.toSiteId)?.name ?? transfer.toSiteId;
      const auditedQuantityShipped = roundQuantity(totalQuantityShipped);
      const auditedQuantityReceived = roundQuantity(totalQuantityReceived);
      const shortageQuantity = roundQuantity(auditedQuantityShipped - auditedQuantityReceived);

      // Destination credit, discrepancy persistence, lifecycle completion, and
      // the receiver-attributed evidence either all commit or all roll back.
      writeAuditLog({
        tx,
        tenantId: args.tenantId,
        actorId: args.receivedBy,
        action: 'transfer.receive',
        resourceType: 'transfer_order',
        resourceId: args.transferId,
        before: {
          status: 'in_transit',
          totalQuantityShipped: auditedQuantityShipped,
        },
        after: {
          status: 'completed',
          totalQuantityReceived: auditedQuantityReceived,
          hasDiscrepancy,
        },
        metadata: {
          fromSiteId: transfer.fromSiteId,
          fromSiteName,
          toSiteId: transfer.toSiteId,
          toSiteName,
          shortageQuantity,
          discrepancyNotes: persistedDiscrepancyNotes,
        },
        operationId: args.syncContext?.envelope?.operationId,
      });

      const result = {
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
      const syncContext = args.syncContext
        ? { ...args.syncContext, db: tx as unknown as DatabaseInstance }
        : null;
      if (syncContext) {
        const syncAggregate = getInventoryTransferSyncAggregate(
          tx as unknown as DatabaseInstance,
          args.tenantId,
          args.transferId
        );
        if (!syncAggregate) {
          throw new Error('Received transfer aggregate is missing');
        }
        enqueueSyncInTransaction(syncContext, {
          entityType: 'transfer_orders',
          entityId: args.transferId,
          operation: 'update',
          data: syncAggregate,
        });
        for (const movementId of movementIds) {
          enqueueSyncInTransaction(syncContext, {
            entityType: 'inventory_movements',
            entityId: movementId,
            operation: 'create',
            data: { id: movementId, transferId: args.transferId },
          });
        }
        enqueueInventoryLotSnapshotsInTransaction(syncContext, mutatedLotIds, {
          transferId: args.transferId,
          phase: 'receive',
        });
      }
      args.completeInTransaction(tx as unknown as DatabaseInstance, result);
      return result;
    },
    { behavior: 'immediate' }
  );
}
