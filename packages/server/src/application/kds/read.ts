/** Bounded, read-only kitchen projection. The preparation snapshot never tracks catalog edits. */
import { and, eq, getTableColumns, inArray, sql } from 'drizzle-orm';
import type { DatabaseInstance } from '../../db/index.js';
import {
  kdsOrderLines,
  kdsOrders,
  restaurantTables,
  sales,
  type KdsOrderRow,
  type KdsOrderLineRow,
} from '../../db/schema.js';
import { KDS_MAX_LINES } from './common.js';
import { parseLegacyKitchenItems } from './legacy.js';
import { validateKitchenSnapshots, type KitchenItemSnapshot } from './snapshot.js';

/** Current progress/destination is separate from the immutable preparation snapshot. */
export interface KitchenBoardLine extends KitchenItemSnapshot {
  id: string | null;
  version: number | null;
  status: KdsOrderLineRow['status'];
  currentSaleId: string;
  currentSaleNumber: string | null;
  currentTableId: string | null;
  currentTableLabel: string | null;
}
/** Kitchen-only public DTO; excludes customer, prices, tenders and fiscal data. */
export interface KdsOrderResponse {
  id: string;
  version: number;
  saleId: string;
  saleNumber: string;
  tableId: string | null;
  tableLabel: string | null;
  multipleDestinations: boolean;
  station: string;
  stationName: string | null;
  items: KitchenBoardLine[];
  integrity: 'valid' | 'invalid';
  notes: string | null;
  status: KdsOrderRow['status'];
  createdAt: string;
  readyAt: string | null;
  readyByUserId: string | null;
  updatedAt: string;
}

