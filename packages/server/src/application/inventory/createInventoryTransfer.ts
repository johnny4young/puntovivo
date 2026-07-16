/**
 * Inventory-transfer create orchestrator.
 *
 * ENG-206 — promoted from services into the application use-case boundary.
 *
 * Phase 2 DB-102 / API-102 step 1 — immediate inventory transfers.
 *
 * A transfer atomically decreases `inventory_balances.on_hand` at
 * `fromSiteId` and increases it at `toSiteId` for one or more products,
 * persisting an audit row in `transfer_orders` (+ line items).
 *
 * This step collapses create/ship/receive into a single mutation; a future
 * iteration adds the lifecycle states (`draft` → `in_transit` → `received`)
 * plus a `reserved`/in-transit column on `inventory_balances`.
 *
 * @module application/inventory/createInventoryTransfer
 */
import { and, eq } from 'drizzle-orm';
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
import { getPrimarySiteId, getProductStockTotal } from '../../services/inventory-balances.js';
import { assertAggregateStockMutationAllowed } from '../../services/products/lot-tracking.js';
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
      .select({ id: sites.id, isActive: sites.isActive })
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
    const collapsedItems = new Map<string, number>();
    for (const item of args.items) {
      collapsedItems.set(item.productId, (collapsedItems.get(item.productId) ?? 0) + item.quantity);
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

    for (const [productId, quantity] of collapsedItems.entries()) {
      const product = productById.get(productId)!;
      assertAggregateStockMutationAllowed({
        tracksLots: product.tracksLots,
        tracksSerials: product.tracksSerials,
        catalogType: product.catalogType,
        delta: -quantity,
      });

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

      persistedItems.push({
        id: itemId,
        productId,
        productName: product.name,
        productSku: product.sku,
        quantity,
      });
    }

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
