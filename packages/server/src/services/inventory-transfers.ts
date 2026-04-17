import { and, asc, desc, eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import type { DatabaseInstance } from '../db/index.js';
import {
  inventoryBalances,
  products,
  sites,
  transferOrderItems,
  transferOrders,
  type TransferOrderStatus,
} from '../db/schema.js';
import { throwServerError } from '../lib/errorCodes.js';

/**
 * Phase 2 DB-102 / API-102 step 1 — immediate inventory transfers.
 *
 * A transfer atomically decreases `inventory_balances.on_hand` at
 * `fromSiteId` and increases it at `toSiteId` for one or more products,
 * persisting an audit row in `transfer_orders` (+ line items).
 *
 * This step collapses create/ship/receive into a single mutation; a future
 * iteration adds the lifecycle states (`draft` → `in_transit` → `received`)
 * plus a `reserved`/in-transit column on `inventory_balances`.
 */

export interface TransferItemInput {
  productId: string;
  quantity: number;
}

export interface CreateTransferArgs {
  tenantId: string;
  fromSiteId: string;
  toSiteId: string;
  items: readonly TransferItemInput[];
  notes?: string | null;
  createdBy: string;
}

export interface CreatedTransfer {
  id: string;
  status: TransferOrderStatus;
  fromSiteId: string;
  toSiteId: string;
  notes: string | null;
  createdAt: string;
  createdBy: string;
  items: Array<{
    id: string;
    productId: string;
    productName: string;
    productSku: string;
    quantity: number;
  }>;
}

function getTimestamp(): string {
  return new Date().toISOString();
}

function assertValidTransferArgs(args: CreateTransferArgs): void {
  if (args.fromSiteId === args.toSiteId) {
    throwServerError({
      trpcCode: 'BAD_REQUEST',
      errorCode: 'TRANSFER_SITES_IDENTICAL',
      message: 'Origin and destination sites must be different',
      details: { fromSiteId: args.fromSiteId },
    });
  }

  if (args.items.length === 0) {
    throwServerError({
      trpcCode: 'BAD_REQUEST',
      errorCode: 'TRANSFER_ITEMS_REQUIRED',
      message: 'A transfer must include at least one product line',
    });
  }

  for (const item of args.items) {
    if (!Number.isFinite(item.quantity) || item.quantity <= 0) {
      throwServerError({
        trpcCode: 'BAD_REQUEST',
        errorCode: 'TRANSFER_QUANTITY_INVALID',
        message: 'Transfer quantity must be greater than zero',
        details: { productId: item.productId, quantity: item.quantity },
      });
    }
  }
}

function seedMissingBalanceRow(args: {
  tx: DatabaseInstance;
  tenantId: string;
  siteId: string;
  productId: string;
  initialOnHand: number;
  now: string;
}): void {
  args.tx
    .insert(inventoryBalances)
    .values({
      id: nanoid(),
      tenantId: args.tenantId,
      siteId: args.siteId,
      productId: args.productId,
      onHand: args.initialOnHand,
      reserved: 0,
      syncStatus: 'pending',
      syncVersion: 0,
      createdAt: args.now,
      updatedAt: args.now,
    })
    .onConflictDoNothing({
      target: [
        inventoryBalances.tenantId,
        inventoryBalances.siteId,
        inventoryBalances.productId,
      ],
    })
    .run();
}

export function createInventoryTransfer(
  db: DatabaseInstance,
  args: CreateTransferArgs
): CreatedTransfer {
  assertValidTransferArgs(args);
  const now = getTimestamp();
  const transferId = nanoid();

  const result = db.transaction(tx => {
    const primarySite = tx
      .select({ id: sites.id })
      .from(sites)
      .where(and(eq(sites.tenantId, args.tenantId), eq(sites.isActive, true)))
      .orderBy(asc(sites.createdAt), asc(sites.id))
      .limit(1)
      .get();
    const primarySiteId = primarySite?.id ?? null;

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
      collapsedItems.set(
        item.productId,
        (collapsedItems.get(item.productId) ?? 0) + item.quantity
      );
    }

    const productIds = Array.from(collapsedItems.keys());
    const tenantProducts = tx
      .select({ id: products.id, name: products.name, sku: products.sku, stock: products.stock })
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

    tx.insert(transferOrders)
      .values({
        id: transferId,
        tenantId: args.tenantId,
        fromSiteId: args.fromSiteId,
        toSiteId: args.toSiteId,
        status: 'completed',
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

      // Lazily seed missing balance rows for both sites so transfer creation
      // does not depend on the balances read path having run beforehand.
      seedMissingBalanceRow({
        tx,
        tenantId: args.tenantId,
        siteId: args.fromSiteId,
        productId,
        initialOnHand: args.fromSiteId === primarySiteId ? product.stock : 0,
        now,
      });
      seedMissingBalanceRow({
        tx,
        tenantId: args.tenantId,
        siteId: args.toSiteId,
        productId,
        initialOnHand: args.toSiteId === primarySiteId ? product.stock : 0,
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

    return persistedItems;
  });

  return {
    id: transferId,
    status: 'completed',
    fromSiteId: args.fromSiteId,
    toSiteId: args.toSiteId,
    notes: args.notes ?? null,
    createdAt: now,
    createdBy: args.createdBy,
    items: result,
  };
}

export interface TransferHistoryEntry {
  id: string;
  status: TransferOrderStatus;
  fromSiteId: string;
  fromSiteName: string;
  toSiteId: string;
  toSiteName: string;
  notes: string | null;
  createdBy: string;
  createdAt: string;
  itemCount: number;
  totalQuantity: number;
}

/**
 * Lists recent transfer orders for the tenant. Reverse-chronological by
 * `createdAt` with a bounded limit — callers can pass a smaller limit via
 * `options.limit`.
 */
export async function listRecentTransfers(
  db: DatabaseInstance,
  tenantId: string,
  options: { limit?: number } = {}
): Promise<TransferHistoryEntry[]> {
  const limit = Math.max(1, Math.min(options.limit ?? 50, 200));

  const rows = await db
    .select({
      id: transferOrders.id,
      status: transferOrders.status,
      fromSiteId: transferOrders.fromSiteId,
      toSiteId: transferOrders.toSiteId,
      notes: transferOrders.notes,
      createdBy: transferOrders.createdBy,
      createdAt: transferOrders.createdAt,
    })
    .from(transferOrders)
    .where(eq(transferOrders.tenantId, tenantId))
    .orderBy(desc(transferOrders.createdAt))
    .limit(limit)
    .all();

  if (rows.length === 0) {
    return [];
  }

  const siteRows = await db
    .select({ id: sites.id, name: sites.name })
    .from(sites)
    .where(eq(sites.tenantId, tenantId))
    .all();
  const sitesMap = new Map(siteRows.map(site => [site.id, site.name]));

  // Fan-out per-transfer aggregation. History volumes are bounded by `limit`
  // (<=200) so the N+1 is acceptable for Phase 2 step 1; a future step can
  // replace this with a single GROUP BY join once `transferOrderItems` gains
  // more metadata worth aggregating.
  const enriched = await Promise.all(
    rows.map(async row => {
      const items = await db
        .select({ quantity: transferOrderItems.quantity })
        .from(transferOrderItems)
        .where(eq(transferOrderItems.transferOrderId, row.id))
        .all();

      return {
        ...row,
        fromSiteName: sitesMap.get(row.fromSiteId) ?? '',
        toSiteName: sitesMap.get(row.toSiteId) ?? '',
        itemCount: items.length,
        totalQuantity: items.reduce((total, item) => total + item.quantity, 0),
      };
    })
  );

  return enriched;
}
