/**
 * Inventory-transfer read-side queries (history list + detail drawer).
 *
 * ENG-178 — extracted verbatim from the former flat
 * `services/inventory-transfers.ts` during the megafile decomposition.
 *
 * @module services/inventory-transfers/queries
 */
import { and, asc, desc, eq, inArray } from 'drizzle-orm';

import type { DatabaseInstance } from '../../db/index.js';
import {
  products,
  productSerialTransfers,
  sites,
  transferOrderItems,
  transferOrders,
} from '../../db/schema.js';
import type { TransferDetail, TransferHistoryEntry } from './types.js';

/**
 * Lists recent transfer orders for the tenant. Reverse-chronological by
 * `createdAt` with a bounded limit — callers can pass a smaller limit via
 * `options.limit`.
 */
export async function listRecentTransfers(
  db: DatabaseInstance,
  tenantId: string,
  // ENG-179b — explicit `| undefined`.
  options: { limit?: number | undefined } = {}
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
      receivedAt: transferOrders.receivedAt,
      receivedBy: transferOrders.receivedBy,
      discrepancyNotes: transferOrders.discrepancyNotes,
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
        .select({
          quantity: transferOrderItems.quantity,
          receivedQuantity: transferOrderItems.receivedQuantity,
        })
        .from(transferOrderItems)
        .where(eq(transferOrderItems.transferOrderId, row.id))
        .all();

      // Discrepancy is only meaningful once the transfer has been received.
      // Lines still in transit carry receivedQuantity = null and must not
      // trigger the badge.
      const hasDiscrepancy = items.some(
        item => item.receivedQuantity !== null && item.receivedQuantity !== item.quantity
      );

      return {
        ...row,
        fromSiteName: sitesMap.get(row.fromSiteId) ?? '',
        toSiteName: sitesMap.get(row.toSiteId) ?? '',
        itemCount: items.length,
        totalQuantity: items.reduce((total, item) => total + item.quantity, 0),
        hasDiscrepancy,
      };
    })
  );

  return enriched;
}

/**
 * Fetches a single transfer order with every line item joined to product
 * metadata, intended for the detail drawer on the inventory history table.
 *
 * Returns `null` when the transfer does not exist for the given tenant —
 * callers (typically a tRPC `getById` procedure) translate that to the
 * familiar `TRANSFER_NOT_FOUND` error surface.
 */
export async function getInventoryTransferById(
  db: DatabaseInstance,
  tenantId: string,
  transferId: string
): Promise<TransferDetail | null> {
  const transfer = await db
    .select({
      id: transferOrders.id,
      status: transferOrders.status,
      fromSiteId: transferOrders.fromSiteId,
      toSiteId: transferOrders.toSiteId,
      notes: transferOrders.notes,
      createdBy: transferOrders.createdBy,
      createdAt: transferOrders.createdAt,
      receivedAt: transferOrders.receivedAt,
      receivedBy: transferOrders.receivedBy,
      discrepancyNotes: transferOrders.discrepancyNotes,
      updatedAt: transferOrders.updatedAt,
    })
    .from(transferOrders)
    .where(and(eq(transferOrders.id, transferId), eq(transferOrders.tenantId, tenantId)))
    .get();

  if (!transfer) {
    return null;
  }

  const items = await db
    .select({
      id: transferOrderItems.id,
      productId: transferOrderItems.productId,
      quantity: transferOrderItems.quantity,
      receivedQuantity: transferOrderItems.receivedQuantity,
      productName: products.name,
      productSku: products.sku,
      tracksSerials: products.tracksSerials,
    })
    .from(transferOrderItems)
    .innerJoin(products, eq(transferOrderItems.productId, products.id))
    .where(eq(transferOrderItems.transferOrderId, transfer.id))
    .all();

  const serialRows = items.length
    ? await db
        .select({
          transferOrderItemId: productSerialTransfers.transferOrderItemId,
          id: productSerialTransfers.productSerialId,
          serialNumber: productSerialTransfers.serialNumber,
        })
        .from(productSerialTransfers)
        .where(
          and(
            eq(productSerialTransfers.tenantId, tenantId),
            inArray(
              productSerialTransfers.transferOrderItemId,
              items.map(item => item.id)
            )
          )
        )
        .orderBy(asc(productSerialTransfers.serialNumber))
        .all()
    : [];
  const serialsByItem = new Map<string, Array<{ id: string; serialNumber: string }>>();
  for (const serial of serialRows) {
    const itemSerials = serialsByItem.get(serial.transferOrderItemId) ?? [];
    itemSerials.push({ id: serial.id, serialNumber: serial.serialNumber });
    serialsByItem.set(serial.transferOrderItemId, itemSerials);
  }

  const hasDiscrepancy = items.some(
    item => item.receivedQuantity !== null && item.receivedQuantity !== item.quantity
  );

  // Resolve site names with a single two-row lookup instead of two separate
  // selects, since most transfers have exactly 2 participating sites.
  const siteRows = await db
    .select({ id: sites.id, name: sites.name })
    .from(sites)
    .where(
      and(eq(sites.tenantId, tenantId), inArray(sites.id, [transfer.fromSiteId, transfer.toSiteId]))
    )
    .all();
  const siteNameById = new Map(siteRows.map(site => [site.id, site.name]));

  return {
    ...transfer,
    fromSiteName: siteNameById.get(transfer.fromSiteId) ?? '',
    toSiteName: siteNameById.get(transfer.toSiteId) ?? '',
    items: items.map(item => ({ ...item, serials: serialsByItem.get(item.id) ?? [] })),
    hasDiscrepancy,
  };
}
