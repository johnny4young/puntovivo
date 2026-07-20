/**
 * Return (partially or fully) a completed purchase, reversing stock.
 *
 * extracted from the former monolithic `trpc/routers/purchases.ts`
 * during the megafile decomposition. The status guards + the return
 * transaction (per-item stock reversal + balance delta + movement, return
 * record + lines, status transition) relocate verbatim; the tRPC procedure
 * adapts its context and calls this use-case.
 *
 * @module application/purchases/returnPurchase
 */
import { TRPCError } from '@trpc/server';
import { and, eq, inArray } from 'drizzle-orm';
import { nanoid } from 'nanoid';

import {
  inventoryMovements,
  products,
  purchaseReturnItems,
  purchaseReturns,
  purchases,
} from '../../db/schema.js';
import { enqueueSync } from '../../services/sync/enqueue.js';
import {
  applyInventoryBalanceDelta,
  getProductStockTotals,
} from '../../services/inventory-balances.js';
import { returnPurchasedProductSerials } from '../../services/product-serials.js';
import type { ReturnPurchaseInput } from '../../trpc/schemas/purchases.js';
import { buildReturnedPurchaseNotes, getInventoryBalanceStateForSite } from './helpers.js';
import { getPurchaseRecord } from './purchase-read.js';
import { resolvePurchaseReturnItems } from './resolveItems.js';
import type { PurchaseContext } from './types.js';

