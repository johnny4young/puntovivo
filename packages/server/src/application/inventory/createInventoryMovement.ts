/** Create a typed movement and atomically apply its stock delta. */
import { TRPCError } from '@trpc/server';
import { and, eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';

import { inventoryMovements, products } from '../../db/schema.js';
import {
  applyInventoryBalanceDelta,
  getPrimarySiteId,
  getProductStockTotal,
} from '../../services/inventory-balances.js';
import { assertAggregateStockMutationAllowed } from '../../services/products/lot-tracking.js';
import { enqueueSync } from '../../services/sync/enqueue.js';
import type { CreateMovementInput } from '../../trpc/schemas/inventory.js';
import type { InventoryContext } from './types.js';

export async function createInventoryMovement(ctx: InventoryContext, input: CreateMovementInput) {
  const now = new Date().toISOString();
  const product = await ctx.db
    .select()
    .from(products)
    .where(and(eq(products.id, input.productId), eq(products.tenantId, ctx.tenantId)))
    .get();

  if (!product) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'Product not found' });
  }

  const previousStock = getProductStockTotal(ctx.db, ctx.tenantId, input.productId);
  const isDeduction = input.type === 'sale' || input.type === 'transfer';
  const newStock = isDeduction ? previousStock - input.quantity : previousStock + input.quantity;

  if (newStock < 0) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: `Insufficient stock. Available: ${previousStock}, requested: ${input.quantity}`,
    });
  }

  const movementId = nanoid();
  const stockDelta = newStock - previousStock;
  assertAggregateStockMutationAllowed({
    tracksLots: product.tracksLots,
    tracksSerials: product.tracksSerials,
    catalogType: product.catalogType,
    delta: stockDelta,
  });

  ctx.db.transaction(tx => {
    tx.insert(inventoryMovements)
      .values({
        id: movementId,
        tenantId: ctx.tenantId,
        productId: input.productId,
        type: input.type,
        quantity: input.quantity,
        previousStock,
        newStock,
        reference: input.reference,
        notes: input.notes,
        createdBy: ctx.user.id,
        syncStatus: 'pending',
        syncVersion: 1,
        createdAt: now,
      })
      .run();

    const primarySiteId = getPrimarySiteId(tx, ctx.tenantId);
    const movementSiteId = ctx.siteId ?? primarySiteId;
    if (movementSiteId) {
      applyInventoryBalanceDelta(tx, {
        tenantId: ctx.tenantId,
        siteId: movementSiteId,
        productId: input.productId,
        delta: stockDelta,
        initialOnHandIfMissing: movementSiteId === primarySiteId ? previousStock : 0,
        now,
      });
    }
  });

  await enqueueSync(ctx, {
    entityType: 'inventory_movements',
    entityId: movementId,
    operation: 'create',
    data: { id: movementId, productId: input.productId, newStock },
  });

  const created = await ctx.db
    .select()
    .from(inventoryMovements)
    .where(eq(inventoryMovements.id, movementId))
    .get();

  return created!;
}
