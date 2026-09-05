/**
 * Inventory-transfer create orchestrator.
 *
 * promoted from services into the application use-case boundary.
 *
 * Immediate and deferred inventory transfers.
 *
 * A transfer atomically decreases `inventory_balances.on_hand` at
 * `fromSiteId`. Immediate transfers credit `toSiteId` in the same command;
 * deferred transfers remain `in_transit` until the receive use-case credits
 * the destination. Both modes persist the order, line items, and immutable
 * operator evidence in the same transaction.
 *
 * @module application/inventory/createInventoryTransfer
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
  transferOrderItems,
  transferOrders,
  type TransferOrderStatus,
} from '../../db/schema.js';
import { throwServerError } from '../../lib/errorCodes.js';
import { QUANTITY_EPSILON } from '../../lib/quantity.js';
import { writeAuditLog } from '../../services/audit-logs.js';
import {
  assertAggregateStockMutationAllowed,
  assertCatalogStockMutationAllowed,
  assertServiceStockMutationAllowed,
} from '../../services/products/lot-tracking.js';
import { assignProductSerialsToTransferLine } from '../../services/product-serials.js';
import {
  assertValidTransferArgs,
  getTimestamp,
  requireFiniteTransferQuantity,
  seedMissingBalanceRow,
} from '../../services/inventory-transfers/helpers.js';
import type {
  CreateTransferArgs,
  CreatedTransfer,
} from '../../services/inventory-transfers/types.js';
import { getInventoryTransferSyncAggregate } from '../../services/inventory-transfers/index.js';
import { enqueueSyncInTransaction } from '../../services/sync/enqueue.js';
import { enqueueInventoryLotSnapshotsInTransaction } from '../../services/inventory-lots/index.js';
import { assertTenantBusinessClockCurrent } from '../../services/pharmacy/business-clock.js';
import { shipTransferItemLots } from './transferLots.js';

export function createInventoryTransfer(
  db: DatabaseInstance,
  args: CreateTransferArgs
): CreatedTransfer {
  assertValidTransferArgs(args);
  const now = args.nowIso ?? getTimestamp();
  const transferId = nanoid();

  const result = db.transaction(
    tx => {
      assertTenantBusinessClockCurrent(tx, args.tenantId, {
        localeVersion: args.localeVersion,
        businessDate: args.businessDate,
        timezone: args.businessTimezone,
        countryCode: args.countryCode,
      });
      // Validate both sites belong to the tenant and are active.
      const tenantSites = tx
        .select({ id: sites.id, name: sites.name, isActive: sites.isActive })
        .from(sites)
        .where(
          and(
            eq(sites.tenantId, args.tenantId),
            inArray(sites.id, [args.fromSiteId, args.toSiteId])
          )
        )
        .all();
      const tenantSiteById = new Map(tenantSites.map(site => [site.id, site]));

      for (const siteId of [args.fromSiteId, args.toSiteId]) {
        const site = tenantSiteById.get(siteId);
        if (!site || site.isActive === false) {
          throwServerError({
            trpcCode: 'NOT_FOUND',
            errorCode: 'TRANSFER_SITE_NOT_FOUND',
            message: 'Transfer site was not found or is inactive',
            details: { siteId },
          });
        }
      }
      const fromSite = tenantSiteById.get(args.fromSiteId)!;
      const toSite = tenantSiteById.get(args.toSiteId)!;

      // Collapse duplicate product lines so a single product can only move in
      // one direction per transfer. (The callers shouldn't pass duplicates, but
      // defending here keeps the balance updates consistent.)
      const collapsedItems = new Map<
        string,
        {
          quantity: number;
          serialIds: string[];
          lotAllocationsById: Map<string, number>;
        }
      >();
      for (const item of args.items) {
        const existing = collapsedItems.get(item.productId) ?? {
          quantity: 0,
          serialIds: [],
          lotAllocationsById: new Map<string, number>(),
        };
        existing.quantity = requireFiniteTransferQuantity(
          roundQuantity(existing.quantity + item.quantity, 12),
          { productId: item.productId },
          'BAD_REQUEST'
        );
        existing.serialIds.push(...(item.serialIds ?? []));
        for (const allocation of item.lotAllocations ?? []) {
          const allocationQuantity = requireFiniteTransferQuantity(
            roundQuantity(
              (existing.lotAllocationsById.get(allocation.lotId) ?? 0) + allocation.quantity,
              12
            ),
            { productId: item.productId, lotId: allocation.lotId },
            'BAD_REQUEST'
          );
          existing.lotAllocationsById.set(allocation.lotId, allocationQuantity);
        }
        collapsedItems.set(item.productId, existing);
      }

      const productIds = Array.from(collapsedItems.keys());
      const tenantProducts = tx
        .select({
          id: products.id,
          name: products.name,
          sku: products.sku,
          tracksStock: products.tracksStock,
          tracksLots: products.tracksLots,
          tracksSerials: products.tracksSerials,
          catalogType: products.catalogType,
        })
        .from(products)
        .where(
          and(
            eq(products.tenantId, args.tenantId),
            eq(products.isActive, true),
            inArray(products.id, productIds)
          )
        )
        .all();
      const productById = new Map(tenantProducts.map(product => [product.id, product]));

      for (const productId of productIds) {
        if (!productById.has(productId)) {
          throwServerError({
            trpcCode: 'NOT_FOUND',
            errorCode: 'TRANSFER_PRODUCT_NOT_FOUND',
            message: 'Transfer product was not found or is inactive',
            details: { productId },
          });
        }
      }

      const deferred = args.defer === true;
      const createdStatus: TransferOrderStatus = deferred ? 'in_transit' : 'completed';

      tx.insert(transferOrders)
        .values({
          id: transferId,
          tenantId: args.tenantId,
          fromSiteId: args.fromSiteId,
          toSiteId: args.toSiteId,
          status: createdStatus,
          notes: args.notes ?? null,
          createdBy: args.createdBy,
          syncStatus: 'pending',
          syncVersion: 0,
          createdAt: now,
          updatedAt: now,
        })
        .run();

      const persistedItems: CreatedTransfer['items'] = [];
      const movementIds: string[] = [];
      const mutatedLotIds: string[] = [];

      for (const [productId, transferItem] of collapsedItems.entries()) {
        const { quantity, serialIds, lotAllocationsById } = transferItem;
        const lotAllocations = [...lotAllocationsById].map(([lotId, allocationQuantity]) => ({
          lotId,
          quantity: allocationQuantity,
        }));
        const product = productById.get(productId)!;
        assertServiceStockMutationAllowed({ tracksStock: product.tracksStock, delta: -quantity });
        if (product.tracksSerials) {
          if (lotAllocations.length > 0) {
            throwServerError({
              trpcCode: 'BAD_REQUEST',
              errorCode: 'PRODUCT_LOT_TRACKING_REQUIRED',
              message: 'Serialized transfers cannot include lot allocations',
            });
          }
          assertCatalogStockMutationAllowed({ catalogType: product.catalogType, delta: -quantity });
          if (!Number.isInteger(quantity)) {
            throwServerError({
              trpcCode: 'BAD_REQUEST',
              errorCode: 'PRODUCT_SERIAL_QUANTITY_WHOLE_REQUIRED',
              message: 'Serialized transfers require whole-unit quantities',
            });
          }
        } else if (product.tracksLots) {
          if (serialIds.length > 0) {
            throwServerError({
              trpcCode: 'BAD_REQUEST',
              errorCode: 'PRODUCT_SERIAL_TRACKING_REQUIRED',
              message: 'Lot-tracked transfers cannot include serial identities',
            });
          }
          assertCatalogStockMutationAllowed({ catalogType: product.catalogType, delta: -quantity });
          if (lotAllocations.length === 0) {
            throwServerError({
              trpcCode: 'BAD_REQUEST',
              errorCode: 'LOT_ALLOCATION_REQUIRED',
              message: 'Lot-tracked transfers require exact source lot quantities',
            });
          }
        } else {
          if (serialIds.length > 0) {
            throwServerError({
              trpcCode: 'BAD_REQUEST',
              errorCode: 'PRODUCT_SERIAL_TRACKING_REQUIRED',
              message: 'Serial identities can only be supplied for serialized products',
            });
          }
          if (lotAllocations.length > 0) {
            throwServerError({
              trpcCode: 'BAD_REQUEST',
              errorCode: 'PRODUCT_LOT_TRACKING_REQUIRED',
              message: 'Lot allocations can only be supplied for lot-tracked products',
            });
          }
          assertAggregateStockMutationAllowed({
            tracksStock: product.tracksStock,
            tracksLots: product.tracksLots,
            tracksSerials: false,
            catalogType: product.catalogType,
            delta: -quantity,
          });
        }

        // Lazily seed missing balance rows for both sites so transfer creation
        // does not depend on the balances read path having run beforehand.
        seedMissingBalanceRow({
          tx,
          tenantId: args.tenantId,
          siteId: args.fromSiteId,
          productId,
          initialOnHand: 0,
          now,
        });
        seedMissingBalanceRow({
          tx,
          tenantId: args.tenantId,
          siteId: args.toSiteId,
          productId,
          initialOnHand: 0,
          now,
        });

        const fromBalance = tx
          .select({ onHand: inventoryBalances.onHand })
          .from(inventoryBalances)
          .where(
            and(
              eq(inventoryBalances.tenantId, args.tenantId),
              eq(inventoryBalances.siteId, args.fromSiteId),
              eq(inventoryBalances.productId, productId)
            )
          )
          .get();

        const fromOnHand = fromBalance
          ? requireFiniteTransferQuantity(fromBalance.onHand, {
              productId,
              siteId: args.fromSiteId,
            })
          : 0;
        if (!fromBalance || fromOnHand + QUANTITY_EPSILON < quantity) {
          throwServerError({
            trpcCode: 'BAD_REQUEST',
            errorCode: 'TRANSFER_INSUFFICIENT_STOCK',
            message: 'Insufficient stock at origin site for transfer',
            details: {
              productId,
              siteId: args.fromSiteId,
              available: fromOnHand,
              requested: quantity,
            },
          });
        }

        // Origin is always debited on create — whether the transfer completes
        // immediately or ships deferred, the stock has physically left the
        // source shelf.
        const nextFromOnHand = requireFiniteTransferQuantity(
          roundQuantity(fromOnHand - quantity, 12),
          { productId, siteId: args.fromSiteId }
        );
        tx.update(inventoryBalances)
          .set({
            onHand: nextFromOnHand,
            syncStatus: 'pending',
            version: sql`${inventoryBalances.version} + 1`,
            updatedAt: now,
          })
          .where(
            and(
              eq(inventoryBalances.tenantId, args.tenantId),
              eq(inventoryBalances.siteId, args.fromSiteId),
              eq(inventoryBalances.productId, productId)
            )
          )
          .run();

        // Destination is credited only on immediate transfers. Deferred
        // transfers credit the destination later via `receiveInventoryTransfer`.
        let existingToOnHand = 0;
        let nextToOnHand = 0;
        let destinationResultingBalanceVersion: number | null = null;
        if (!deferred) {
          const existingToBalance = tx
            .select({ onHand: inventoryBalances.onHand, version: inventoryBalances.version })
            .from(inventoryBalances)
            .where(
              and(
                eq(inventoryBalances.tenantId, args.tenantId),
                eq(inventoryBalances.siteId, args.toSiteId),
                eq(inventoryBalances.productId, productId)
              )
            )
            .get();
          existingToOnHand = requireFiniteTransferQuantity(existingToBalance?.onHand ?? 0, {
            productId,
            siteId: args.toSiteId,
          });
          destinationResultingBalanceVersion = (existingToBalance?.version ?? 0) + 1;

          nextToOnHand = requireFiniteTransferQuantity(
            roundQuantity(existingToOnHand + quantity, 12),
            { productId, siteId: args.toSiteId }
          );
          tx.update(inventoryBalances)
            .set({
              onHand: nextToOnHand,
              syncStatus: 'pending',
              version: sql`${inventoryBalances.version} + 1`,
              updatedAt: now,
            })
            .where(
              and(
                eq(inventoryBalances.tenantId, args.tenantId),
                eq(inventoryBalances.siteId, args.toSiteId),
                eq(inventoryBalances.productId, productId)
              )
            )
            .run();
        }

        // `inventory_balances` is the single source of truth; the tenant-wide
        // total is derived on read, so there is no cache to recompute here.

        const itemId = nanoid();
        tx.insert(transferOrderItems)
          .values({
            id: itemId,
            transferOrderId: transferId,
            productId,
            quantity,
            destinationResultingBalanceVersion,
            createdAt: now,
          })
          .run();

        let lots: CreatedTransfer['items'][number]['lots'] = [];
        if (product.tracksLots) {
          lots = shipTransferItemLots(tx as unknown as DatabaseInstance, {
            tenantId: args.tenantId,
            fromSiteId: args.fromSiteId,
            toSiteId: args.toSiteId,
            transferOrderItemId: itemId,
            productId,
            quantity,
            allocations: lotAllocations,
            deferred,
            now,
            ...(args.businessDate ? { businessDate: args.businessDate } : {}),
            actorId: args.createdBy,
            syncContext: {
              tenantId: args.tenantId,
              ...(args.syncContext?.envelope === undefined
                ? {}
                : { envelope: args.syncContext.envelope }),
              ...(args.syncContext?.deviceId === undefined
                ? {}
                : { deviceId: args.syncContext.deviceId }),
            },
          });
          for (const lot of lots) {
            mutatedLotIds.push(lot.sourceLotId);
            if (lot.destinationLotId) mutatedLotIds.push(lot.destinationLotId);
          }
        }

        if (product.tracksSerials) {
          assignProductSerialsToTransferLine(tx as unknown as DatabaseInstance, {
            tenantId: args.tenantId,
            fromSiteId: args.fromSiteId,
            toSiteId: args.toSiteId,
            productId,
            transferOrderItemId: itemId,
            serialIds,
            quantity,
            deferred,
            now,
            syncContext: args.syncContext
              ? { ...args.syncContext, db: tx as unknown as DatabaseInstance }
              : undefined,
          });
        }

        const originMovementId = nanoid();
        tx.insert(inventoryMovements)
          .values({
            id: originMovementId,
            tenantId: args.tenantId,
            productId,
            siteId: args.fromSiteId,
            type: 'transfer',
            quantity: -quantity,
            previousStock: fromOnHand,
            newStock: nextFromOnHand,
            reference: transferId,
            notes: toSite.name,
            createdBy: args.createdBy,
            syncStatus: 'pending',
            syncVersion: 1,
            createdAt: now,
          })
          .run();
        movementIds.push(originMovementId);
        if (!deferred) {
          const destinationMovementId = nanoid();
          tx.insert(inventoryMovements)
            .values({
              id: destinationMovementId,
              tenantId: args.tenantId,
              productId,
              siteId: args.toSiteId,
              type: 'transfer',
              quantity,
              previousStock: existingToOnHand,
              newStock: nextToOnHand,
              reference: transferId,
              notes: fromSite.name,
              createdBy: args.createdBy,
              syncStatus: 'pending',
              syncVersion: 1,
              createdAt: now,
            })
            .run();
          movementIds.push(destinationMovementId);
        }

        persistedItems.push({
          id: itemId,
          productId,
          productName: product.name,
          productSku: product.sku,
          quantity,
          lots,
        });
      }

      const totalQuantity = requireFiniteTransferQuantity(
        roundQuantity(persistedItems.reduce((sum, item) => sum + item.quantity, 0)),
        undefined,
        'BAD_REQUEST'
      );

      // The transfer row, exact source debit, optional destination credit, and
      // immutable operator evidence share one atomic boundary.
      writeAuditLog({
        tx,
        tenantId: args.tenantId,
        actorId: args.createdBy,
        action: 'transfer.create',
        resourceType: 'transfer_order',
        resourceId: transferId,
        before: null,
        after: {
          status: createdStatus,
          lineCount: persistedItems.length,
          totalQuantity,
        },
        metadata: {
          fromSiteId: args.fromSiteId,
          fromSiteName: fromSite.name,
          toSiteId: args.toSiteId,
          toSiteName: toSite.name,
          mode: deferred ? 'deferred' : 'immediate',
          notes: args.notes ?? null,
        },
        operationId: args.syncContext?.envelope?.operationId,
      });

      const result: CreatedTransfer = {
        id: transferId,
        status: createdStatus,
        fromSiteId: args.fromSiteId,
        toSiteId: args.toSiteId,
        notes: args.notes ?? null,
        createdAt: now,
        createdBy: args.createdBy,
        items: persistedItems,
      };
      const syncContext = args.syncContext
        ? { ...args.syncContext, db: tx as unknown as DatabaseInstance }
        : null;
      if (syncContext) {
        const syncAggregate = getInventoryTransferSyncAggregate(
          tx as unknown as DatabaseInstance,
          args.tenantId,
          transferId
        );
        if (!syncAggregate) {
          throw new Error('Committed transfer aggregate is missing');
        }
        enqueueSyncInTransaction(syncContext, {
          entityType: 'transfer_orders',
          entityId: transferId,
          operation: 'create',
          data: syncAggregate,
        });
        for (const movementId of movementIds) {
          enqueueSyncInTransaction(syncContext, {
            entityType: 'inventory_movements',
            entityId: movementId,
            operation: 'create',
            data: { id: movementId, transferId },
          });
        }
        enqueueInventoryLotSnapshotsInTransaction(syncContext, mutatedLotIds, {
          transferId,
          phase: deferred ? 'ship' : 'immediate',
        });
      }
      args.completeInTransaction(tx as unknown as DatabaseInstance, result);
      return result;
    },
    { behavior: 'immediate' }
  );

  return result;
}