export async function returnPurchase(ctx: PurchaseContext, input: ReturnPurchaseInput) {
  const existing = await ctx.db
    .select()
    .from(purchases)
    .where(and(eq(purchases.id, input.id), eq(purchases.tenantId, ctx.tenantId)))
    .get();

  if (!existing) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'Purchase not found' });
  }

  if (existing.status === 'voided') {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: 'Voided purchases cannot be returned',
    });
  }

  if (existing.status === 'returned') {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: 'Purchase has already been fully returned',
    });
  }

  if (existing.status !== 'completed' && existing.status !== 'partial_returned') {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: 'Only completed purchases can be returned',
    });
  }

  const resolvedReturn = await resolvePurchaseReturnItems(
    ctx.db,
    ctx.tenantId,
    input.id,
    input.items
  );

  const productIds = [...new Set(resolvedReturn.rows.map(item => item.productId))];
  const currentProducts = await ctx.db
    .select({
      id: products.id,
      name: products.name,
    })
    .from(products)
    .where(and(eq(products.tenantId, ctx.tenantId), inArray(products.id, productIds)))
    .all();

  const productById = new Map(currentProducts.map(product => [product.id, product]));
  // Tenant-wide stock is derived from Σ(inventory_balances.on_hand); track a
  // mutable snapshot so a product appearing twice reverses correctly.
  const tenantStockState = getProductStockTotals(ctx.db, ctx.tenantId, productIds);
  const siteBalanceState = await getInventoryBalanceStateForSite(
    ctx.db,
    ctx.tenantId,
    existing.siteId,
    productIds
  );
  const nextSyncVersion = (existing.syncVersion ?? 0) + 1;
  const now = new Date().toISOString();
  const purchaseReturnId = nanoid();
  const nextStatus =
    resolvedReturn.totalFullyReturnedItems === resolvedReturn.totalItemCount
      ? 'returned'
      : 'partial_returned';

  ctx.db.transaction(tx => {
    tx.insert(purchaseReturns)
      .values({
        id: purchaseReturnId,
        tenantId: ctx.tenantId,
        purchaseId: input.id,
        returnAmount: resolvedReturn.returnAmount,
        reason: input.reason,
        createdBy: ctx.user!.id,
        syncStatus: 'pending',
        syncVersion: 1,
        createdAt: now,
        updatedAt: now,
      })
      .run();

    for (const item of resolvedReturn.rows) {
      const product = productById.get(item.productId);

      if (!product) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: `Product ${item.productId} was not found while returning the purchase`,
        });
      }

      const previousStock = tenantStockState.get(item.productId) ?? 0;
      const currentSiteBalance = siteBalanceState.get(item.productId) ?? 0;

      // The purchase site's balance is the authoritative constraint (you can
      // only reverse stock that is physically at that site). Check it first;
      // the tenant-wide total is Σ(all sites) ≥ this site, so it can only fail
      // when the site already has — it stays as a defensive secondary guard.
      if (currentSiteBalance < item.normalizedQuantity) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: `Cannot return purchase items because the purchase site only has ${currentSiteBalance} units available`,
        });
      }

      if (previousStock < item.normalizedQuantity) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: `Cannot return purchase items because product "${product.name}" only has ${previousStock} units in stock`,
        });
      }

      const newStock = previousStock - item.normalizedQuantity;
      const newSiteBalance = currentSiteBalance - item.normalizedQuantity;
      tenantStockState.set(item.productId, newStock);
      siteBalanceState.set(item.productId, newSiteBalance);

      tx.insert(purchaseReturnItems)
        .values({
          id: item.id,
          purchaseReturnId,
          purchaseItemId: item.purchaseItemId,
          productId: item.productId,
          quantity: item.quantity,
          unitId: item.unitId,
          unitEquivalence: item.unitEquivalence,
          costPerUnit: item.costPerUnit,
          baseUnitCost: item.baseUnitCost,
          total: item.total,
        })
        .run();

      if (item.tracksSerials) {
        returnPurchasedProductSerials(tx as unknown as typeof ctx.db, {
          tenantId: ctx.tenantId,
          siteId: existing.siteId,
          purchaseItemId: item.purchaseItemId,
          productId: item.productId,
          serialIds: item.serialIds,
          quantity: item.normalizedQuantity,
          now,
          syncContext: { ...ctx, db: tx as unknown as typeof ctx.db },
        });
      }

      applyInventoryBalanceDelta(tx, {
        tenantId: ctx.tenantId,
        siteId: existing.siteId,
        productId: item.productId,
        delta: -item.normalizedQuantity,
        initialOnHandIfMissing: currentSiteBalance,
        serialAware: item.tracksSerials,
        now,
      });

      tx.insert(inventoryMovements)
        .values({
          id: nanoid(),
          tenantId: ctx.tenantId,
          productId: item.productId,
          type: 'return',
          quantity: -item.normalizedQuantity,
          previousStock,
          newStock,
          reference: purchaseReturnId,
          notes: `Returned purchase ${existing.purchaseNumber}`,
          createdBy: ctx.user!.id,
          syncStatus: 'pending',
          syncVersion: 1,
          createdAt: now,
        })
        .run();
    }

    tx.update(purchases)
      .set({
        status: nextStatus,
        notes: buildReturnedPurchaseNotes(existing.notes, input.reason),
        updatedAt: now,
        syncStatus: 'pending',
        syncVersion: nextSyncVersion,
      })
      .where(eq(purchases.id, input.id))
      .run();
  });

  for (const item of resolvedReturn.rows) {
    await enqueueSync(ctx, {
      entityType: 'purchase_return_items',
      entityId: item.id,
      operation: 'create',
      data: {
        id: item.id,
        purchaseReturnId,
        purchaseItemId: item.purchaseItemId,
        productId: item.productId,
        quantity: item.quantity,
        unitId: item.unitId,
        total: item.total,
      },
    });
  }

  await enqueueSync(ctx, {
    entityType: 'purchase_returns',
    entityId: purchaseReturnId,
    operation: 'create',
    data: {
      id: purchaseReturnId,
      purchaseId: input.id,
      returnAmount: resolvedReturn.returnAmount,
      reason: input.reason ?? null,
    },
  });

  await enqueueSync(ctx, {
    entityType: 'purchases',
    entityId: input.id,
    operation: 'update',
    data: {
      id: input.id,
      status: nextStatus,
      reason: input.reason ?? null,
      returnId: purchaseReturnId,
    },
  });

  return getPurchaseRecord(ctx.db, ctx.tenantId, input.id);
}
