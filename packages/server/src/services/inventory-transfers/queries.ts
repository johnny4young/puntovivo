/**
 * Inventory-transfer read-side queries (history list + detail drawer).
 *
 * extracted verbatim from the former flat
 * `services/inventory-transfers.ts` during the megafile decomposition.
 *
 * @module services/inventory-transfers/queries
 */
import { roundQuantity } from '@puntovivo/shared/unit-math';
import { and, asc, desc, eq, inArray } from 'drizzle-orm';

import type { DatabaseInstance } from '../../db/index.js';
import {
  products,
  productSerialTransfers,
  sites,
  transferOrderItemLots,
  transferOrderItems,
  transferOrders,
} from '../../db/schema.js';
import { QUANTITY_EPSILON } from '../../lib/quantity.js';
import type { TransferDetail, TransferHistoryEntry } from './types.js';

/**
 * Exact committed transfer aggregate for the sync outbox.
 *
 * A transfer header is not independently meaningful: item quantities, exact
 * lot custody snapshots, and serialized identities must travel together. The
 * inbound codec remains blocked until it can apply this shape atomically.
 */
export function getInventoryTransferSyncAggregate(
  db: DatabaseInstance,
  tenantId: string,
  transferId: string
) {
  const transfer = db
    .select()
    .from(transferOrders)
    .where(and(eq(transferOrders.tenantId, tenantId), eq(transferOrders.id, transferId)))
    .get();
  if (!transfer) return null;

  const items = db
    .select()
    .from(transferOrderItems)
    .where(eq(transferOrderItems.transferOrderId, transferId))
    .orderBy(transferOrderItems.createdAt, transferOrderItems.id)
    .all();
  const itemIds = items.map(item => item.id);
  const lots =
    itemIds.length === 0
      ? []
      : db
          .select()
          .from(transferOrderItemLots)
          .where(
            and(
              eq(transferOrderItemLots.tenantId, tenantId),
              inArray(transferOrderItemLots.transferOrderItemId, itemIds)
            )
          )
          .orderBy(transferOrderItemLots.createdAt, transferOrderItemLots.id)
          .all();
  const serialTransfers =
    itemIds.length === 0
      ? []
      : db
          .select()
          .from(productSerialTransfers)
          .where(
            and(
              eq(productSerialTransfers.tenantId, tenantId),
              inArray(productSerialTransfers.transferOrderItemId, itemIds)
            )
          )
          .orderBy(productSerialTransfers.createdAt, productSerialTransfers.id)
          .all();

  return { aggregateVersion: 1, ...transfer, items, lots, serialTransfers };
}

/**
 * Lists recent transfer orders for the tenant. Reverse-chronological by
 * `createdAt` with a bounded limit — callers can pass a smaller limit via
 * `options.limit`.
 */
