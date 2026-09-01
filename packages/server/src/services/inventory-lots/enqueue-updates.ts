/**
 * sync enqueue for sale-path inventory-lot mutations.
 *
 * The outbox payload is a snapshot contract, so enqueueing only `{ id,
 * saleId }` is insufficient for a remote peer to apply the changed on-hand
 * and status. Centralizing the read + enqueue also keeps all four sale paths
 * on the same payload shape.
 */

import { and, eq, inArray } from 'drizzle-orm';
import { inventoryLots } from '../../db/schema.js';
import { enqueueSync, enqueueSyncInTransaction, type EnqueueSyncContext } from '../sync/enqueue.js';

function loadSaleLotSnapshots(ctx: EnqueueSyncContext, lotIds: readonly string[]) {
  const distinctLotIds = [...new Set(lotIds)];
  if (distinctLotIds.length === 0) {
    return { distinctLotIds, rowById: new Map() };
  }

  const rows = ctx.db
    .select({
      id: inventoryLots.id,
      siteId: inventoryLots.siteId,
      productId: inventoryLots.productId,
      lotNumber: inventoryLots.lotNumber,
      expiresAt: inventoryLots.expiresAt,
      onHand: inventoryLots.onHand,
      unitCost: inventoryLots.unitCost,
      status: inventoryLots.status,
      receivedAt: inventoryLots.receivedAt,
      notes: inventoryLots.notes,
      syncVersion: inventoryLots.syncVersion,
      createdAt: inventoryLots.createdAt,
      updatedAt: inventoryLots.updatedAt,
    })
    .from(inventoryLots)
    .where(and(eq(inventoryLots.tenantId, ctx.tenantId), inArray(inventoryLots.id, distinctLotIds)))
    .all();
  return { distinctLotIds, rowById: new Map(rows.map(row => [row.id, row])) };
}

export async function enqueueInventoryLotUpdatesForSale(
  ctx: EnqueueSyncContext,
  lotIds: readonly string[],
  saleId: string
): Promise<void> {
  const { distinctLotIds, rowById } = loadSaleLotSnapshots(ctx, lotIds);

  for (const lotId of distinctLotIds) {
    const row = rowById.get(lotId);
    if (!row) {
      continue;
    }
    await enqueueSync(ctx, {
      entityType: 'inventory_lots',
      entityId: lotId,
      operation: 'update',
      data: { ...row, saleId },
    });
  }
}

/**
 * Enqueue the exact post-consumption lot snapshots while the sale transaction
 * is still open. The returned ids let the operation journal describe the
 * atomic outbox writes after commit without making observability fatal.
 */
export function enqueueInventoryLotUpdatesForSaleInTransaction(
  ctx: EnqueueSyncContext,
  lotIds: readonly string[],
  saleId: string
): string[] {
  const { distinctLotIds, rowById } = loadSaleLotSnapshots(ctx, lotIds);
  const outboxIds: string[] = [];
  for (const lotId of distinctLotIds) {
    const row = rowById.get(lotId);
    if (!row) continue;
    outboxIds.push(
      enqueueSyncInTransaction(ctx, {
        entityType: 'inventory_lots',
        entityId: lotId,
        operation: 'update',
        data: { ...row, saleId },
      }).id
    );
  }
  return outboxIds;
}
