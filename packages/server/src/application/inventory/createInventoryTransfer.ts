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
import { and, eq, sql } from 'drizzle-orm';
import { nanoid } from 'nanoid';

import type { DatabaseInstance } from '../../db/index.js';
import {
  inventoryBalances,
  products,
  sites,
  transferOrderItems,
  transferOrders,
  type TransferOrderStatus,
} from '../../db/schema.js';
import { throwServerError } from '../../lib/errorCodes.js';
import { writeAuditLog } from '../../services/audit-logs.js';
import { getPrimarySiteId, getProductStockTotal } from '../../services/inventory-balances.js';
import { assertAggregateStockMutationAllowed } from '../../services/products/lot-tracking.js';
import { assertCatalogStockMutationAllowed } from '../../services/products/lot-tracking.js';
import { assignProductSerialsToTransferLine } from '../../services/product-serials.js';
import {
  assertValidTransferArgs,
  getTimestamp,
  seedMissingBalanceRow,
} from '../../services/inventory-transfers/helpers.js';
import type {
  CreateTransferArgs,
  CreatedTransfer,
} from '../../services/inventory-transfers/types.js';

export function createInventoryTransfer(
  db: DatabaseInstance,
  args: CreateTransferArgs
): CreatedTransfer {
  assertValidTransferArgs(args);
  const now = getTimestamp();
  const transferId = nanoid();

  const result = db.transaction(tx => {
    const primarySiteId = getPrimarySiteId(tx, args.tenantId);

    // Validate both sites belong to the tenant and are active.
    const tenantSites = tx
      .select({ id: sites.id, name: sites.name, isActive: sites.isActive })
      .from(sites)
      .where(and(eq(sites.tenantId, args.tenantId)))
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

    // Collapse duplicate product lines so a single product can only move in
    // one direction per transfer. (The callers shouldn't pass duplicates, but
    // defending here keeps the balance updates consistent.)
    const collapsedItems = new Map<string, { quantity: number; serialIds: string[] }>();
    for (const item of args.items) {
      const existing = collapsedItems.get(item.productId) ?? { quantity: 0, serialIds: [] };
      existing.quantity += item.quantity;
      existing.serialIds.push(...(item.serialIds ?? []));
      collapsedItems.set(item.productId, existing);
    }

    const productIds = Array.from(collapsedItems.keys());
    const tenantProducts = tx
      .select({
        id: products.id,
        name: products.name,
        sku: products.sku,
        tracksLots: products.tracksLots,
        tracksSerials: products.tracksSerials,
        catalogType: products.catalogType,
      })
      .from(products)
      .where(and(eq(products.tenantId, args.tenantId), eq(products.isActive, true)))
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

    for (const [productId, transferItem] of collapsedItems.entries()) {
      const { quantity, serialIds } = transferItem;
      const product = productById.get(productId)!;
      if (product.tracksSerials) {
        assertCatalogStockMutationAllowed({ catalogType: product.catalogType, delta: -quantity });
        if (!Number.isInteger(quantity)) {
          throwServerError({
            trpcCode: 'BAD_REQUEST',
            errorCode: 'PRODUCT_SERIAL_QUANTITY_WHOLE_REQUIRED',
            message: 'Serialized transfers require whole-unit quantities',
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
        assertAggregateStockMutationAllowed({
          tracksLots: product.tracksLots,
          tracksSerials: false,
          catalogType: product.catalogType,
          delta: -quantity,
        });
      }

      // Lazily seed missing balance rows for both sites so transfer creation
      // does not depend on the balances read path having run beforehand.
      const primarySeedOnHand =
        args.fromSiteId === primarySiteId || args.toSiteId === primarySiteId
          ? getProductStockTotal(tx, args.tenantId, productId)
          : 0;
      seedMissingBalanceRow({
        tx,
        tenantId: args.tenantId,
        siteId: args.fromSiteId,
        productId,
        initialOnHand: args.fromSiteId === primarySiteId ? primarySeedOnHand : 0,
        now,
      });
      seedMissingBalanceRow({
        tx,
        tenantId: args.tenantId,
        siteId: args.toSiteId,
        productId,
        initialOnHand: args.toSiteId === primarySiteId ? primarySeedOnHand : 0,
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

      if (!fromBalance || fromBalance.onHand < quantity) {
        throwServerError({
          trpcCode: 'BAD_REQUEST',
          errorCode: 'TRANSFER_INSUFFICIENT_STOCK',
          message: 'Insufficient stock at origin site for transfer',
          details: {
            productId,
            siteId: args.fromSiteId,
            available: fromBalance?.onHand ?? 0,
            requested: quantity,
          },
        });
      }

      // Origin is always debited on create — whether the transfer completes
      // immediately or ships deferred, the stock has physically left the
      // source shelf.
      tx.update(inventoryBalances)
        .set({
          onHand: fromBalance.onHand - quantity,
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
      if (!deferred) {
        const existingToBalance = tx
          .select({ onHand: inventoryBalances.onHand })
          .from(inventoryBalances)
          .where(
            and(
              eq(inventoryBalances.tenantId, args.tenantId),
              eq(inventoryBalances.siteId, args.toSiteId),
              eq(inventoryBalances.productId, productId)
            )
          )
          .get();

        tx.update(inventoryBalances)
          .set({
            onHand: (existingToBalance?.onHand ?? 0) + quantity,
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
          createdAt: now,
        })
        .run();

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

      persistedItems.push({
        id: itemId,
        productId,
        productName: product.name,
        productSku: product.sku,
        quantity,
      });
    }

    const totalQuantity = roundQuantity(
      persistedItems.reduce((sum, item) => sum + item.quantity, 0)
    );
    const fromSite = tenantSiteById.get(args.fromSiteId)!;
    const toSite = tenantSiteById.get(args.toSiteId)!;

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

    return { items: persistedItems, status: createdStatus };
  });

  return {
    id: transferId,
    status: result.status,
    fromSiteId: args.fromSiteId,
    toSiteId: args.toSiteId,
    notes: args.notes ?? null,
    createdAt: now,
    createdBy: args.createdBy,
    items: result.items,
  };
}
