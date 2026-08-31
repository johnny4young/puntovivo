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
import { and, eq, inArray, isNull } from 'drizzle-orm';
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

  const now = new Date().toISOString();
  const purchaseReturnId = nanoid();
  let resolvedReturn!: ReturnType<typeof resolvePurchaseReturnItems>;
  let nextStatus: 'returned' | 'partial_returned' = 'partial_returned';

  ctx.db.transaction(
    tx => {
      // Re-read every mutable input while holding the SQLite writer
      // reservation. Two callers must not both observe the same remaining
      // return quantity or the same site balance.
      const current = tx
        .select()
        .from(purchases)
        .where(and(eq(purchases.id, input.id), eq(purchases.tenantId, ctx.tenantId)))
        .get();
      if (!current) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Purchase not found' });
      }
      if (current.status === 'voided') {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Voided purchases cannot be returned',
        });
      }
      if (current.status === 'returned') {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Purchase has already been fully returned',
        });
      }
      if (current.status !== 'completed' && current.status !== 'partial_returned') {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Only completed purchases can be returned',
        });
      }

      resolvedReturn = resolvePurchaseReturnItems(tx, ctx.tenantId, input.id, input.items);
      const productIds = [...new Set(resolvedReturn.rows.map(item => item.productId))];
      const currentProducts = tx
        .select({ id: products.id, name: products.name })
        .from(products)
        .where(and(eq(products.tenantId, ctx.tenantId), inArray(products.id, productIds)))
        .all();
      const productById = new Map(currentProducts.map(product => [product.id, product]));
      // Read stock after acquiring the writer reservation. The mutable maps
      // keep repeated products coherent within this return.
      const tenantStockState = getProductStockTotals(tx, ctx.tenantId, productIds);
      const siteBalanceState = getInventoryBalanceStateForSite(
        tx,
        ctx.tenantId,
        current.siteId,
        productIds
      );
      const nextSyncVersion = (current.syncVersion ?? 0) + 1;
      nextStatus =
        resolvedReturn.totalFullyReturnedItems === resolvedReturn.totalItemCount
          ? 'returned'
          : 'partial_returned';

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
            siteId: current.siteId,
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
          siteId: current.siteId,
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
            notes: `Returned purchase ${current.purchaseNumber}`,
            createdBy: ctx.user!.id,
            syncStatus: 'pending',
            syncVersion: 1,
            createdAt: now,
          })
          .run();
      }

      const expectedSyncVersion =
        current.syncVersion === null
          ? isNull(purchases.syncVersion)
          : eq(purchases.syncVersion, current.syncVersion);
      const updated = tx
        .update(purchases)
        .set({
          status: nextStatus,
          notes: buildReturnedPurchaseNotes(current.notes, input.reason),
          updatedAt: now,
          syncStatus: 'pending',
          syncVersion: nextSyncVersion,
        })
        .where(
          and(
            eq(purchases.id, input.id),
            eq(purchases.tenantId, ctx.tenantId),
            eq(purchases.status, current.status),
            expectedSyncVersion,
            eq(purchases.updatedAt, current.updatedAt)
          )
        )
        .run();
      if (updated.changes !== 1) {
        throw new TRPCError({
          code: 'CONFLICT',
          message: 'The purchase changed while its return was being recorded',
        });
      }
    },
    { behavior: 'immediate' }
  );

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