/** Caller owns the read/write transaction so header and line generations are coherent. */
export function projectKitchenOrders(
  tx: DatabaseInstance,
  tenantId: string,
  siteId: string,
  orders: KdsOrderRow[]
): KdsOrderResponse[] {
  if (!orders.length) return [];
  const owned = orders.filter(order => order.tenantId === tenantId && order.siteId === siteId);
  // Count at most max+1 entries per ticket using its tenant/order index.
  // A corrupt oversized ticket cannot consume another ticket's read allowance.
  // Explicit identifiers keep the outer correlation qualified: Drizzle strips
  // column qualification from SQL expressions in a single-table selection.
  const sizes = tx
    .select({
      id: kdsOrders.id,
      size: sql<number>`(
    SELECT count(*) FROM (
      SELECT 1 FROM kds_order_lines
      WHERE tenant_id = ${tenantId} AND order_id = ${sql.identifier('kds_orders')}.${sql.identifier('id')}
      LIMIT ${KDS_MAX_LINES + 1}
    )
  )`,
    })
    .from(kdsOrders)
    .where(
      and(
        eq(kdsOrders.tenantId, tenantId),
        eq(kdsOrders.siteId, siteId),
        inArray(
          kdsOrders.id,
          owned.map(order => order.id)
        )
      )
    )
    .all();
  const boundedIds = sizes.filter(row => row.size <= KDS_MAX_LINES).map(row => row.id);
  const lines = tx
    .select({
      ...getTableColumns(kdsOrderLines),
      // Avoid Drizzle's eager JSON.parse: a poisoned ticket must be identified,
      // not prevent the rest of the kitchen from reading their valid work.
      modifiers: sql<string>`${kdsOrderLines.modifiers}`,
      currentSaleNumber: sales.saleNumber,
      liveTableName: restaurantTables.name,
    })
    .from(kdsOrderLines)
    .leftJoin(sales, and(eq(sales.id, kdsOrderLines.currentSaleId), eq(sales.tenantId, tenantId)))
    .leftJoin(
      restaurantTables,
      and(
        eq(restaurantTables.id, kdsOrderLines.currentTableId),
        eq(restaurantTables.tenantId, tenantId),
        eq(restaurantTables.siteId, siteId)
      )
    )
    .where(and(eq(kdsOrderLines.tenantId, tenantId), inArray(kdsOrderLines.orderId, boundedIds)))
    .orderBy(kdsOrderLines.createdAt, kdsOrderLines.id)
    .limit(boundedIds.length * KDS_MAX_LINES + 1)
    .all();
  const byOrder = new Map<string, typeof lines>();
  for (const line of lines) {
    const entries = byOrder.get(line.orderId) ?? [];
    entries.push(line);
    byOrder.set(line.orderId, entries);
  }
  return owned.map(order => {
    const response: KdsOrderResponse = {
      id: order.id,
      version: order.version,
      saleId: order.saleId,
      saleNumber: order.saleNumber,
      tableId: order.tableId,
      tableLabel: order.tableLabel,
      multipleDestinations: false,
      station: order.station,
      stationName: order.stationName,
      items: [],
      integrity: 'valid',
      notes: order.notes,
      status: order.status,
      createdAt: order.createdAt,
      readyAt: order.readyAt,
      readyByUserId: order.readyByUserId,
      updatedAt: order.updatedAt,
    };
    try {
      if (order.snapshotVersion === 1) {
        response.items = parseLegacyKitchenItems(order.itemsJson).map(item => ({
          ...item,
          notes: item.notes ?? null,
          unitLabel: null,
          roundId: null,
          roundLabel: null,
          courseKey: null,
          dinerLabel: null,
          modifiers: [],
          id: null,
          version: null,
          status: order.status === 'cancelled' ? 'voided' : order.status,
          currentSaleId: order.saleId,
          currentSaleNumber: order.saleNumber,
          currentTableId: order.tableId,
          currentTableLabel: order.tableLabel,
        }));
      } else {
        if (order.snapshotVersion !== 2 || Buffer.byteLength(order.itemsJson, 'utf8') > 512 * 1024)
          throw new Error('Invalid snapshot version or size');
        // Migration reserves dispatchKey=legacy for adopted headers. Their
        // original bytes remain in the old shape even after line normalization.
        const snapshots =
          order.dispatchKey === 'legacy'
            ? validateKitchenSnapshots(
                parseLegacyKitchenItems(order.itemsJson).map(item => ({
                  ...item,
                  notes: item.notes ?? null,
                  unitLabel: null,
                  roundId: null,
                  roundLabel: null,
                  courseKey: null,
                  dinerLabel: null,
                  modifiers: [],
                }))
              )
            : validateKitchenSnapshots(JSON.parse(order.itemsJson));
        const current = byOrder.get(order.id) ?? [];
        if (current.length !== snapshots.length) throw new Error('Missing kitchen lines');
        const bySource = new Map(current.map(line => [line.sourceSaleItemId, line]));
        response.items = snapshots.map(snapshot => {
          const line = bySource.get(snapshot.saleItemId);
          if (
            !line ||
            !Number.isInteger(line.version) ||
            line.version < 1 ||
            !['pending', 'preparing', 'ready', 'voided'].includes(line.status) ||
            !line.currentSaleNumber ||
            (line.currentTableId && !line.liveTableName) ||
            Buffer.byteLength(line.modifiers, 'utf8') > 32 * 1024
          )
            throw new Error('Invalid kitchen projection');
          const [projected] = validateKitchenSnapshots([
            {
              saleItemId: line.sourceSaleItemId,
              productId: line.productId,
              productName: line.productName,
              quantity: line.quantity,
              unitLabel: line.unitLabel,
              notes: line.notes,
              roundId: line.roundId,
              roundLabel: line.roundLabel,
              courseKey: line.courseKey,
              dinerLabel: line.dinerLabel,
              modifiers: JSON.parse(line.modifiers),
            },
          ]);
          if (JSON.stringify(projected) !== JSON.stringify(snapshot))
            throw new Error('Kitchen snapshot changed');
          return {
            ...snapshot,
            id: line.id,
            version: line.version,
            status: line.status,
            currentSaleId: line.currentSaleId,
            currentSaleNumber: line.currentSaleNumber,
            currentTableId: line.currentTableId,
            currentTableLabel: line.liveTableName ?? line.currentTableLabel,
          };
        });
      }
      const live = response.items.filter(line => line.status !== 'voided');
      const destinations = new Set(live.map(line => line.currentTableId));
      response.multipleDestinations = destinations.size > 1;
      if (live.length) {
        response.tableId = destinations.size === 1 ? live[0]!.currentTableId : null;
        response.tableLabel = destinations.size === 1 ? live[0]!.currentTableLabel : null;
      }
    } catch {
      response.integrity = 'invalid';
      response.items = [];
    }
    return response;
  });
}
