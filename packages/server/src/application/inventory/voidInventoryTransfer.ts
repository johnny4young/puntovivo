/**
 * Inventory-transfer void (reversal) orchestrator.
 *
 * promoted from services into the application use-case boundary.
 *
 * @module application/inventory/voidInventoryTransfer
 */
import { roundQuantity } from '@puntovivo/shared/unit-math';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { nanoid } from 'nanoid';

import type { DatabaseInstance } from '../../db/index.js';
import {
  inventoryBalances,
  inventoryMovements,
  products,
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
import { reverseTransferredProductSerials } from '../../services/product-serials.js';
import {
  getTimestamp,
  requireFiniteTransferQuantity,
  seedMissingBalanceRow,
} from '../../services/inventory-transfers/helpers.js';
import type { VoidTransferArgs, VoidedTransfer } from '../../services/inventory-transfers/types.js';
import { voidTransferItemLots } from './transferLots.js';
import { getInventoryTransferSyncAggregate } from '../../services/inventory-transfers/index.js';
import { enqueueSyncInTransaction } from '../../services/sync/enqueue.js';
import {
  assertLotTrackingMatchesProvenance,
  enqueueInventoryLotSnapshotsInTransaction,
} from '../../services/inventory-lots/index.js';

/**
 * Voids a completed transfer by reversing every line item:
 * - Destination `on_hand` is decremented by the item quantity.
 * - Origin `on_hand` is incremented by the same quantity.
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

  return db.transaction(
    tx => {
      const transfer = tx
        .select({
          id: transferOrders.id,
          status: transferOrders.status,
          fromSiteId: transferOrders.fromSiteId,
          toSiteId: transferOrders.toSiteId,
          notes: transferOrders.notes,
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
          id: transferOrderItems.id,
          productId: transferOrderItems.productId,
          quantity: transferOrderItems.quantity,
          receivedQuantity: transferOrderItems.receivedQuantity,
          destinationResultingBalanceVersion: transferOrderItems.destinationResultingBalanceVersion,
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

      // The destination debit on void matches whatever was credited at receive
      // time. Legacy rows have receivedQuantity = null → coalesce
      // to the shipped quantity to preserve existing void semantics.
      const itemsWithReversal = items.map(item => ({
        ...item,
        quantity: requireFiniteTransferQuantity(item.quantity, {
          transferId: args.transferId,
          itemId: item.id,
        }),
        destinationDebit: requireFiniteTransferQuantity(item.receivedQuantity ?? item.quantity, {
          transferId: args.transferId,
          itemId: item.id,
        }),
      }));

      const wasInTransit = transfer.status === 'in_transit';
      const movementIds: string[] = [];
      const mutatedLotIds: string[] = [];

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

          const available = requireFiniteTransferQuantity(destinationBalance?.onHand ?? 0, {
            productId: item.productId,
            siteId: transfer.toSiteId,
          });
          const hasLotProvenance = lotProvenanceItemIds.has(item.id);
          if (!destinationBalance || available + QUANTITY_EPSILON < item.destinationDebit) {
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
          if (
            hasLotProvenance &&
            (item.destinationResultingBalanceVersion === null ||
              destinationBalance.version !== item.destinationResultingBalanceVersion)
          ) {
            throwServerError({
              trpcCode: 'CONFLICT',
              errorCode: 'TRANSFER_VOID_INSUFFICIENT_STOCK',
              message: 'Destination stock changed after the exact-lot transfer',
              details: {
                transferId: args.transferId,
                productId: item.productId,
                expectedBalanceVersion: item.destinationResultingBalanceVersion,
                currentBalanceVersion: destinationBalance.version,
              },
            });
          }
          validatedDestinationOnHand.set(item.productId, available);
        }
      }

      const reversedItems: VoidedTransfer['reversedItems'] = [];

      for (const item of itemsWithReversal) {
        // An in-transit cancellation returns the whole shipment to its origin.
        // After receipt, only the quantity that actually arrived can come back;
        // an acknowledged shortage remains shrinkage instead of being coined
        // back into stock by the void.
        const originCredit = wasInTransit ? item.quantity : item.destinationDebit;
        assertServiceStockMutationAllowed({
          tracksStock: item.tracksStock,
          delta: Math.max(originCredit, item.destinationDebit),
        });
        assertLotTrackingMatchesProvenance({
          tracksLots: item.tracksLots,
          hasLotProvenance: lotProvenanceItemIds.has(item.id),
          referenceId: item.id,
        });
        if (item.tracksSerials) {
          if (!wasInTransit && item.destinationDebit !== item.quantity) {
            throwServerError({
              trpcCode: 'CONFLICT',
              errorCode: 'PRODUCT_SERIAL_UNAVAILABLE',
              message: 'Serialized transfer history cannot contain a quantity discrepancy',
            });
          }
          reverseTransferredProductSerials(tx as unknown as DatabaseInstance, {
            tenantId: args.tenantId,
            transferOrderItemId: item.id,
            productId: item.productId,
            fromSiteId: transfer.fromSiteId,
            toSiteId: transfer.toSiteId,
            quantity: item.quantity,
            wasInTransit,
            now,
            syncContext: args.syncContext
              ? { ...args.syncContext, db: tx as unknown as DatabaseInstance }
              : undefined,
          });
        } else if (item.tracksLots) {
          mutatedLotIds.push(
            ...voidTransferItemLots(tx as unknown as DatabaseInstance, {
              tenantId: args.tenantId,
              fromSiteId: transfer.fromSiteId,
              toSiteId: transfer.toSiteId,
              transferOrderItemId: item.id,
              productId: item.productId,
              wasInTransit,
              now,
            })
          );
        } else if (originCredit > QUANTITY_EPSILON) {
          assertAggregateStockMutationAllowed({
            tracksStock: item.tracksStock,
            tracksLots: item.tracksLots,
            tracksSerials: false,
            catalogType: item.catalogType,
            delta: originCredit,
          });
        }
        if (!wasInTransit && item.destinationDebit > 0) {
          // Decrement destination using the pre-validated value — a single read
          // per item keeps the math consistent and avoids a reachable path to a
          // negative balance if the row was somehow removed between loops.
          const destinationOnHand = validatedDestinationOnHand.get(item.productId)!;

          const nextDestinationOnHand = requireFiniteTransferQuantity(
            roundQuantity(destinationOnHand - item.destinationDebit, 12),
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

          const destinationMovementId = nanoid();
          tx.insert(inventoryMovements)
            .values({
              id: destinationMovementId,
              tenantId: args.tenantId,
              productId: item.productId,
              siteId: transfer.toSiteId,
              type: 'transfer',
              quantity: -item.destinationDebit,
              previousStock: destinationOnHand,
              newStock: nextDestinationOnHand,
              reference: args.transferId,
              notes: transfer.notes ?? args.transferId,
              createdBy: args.voidedBy,
              syncStatus: 'pending',
              syncVersion: 1,
              createdAt: now,
            })
            .run();
          movementIds.push(destinationMovementId);
        }

        // Credit only stock physically returning to origin. For a completed
        // discrepant receipt this is the received quantity; the unreceived
        // remainder stays out of stock as the already-recorded shortage. A
        // fully lost receipt is a deliberate no-op on balances and movements.
        if (originCredit > QUANTITY_EPSILON) {
          seedMissingBalanceRow({
            tx,
            tenantId: args.tenantId,
            siteId: transfer.fromSiteId,
            productId: item.productId,
            initialOnHand: 0,
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
          const previousOriginOnHand = requireFiniteTransferQuantity(originBalance?.onHand ?? 0, {
            productId: item.productId,
            siteId: transfer.fromSiteId,
          });

          const nextOriginOnHand = requireFiniteTransferQuantity(
            roundQuantity(previousOriginOnHand + originCredit, 12),
            { productId: item.productId, siteId: transfer.fromSiteId }
          );
          tx.update(inventoryBalances)
            .set({
              onHand: nextOriginOnHand,
              syncStatus: 'pending',
              version: sql`${inventoryBalances.version} + 1`,
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

          const originMovementId = nanoid();
          tx.insert(inventoryMovements)
            .values({
              id: originMovementId,
              tenantId: args.tenantId,
              productId: item.productId,
              siteId: transfer.fromSiteId,
              type: 'transfer',
              quantity: originCredit,
              previousStock: previousOriginOnHand,
              newStock: nextOriginOnHand,
              reference: args.transferId,
              notes: transfer.notes ?? args.transferId,
              createdBy: args.voidedBy,
              syncStatus: 'pending',
              syncVersion: 1,
              createdAt: now,
            })
            .run();
          movementIds.push(originMovementId);
        }

        // `inventory_balances` is the single source of truth; the tenant-wide
        // total is derived on read, so there is no cache to recompute here.

        reversedItems.push({ productId: item.productId, quantity: originCredit });
      }

      // Flip the transfer row to `void`. Preserve existing notes and append
      // a void reason when provided.
      const voidReason = args.reason?.trim();
      const mergedNotes = voidReason
        ? transfer.notes
          ? `${transfer.notes}\n[VOID] ${voidReason}`
          : `[VOID] ${voidReason}`
        : transfer.notes;

      const lifecycleUpdate = tx
        .update(transferOrders)
        .set({
          status: 'void',
          notes: mergedNotes,
          syncStatus: 'pending',
          syncVersion: (transfer.syncVersion ?? 0) + 1,
          updatedAt: now,
        })
        .where(
          and(
            eq(transferOrders.id, args.transferId),
            eq(transferOrders.tenantId, args.tenantId),
            eq(transferOrders.status, transfer.status)
          )
        )
        .run();
      if (lifecycleUpdate.changes !== 1) {
        throwServerError({
          trpcCode: 'CONFLICT',
          errorCode: 'TRANSFER_ALREADY_VOID',
          message: 'Transfer state changed while its void was being recorded',
        });
      }

      // audit this sensitive operation. Inside the same
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
        operationId: args.syncContext?.envelope?.operationId,
      });

      const result = {
        id: args.transferId,
        status: 'void' as TransferOrderStatus,
        fromSiteId: transfer.fromSiteId,
        toSiteId: transfer.toSiteId,
        voidedAt: now,
        voidedBy: args.voidedBy,
        reversedItems,
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
          throw new Error('Voided transfer aggregate is missing');
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
          phase: 'void',
        });
      }
      args.completeInTransaction(tx as unknown as DatabaseInstance, result);
      return result;
    },
    { behavior: 'immediate' }
  );
}
