/**
 * post-commit sync enqueue for sale-path inventory-lot mutations.
 *
 * The outbox payload is a snapshot contract, so enqueueing only `{ id,
 * saleId }` is insufficient for a remote peer to apply the changed on-hand
 * and status. Centralizing the read + enqueue also keeps all four sale paths
 * on the same payload shape.
 */

import { and, eq, inArray } from 'drizzle-orm';
import { inventoryLots } from '../../db/schema.js';
import { enqueueSync, type EnqueueSyncContext } from '../sync/enqueue.js';

export async function enqueueInventoryLotUpdatesForSale(
  ctx: EnqueueSyncContext,
  lotIds: readonly string[],
  saleId: string
): Promise<void> {
  const distinctLotIds = [...new Set(lotIds)];
  if (distinctLotIds.length === 0) {
    return;
  }

  const rows = await ctx.db
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
  const rowById = new Map(rows.map(row => [row.id, row]));

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
