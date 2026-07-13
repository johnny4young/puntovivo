/** ENG-206 — Set tenant stock to an absolute value with audit + journal effects. */
import { TRPCError } from '@trpc/server';
import { and, eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';

import { inventoryMovements, products, sites } from '../../db/schema.js';
import { writeAuditLog } from '../../services/audit-logs.js';
import {
  applyInventoryBalanceDelta,
  ensurePrimaryInventoryBalanceSnapshot,
  getPrimarySiteId,
  getProductStockTotal,
} from '../../services/inventory-balances.js';
import { enqueueSync } from '../../services/sync/enqueue.js';
import type { AdjustStockInput } from '../../trpc/schemas/inventory.js';
import {
  getProductForInventory,
  lookupInventoryJournalEventId,
  safeUpdateInventoryAdjustedSummary,
} from './helpers.js';
import type { CriticalInventoryContext } from './types.js';

export async function adjustInventoryStock(
  ctx: CriticalInventoryContext,
  input: AdjustStockInput
) {
  await getProductForInventory(ctx.db, ctx.tenantId, input.productId);

  const now = new Date().toISOString();
  const movementId = nanoid();
  const previousStock = getProductStockTotal(ctx.db, ctx.tenantId, input.productId);
  const delta = input.newStock - previousStock;
  const quantity = Math.abs(delta);
  let resolvedAdjustmentSiteId: string | null = null;

  if (input.siteId) {
    const targetSite = await ctx.db
      .select({ id: sites.id, isActive: sites.isActive })
      .from(sites)
      .where(and(eq(sites.id, input.siteId), eq(sites.tenantId, ctx.tenantId)))
      .get();

    if (!targetSite || targetSite.isActive === false) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: 'Selected adjustment site was not found or is inactive',
      });
    }
  }

  ctx.db.transaction(tx => {
    const primarySiteId = getPrimarySiteId(tx, ctx.tenantId);
    const resolvedSiteId = input.siteId ?? ctx.siteId ?? primarySiteId;
    resolvedAdjustmentSiteId = resolvedSiteId;

    if (
      resolvedSiteId &&
      primarySiteId &&
      resolvedSiteId !== primarySiteId &&
      delta !== 0
    ) {
      ensurePrimaryInventoryBalanceSnapshot(tx, {
        tenantId: ctx.tenantId,
        productId: input.productId,
        onHandSnapshot: previousStock,
        now,
      });
    }

    applyInventoryBalanceDelta(tx, {
      tenantId: ctx.tenantId,
      siteId: resolvedSiteId,
      productId: input.productId,
      delta,
      initialOnHandIfMissing:
        resolvedSiteId && resolvedSiteId === primarySiteId ? previousStock : 0,
      now,
    });

    tx.insert(inventoryMovements)
      .values({
        id: movementId,
        tenantId: ctx.tenantId,
        productId: input.productId,
        type: 'adjustment',
        quantity,
        previousStock,
        newStock: input.newStock,
        reference: 'manual-adjustment',
        notes: input.notes,
        createdBy: ctx.user.id,
        syncStatus: 'pending',
        syncVersion: 1,
        createdAt: now,
      })
      .run();

    // Preserve the legacy contract: no-op adjustments still write a zero
    // movement + outbox row, but do not pollute the audit timeline.
    if (delta !== 0) {
      writeAuditLog({
        tx,
        tenantId: ctx.tenantId,
        actorId: ctx.user.id,
        action: 'inventory.adjust_stock',
        resourceType: 'product',
        resourceId: input.productId,
        before: { stock: previousStock },
        after: { stock: input.newStock },
        metadata: {
          delta,
          ...(resolvedSiteId ? { siteId: resolvedSiteId } : {}),
          ...(input.notes ? { notes: input.notes } : {}),
          movementId,
        },
      });
    }
  });

  await enqueueSync(ctx, {
    entityType: 'inventory_movements',
    entityId: movementId,
    operation: 'create',
    data: { id: movementId, productId: input.productId, newStock: input.newStock },
  });

  const journalEventId = await lookupInventoryJournalEventId(
    ctx.db,
    ctx.tenantId,
    ctx.envelope.operationId
  );
  if (journalEventId && resolvedAdjustmentSiteId) {
    await safeUpdateInventoryAdjustedSummary(ctx, journalEventId, {
      productId: input.productId,
      siteId: resolvedAdjustmentSiteId,
      locationId: null,
      quantityBefore: previousStock,
      quantityAfter: input.newStock,
      delta,
      reasonCode: input.notes ?? null,
    });
  }

  const updatedProduct = await ctx.db
    .select()
    .from(products)
    .where(eq(products.id, input.productId))
    .get();
  const derivedStock = getProductStockTotal(ctx.db, ctx.tenantId, input.productId);

  return { product: { ...updatedProduct!, stock: derivedStock }, movementId };
}
