/** Set tenant stock to an absolute value with audit + journal effects. */
import { TRPCError } from '@trpc/server';
import { and, eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';

import { inventoryBalances, inventoryMovements, products, sites } from '../../db/schema.js';
import { writeAuditLog } from '../../services/audit-logs.js';
import {
  applyInventoryBalanceDelta,
  ensurePrimaryInventoryBalanceSnapshot,
  getPrimarySiteId,
  getProductStockTotal,
} from '../../services/inventory-balances.js';
import { assertAggregateStockMutationAllowed } from '../../services/products/lot-tracking.js';
import { enqueueSync } from '../../services/sync/enqueue.js';
import type { AdjustStockInput } from '../../trpc/schemas/inventory.js';
import {
  getProductForInventory,
  lookupInventoryJournalEventId,
  safeUpdateInventoryAdjustedSummary,
} from './helpers.js';
import type { CriticalInventoryContext } from './types.js';
import { throwServerError } from '../../lib/errorCodes.js';

export async function adjustInventoryStock(ctx: CriticalInventoryContext, input: AdjustStockInput) {
  // Fast tenant-scoped preflight. Product policy and stock are re-read under
  // the writer reservation below.
  await getProductForInventory(ctx.db, ctx.tenantId, input.productId);

  const now = new Date().toISOString();
  const movementId = nanoid();
  let previousStock = 0;
  let delta = 0;
  let quantity = 0;
  let resolvedAdjustmentSiteId: string | null = null;

  ctx.db.transaction(
    tx => {
      const product = tx
        .select({
          id: products.id,
          tracksLots: products.tracksLots,
          tracksSerials: products.tracksSerials,
          catalogType: products.catalogType,
        })
        .from(products)
        .where(and(eq(products.id, input.productId), eq(products.tenantId, ctx.tenantId)))
        .get();
      if (!product) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Product not found' });
      }

      previousStock = getProductStockTotal(tx, ctx.tenantId, input.productId);
      delta = input.newStock - previousStock;
      quantity = Math.abs(delta);
      assertAggregateStockMutationAllowed({
        tracksLots: product.tracksLots,
        tracksSerials: product.tracksSerials,
        catalogType: product.catalogType,
        delta,
      });

      const primarySiteId = getPrimarySiteId(tx, ctx.tenantId);
      const resolvedSiteId = input.siteId ?? ctx.siteId ?? primarySiteId;
      if (!resolvedSiteId) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'An active site is required to adjust inventory',
        });
      }
      const targetSite = tx
        .select({ id: sites.id, isActive: sites.isActive })
        .from(sites)
        .where(and(eq(sites.id, resolvedSiteId), eq(sites.tenantId, ctx.tenantId)))
        .get();
      if (!targetSite || targetSite.isActive === false) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Selected adjustment site was not found or is inactive',
        });
      }
      resolvedAdjustmentSiteId = resolvedSiteId;

      if (primarySiteId && resolvedSiteId !== primarySiteId && delta !== 0) {
        ensurePrimaryInventoryBalanceSnapshot(tx, {
          tenantId: ctx.tenantId,
          productId: input.productId,
          onHandSnapshot: previousStock,
          now,
        });
      }

      const targetBalance = tx
        .select({ onHand: inventoryBalances.onHand })
        .from(inventoryBalances)
        .where(
          and(
            eq(inventoryBalances.tenantId, ctx.tenantId),
            eq(inventoryBalances.siteId, resolvedSiteId),
            eq(inventoryBalances.productId, input.productId)
          )
        )
        .get();
      const targetOnHand =
        targetBalance?.onHand ?? (resolvedSiteId === primarySiteId ? previousStock : 0);
      if (delta < 0 && targetOnHand < Math.abs(delta)) {
        throwServerError({
          trpcCode: 'BAD_REQUEST',
          errorCode: 'INVENTORY_ADJUSTMENT_SITE_STOCK_INSUFFICIENT',
          message: 'The selected site cannot absorb this tenant-wide stock reduction',
          details: {
            siteId: resolvedSiteId,
            available: targetOnHand,
            requestedReduction: Math.abs(delta),
          },
        });
      }

      applyInventoryBalanceDelta(tx, {
        tenantId: ctx.tenantId,
        siteId: resolvedSiteId,
        productId: input.productId,
        delta,
        initialOnHandIfMissing: resolvedSiteId === primarySiteId ? previousStock : 0,
        now,
      });

      tx.insert(inventoryMovements)
        .values({
          id: movementId,
          tenantId: ctx.tenantId,
          productId: input.productId,
          siteId: resolvedSiteId,
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
    },
    { behavior: 'immediate' }
  );

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
    .where(and(eq(products.id, input.productId), eq(products.tenantId, ctx.tenantId)))
    .get();
  const derivedStock = getProductStockTotal(ctx.db, ctx.tenantId, input.productId);

  return { product: { ...updatedProduct!, stock: derivedStock }, movementId };
}
