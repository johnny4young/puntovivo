/** Normalize existing evidence without manufacturing a new kitchen submission. */
import { and, eq, inArray } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { z } from 'zod';
import type { DatabaseInstance } from '../../db/index.js';
import { kdsLineDispatches, kdsOrderLines, kdsOrders, type KdsOrderRow } from '../../db/schema.js';
import { throwServerError } from '../../lib/errorCodes.js';
import { KDS_MAX_LINES, type KdsWriteScope } from './common.js';
import { insertKitchenEvent } from './events.js';

const legacyLine = z.object({
  saleItemId: z.string().min(1).max(128),
  productId: z.string().min(1).max(128),
  productName: z
    .string()
    .min(1)
    .max(500)
    .refine(value => value.trim().length > 0),
  quantity: z.number().finite().positive().max(1_000_000_000),
  notes: z.string().max(8_192).nullable().optional(),
});
const legacyLines = z.array(legacyLine).min(1).max(KDS_MAX_LINES);

/** Strict all-or-nothing legacy decoder; the original blob always remains untouched. */
export function parseLegacyKitchenItems(blob: string): z.infer<typeof legacyLines> {
  let parsed: unknown;
  try {
    if (Buffer.byteLength(blob, 'utf8') > 512 * 1024) throw new Error('oversized');
    parsed = JSON.parse(blob);
  } catch {
    throwServerError({
      trpcCode: 'CONFLICT',
      errorCode: 'KDS_SNAPSHOT_INVALID',
      message: 'Kitchen snapshot cannot be decoded',
    });
  }
  const result = legacyLines.safeParse(parsed);
  if (
    !result.success ||
    new Set(result.data.map(item => item.saleItemId)).size !== result.data.length
  ) {
    throwServerError({
      trpcCode: 'CONFLICT',
      errorCode: 'KDS_SNAPSHOT_INVALID',
      message: 'Kitchen snapshot is incomplete or duplicated',
    });
  }
  return result.data;
}

/** Adoption preserves known state and records its origin, but does not send or re-prepare food. */
export function adoptLegacyKitchenOrder(tx: DatabaseInstance, order: KdsOrderRow): KdsOrderRow {
  if (order.snapshotVersion === 2) return order;
  if (order.snapshotVersion !== 1) {
    throwServerError({
      trpcCode: 'CONFLICT',
      errorCode: 'KDS_SNAPSHOT_INVALID',
      message: 'Unknown kitchen snapshot version',
    });
  }
  const items = parseLegacyKitchenItems(order.itemsJson);
  const existing = tx
    .select({ id: kdsOrderLines.id })
    .from(kdsOrderLines)
    .where(
      and(
        eq(kdsOrderLines.tenantId, order.tenantId),
        inArray(
          kdsOrderLines.sourceSaleItemId,
          items.map(item => item.saleItemId)
        )
      )
    )
    .limit(1)
    .get();
  const decision = tx
    .select({ id: kdsLineDispatches.id })
    .from(kdsLineDispatches)
    .where(
      and(
        eq(kdsLineDispatches.tenantId, order.tenantId),
        inArray(
          kdsLineDispatches.sourceSaleItemId,
          items.map(item => item.saleItemId)
        )
      )
    )
    .limit(1)
    .get();
  if (existing || decision) {
    throwServerError({
      trpcCode: 'CONFLICT',
      errorCode: 'KDS_SNAPSHOT_INVALID',
      message: 'Legacy preparation overlaps another ticket',
    });
  }
  for (const item of items) {
    const lineId = nanoid();
    tx.insert(kdsOrderLines)
      .values({
        id: lineId,
        tenantId: order.tenantId,
        orderId: order.id,
        sourceSaleItemId: item.saleItemId,
        productId: item.productId,
        productName: item.productName,
        quantity: item.quantity,
        notes: item.notes ?? null,
        modifiers: [],
        currentSaleId: order.saleId,
        currentTableId: order.tableId,
        currentTableLabel: order.tableLabel,
        status: order.status === 'cancelled' ? 'voided' : order.status,
        readyAt: order.readyAt,
        readyByUserId: order.readyByUserId,
        createdAt: order.createdAt,
        updatedAt: order.updatedAt,
      })
      .run();
    tx.insert(kdsLineDispatches)
      .values({
        id: nanoid(),
        tenantId: order.tenantId,
        siteId: order.siteId,
        sourceSaleItemId: item.saleItemId,
        route: 'station',
        stationCode: order.station,
        orderLineId: lineId,
        createdAt: order.createdAt,
      })
      .run();
  }
  tx.update(kdsOrders)
    .set({ snapshotVersion: 2 })
    .where(
      and(
        eq(kdsOrders.id, order.id),
        eq(kdsOrders.tenantId, order.tenantId),
        eq(kdsOrders.snapshotVersion, 1)
      )
    )
    .run();
  const adopted = { ...order, snapshotVersion: 2 };
  insertKitchenEvent(tx, adopted, {
    kind: 'adopted',
    actorId: null,
    facts: { source: 'legacy', lineCount: items.length },
    notify: false,
  });
  return adopted;
}

/** Bound legacy adoption to the affected sale, not an unbounded tenant-wide boot scan. */
export function adoptLegacyKitchenSale(
  tx: DatabaseInstance,
  scope: KdsWriteScope,
  saleId: string
): void {
  const rows = tx
    .select()
    .from(kdsOrders)
    .where(
      and(
        eq(kdsOrders.tenantId, scope.tenantId),
        eq(kdsOrders.siteId, scope.siteId),
        eq(kdsOrders.saleId, saleId),
        eq(kdsOrders.snapshotVersion, 1)
      )
    )
    .limit(KDS_MAX_LINES + 1)
    .all();
  if (rows.length > KDS_MAX_LINES) {
    throwServerError({
      trpcCode: 'CONFLICT',
      errorCode: 'KDS_ORDER_LIMIT_EXCEEDED',
      message: 'Too many legacy kitchen tickets for one sale',
    });
  }
  for (const row of rows) adoptLegacyKitchenOrder(tx, row);
}
