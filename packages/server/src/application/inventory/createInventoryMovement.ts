/** Create a typed movement and atomically apply its stock delta. */
import { TRPCError } from '@trpc/server';
import { and, eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';

import { inventoryMovements, products, sites } from '../../db/schema.js';
import { throwServerError } from '../../lib/errorCodes.js';
import { writeAuditLog } from '../../services/audit-logs.js';
import {
  applyInventoryBalanceDelta,
  getPrimarySiteId,
  getProductStockTotal,
} from '../../services/inventory-balances.js';
import { assertAggregateStockMutationAllowed } from '../../services/products/lot-tracking.js';
import { enqueueSync } from '../../services/sync/enqueue.js';
import type { CreateMovementInput } from '../../trpc/schemas/inventory.js';
import type { CriticalInventoryContext } from './types.js';

export async function createInventoryMovement(
  ctx: CriticalInventoryContext,
  input: CreateMovementInput
) {
  // Sales, purchases, transfers and returns own additional financial,
  // document and identity writes. Letting this compatibility endpoint forge
  // those movement types creates a stock ledger that claims a domain event
  // happened when no corresponding aggregate exists.
  if (input.type !== 'adjustment') {
    throwServerError({
      trpcCode: 'BAD_REQUEST',
      errorCode: 'INVENTORY_MANUAL_MOVEMENT_TYPE_RESERVED',
      message: 'Manual inventory movements may only use the adjustment type',
      details: { requestedType: input.type },
    });
  }

  const now = new Date().toISOString();
  const preflightProduct = await ctx.db
    .select()
    .from(products)
    .where(and(eq(products.id, input.productId), eq(products.tenantId, ctx.tenantId)))
    .get();

  if (!preflightProduct) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'Product not found' });
  }

  const movementId = nanoid();
  let previousStock = 0;
  let newStock = 0;
  let movementSiteId: string | null = null;

  ctx.db.transaction(
    tx => {
      const product = tx
        .select()
        .from(products)
        .where(and(eq(products.id, input.productId), eq(products.tenantId, ctx.tenantId)))
        .get();
      if (!product) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Product not found' });
      }
      assertAggregateStockMutationAllowed({
        tracksLots: product.tracksLots,
        tracksSerials: product.tracksSerials,
        catalogType: product.catalogType,
        delta: input.quantity,
      });
      if (product.isActive === false) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Product not found or inactive' });
      }

      const primarySiteId = getPrimarySiteId(tx, ctx.tenantId);
      movementSiteId = ctx.siteId ?? primarySiteId;
      if (!movementSiteId) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'An active site is required to create an inventory movement',
        });
      }
      const site = tx
        .select({ id: sites.id, isActive: sites.isActive })
        .from(sites)
        .where(and(eq(sites.id, movementSiteId), eq(sites.tenantId, ctx.tenantId)))
        .get();
      if (!site || site.isActive === false) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Selected inventory site was not found or is inactive',
        });
      }

      previousStock = getProductStockTotal(tx, ctx.tenantId, input.productId);
      newStock = previousStock + input.quantity;
      applyInventoryBalanceDelta(tx, {
        tenantId: ctx.tenantId,
        siteId: movementSiteId,
        productId: input.productId,
        delta: input.quantity,
        initialOnHandIfMissing: movementSiteId === primarySiteId ? previousStock : 0,
        now,
      });

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

      writeAuditLog({
        tx,
        tenantId: ctx.tenantId,
        actorId: ctx.user.id,
        action: 'inventory.adjust_stock',
        resourceType: 'product',
        resourceId: input.productId,
        before: { stock: previousStock },
        after: { stock: newStock },
        metadata: {
          movementId,
          siteId: movementSiteId,
          quantity: input.quantity,
          ...(input.reference ? { reference: input.reference } : {}),
          ...(input.notes ? { notes: input.notes } : {}),
        },
      });
    },
    { behavior: 'immediate' }
  );

  await enqueueSync(ctx, {
    entityType: 'inventory_movements',
    entityId: movementId,
    operation: 'create',
    data: { id: movementId, productId: input.productId, newStock },
  });

  const created = await ctx.db
    .select()
    .from(inventoryMovements)
    .where(
      and(eq(inventoryMovements.id, movementId), eq(inventoryMovements.tenantId, ctx.tenantId))
    )
    .get();

  return created!;
}