export async function listRecentTransfers(
  db: DatabaseInstance,
  tenantId: string,
  // explicit `| undefined`.
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

  const siteIds = [...new Set(rows.flatMap(row => [row.fromSiteId, row.toSiteId]))];
  const siteRows = await db
    .select({ id: sites.id, name: sites.name })
    .from(sites)
    .where(and(eq(sites.tenantId, tenantId), inArray(sites.id, siteIds)))
    .all();
  const sitesMap = new Map(siteRows.map(site => [site.id, site.name]));

  const orderIds = rows.map(row => row.id);
  const itemRows = await db
    .select({
      transferOrderId: transferOrderItems.transferOrderId,
      quantity: transferOrderItems.quantity,
      receivedQuantity: transferOrderItems.receivedQuantity,
    })
    .from(transferOrderItems)
    .innerJoin(
      transferOrders,
      and(
        eq(transferOrderItems.transferOrderId, transferOrders.id),
        eq(transferOrders.tenantId, tenantId)
      )
    )
    .where(inArray(transferOrderItems.transferOrderId, orderIds))
    .all();
  const itemsByOrderId = new Map<string, typeof itemRows>();
  for (const item of itemRows) {
    const items = itemsByOrderId.get(item.transferOrderId) ?? [];
    items.push(item);
    itemsByOrderId.set(item.transferOrderId, items);
  }

  return rows.map(row => {
    const items = itemsByOrderId.get(row.id) ?? [];
    // Discrepancy is only meaningful once the transfer has been received.
    // Lines still in transit carry receivedQuantity = null and must not
    // trigger the badge.
    const hasDiscrepancy = items.some(
      item =>
        item.receivedQuantity !== null &&
        Math.abs(item.receivedQuantity - item.quantity) > QUANTITY_EPSILON
    );
    const totalQuantity = items.reduce(
      (total, item) => roundQuantity(total + item.quantity, 12),
      0
    );
    const totalReceivedQuantity =
      row.status === 'in_transit'
        ? null
        : items.reduce(
            (total, item) => roundQuantity(total + (item.receivedQuantity ?? item.quantity), 12),
            0
          );
    return {
      ...row,
      fromSiteName: sitesMap.get(row.fromSiteId) ?? '',
      toSiteName: sitesMap.get(row.toSiteId) ?? '',
      itemCount: items.length,
      totalQuantity,
      totalReceivedQuantity,
      hasDiscrepancy,
    };
  });
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
      tracksLots: products.tracksLots,
      tracksSerials: products.tracksSerials,
    })
    .from(transferOrderItems)
    .innerJoin(
      transferOrders,
      and(
        eq(transferOrderItems.transferOrderId, transferOrders.id),
        eq(transferOrders.tenantId, tenantId)
      )
    )
    .innerJoin(
      products,
      and(eq(transferOrderItems.productId, products.id), eq(products.tenantId, tenantId))
    )
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
  const lotRows = items.length
    ? await db
        .select({
          id: transferOrderItemLots.id,
          transferOrderItemId: transferOrderItemLots.transferOrderItemId,
          sourceLotId: transferOrderItemLots.sourceLotId,
          destinationLotId: transferOrderItemLots.destinationLotId,
          lotNumber: transferOrderItemLots.lotNumberSnapshot,
          expiresAt: transferOrderItemLots.expiresAtSnapshot,
          status: transferOrderItemLots.sourceStatusSnapshot,
          quantity: transferOrderItemLots.quantity,
          receivedQuantity: transferOrderItemLots.receivedQuantity,
          unitCost: transferOrderItemLots.unitCost,
        })
        .from(transferOrderItemLots)
        .where(
          and(
            eq(transferOrderItemLots.tenantId, tenantId),
            inArray(
              transferOrderItemLots.transferOrderItemId,
              items.map(item => item.id)
            )
          )
        )
        .orderBy(asc(transferOrderItemLots.lotNumberSnapshot))
        .all()
    : [];
  const serialsByItem = new Map<string, Array<{ id: string; serialNumber: string }>>();
  for (const serial of serialRows) {
    const itemSerials = serialsByItem.get(serial.transferOrderItemId) ?? [];
    itemSerials.push({ id: serial.id, serialNumber: serial.serialNumber });
    serialsByItem.set(serial.transferOrderItemId, itemSerials);
  }
  const lotsByItem = new Map<
    string,
    Array<Omit<(typeof lotRows)[number], 'transferOrderItemId'>>
  >();
  for (const { transferOrderItemId, ...lot } of lotRows) {
    const itemLots = lotsByItem.get(transferOrderItemId) ?? [];
    itemLots.push(lot);
    lotsByItem.set(transferOrderItemId, itemLots);
  }

  const hasDiscrepancy = items.some(
    item =>
      item.receivedQuantity !== null &&
      Math.abs(item.receivedQuantity - item.quantity) > QUANTITY_EPSILON
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
    items: items.map(item => ({
      ...item,
      serials: serialsByItem.get(item.id) ?? [],
      lots: lotsByItem.get(item.id) ?? [],
    })),
    hasDiscrepancy,
  };
}
