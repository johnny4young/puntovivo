/**
 * Void a completed purchase, reversing destination-site stock.
 *
 * ENG-178 — extracted from the former monolithic `trpc/routers/purchases.ts`
 * during the megafile decomposition. The status guards + the void
 * transaction (per-item stock reversal + the in-transaction `writeAuditLog`,
 * ENG-007) relocate verbatim; the tRPC procedure adapts its context and
 * calls this use-case.
 *
 * @module application/purchases/voidPurchase
 */
import { TRPCError } from '@trpc/server';
import { and, eq, inArray } from 'drizzle-orm';
import { nanoid } from 'nanoid';

import { inventoryMovements, products, purchaseItems, purchases } from '../../db/schema.js';
import { enqueueSync } from '../../services/sync/enqueue.js';
import {
  applyInventoryBalanceDelta,
  getProductStockTotals,
} from '../../services/inventory-balances.js';
import { assertAggregateStockMutationAllowed } from '../../services/products/lot-tracking.js';
import { writeAuditLog } from '../../services/audit-logs.js';
import type { VoidPurchaseInput } from '../../trpc/schemas/purchases.js';
import {
  buildVoidedPurchaseNotes,
  getInventoryBalanceStateForSite,
  getNormalizedPurchaseQuantity,
} from './helpers.js';
import { getPurchaseRecord } from './purchase-read.js';
import type { PurchaseContext } from './types.js';

export async function voidPurchase(ctx: PurchaseContext, input: VoidPurchaseInput) {
  const existing = await ctx.db
    .select()
    .from(purchases)
    .where(and(eq(purchases.id, input.id), eq(purchases.tenantId, ctx.tenantId)))
    .get();

  if (!existing) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'Purchase not found' });
  }

  if (existing.status === 'voided') {
    throw new TRPCError({ code: 'BAD_REQUEST', message: 'Purchase is already voided' });
  }

  if (existing.status !== 'completed') {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: 'Only completed purchases can be voided',
    });
  }

  const purchaseLineItems = await ctx.db
    .select({
      id: purchaseItems.id,
      productId: purchaseItems.productId,
      quantity: purchaseItems.quantity,
      unitEquivalence: purchaseItems.unitEquivalence,
    })
    .from(purchaseItems)
    .where(eq(purchaseItems.purchaseId, input.id))
    .all();

  if (purchaseLineItems.length === 0) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: 'Cannot void a purchase without line items',
    });
  }

  const productIds = [...new Set(purchaseLineItems.map(item => item.productId))];
  const currentProducts = await ctx.db
    .select({
      id: products.id,
      name: products.name,
      tracksLots: products.tracksLots,
      catalogType: products.catalogType,
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

  ctx.db.transaction(tx => {
    for (const item of purchaseLineItems) {
      const normalizedQuantity = getNormalizedPurchaseQuantity(item.quantity, item.unitEquivalence);
      const product = productById.get(item.productId);

      if (!product) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: `Product ${item.productId} was not found while voiding the purchase`,
        });
      }

      assertAggregateStockMutationAllowed({
        tracksLots: product.tracksLots,
        catalogType: product.catalogType,
        delta: -normalizedQuantity,
      });

      const previousStock = tenantStockState.get(item.productId) ?? 0;
      const currentSiteBalance = siteBalanceState.get(item.productId) ?? 0;

      // The purchase site's balance is the authoritative constraint (you can
      // only reverse stock that is physically at that site). Check it first;
      // the tenant-wide total is Σ(all sites) ≥ this site, so the tenant guard
      // below stays only as a defensive secondary check.
      if (currentSiteBalance < normalizedQuantity) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: `Cannot void purchase because the purchase site only has ${currentSiteBalance} units in stock`,
        });
      }

      if (previousStock < normalizedQuantity) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: `Cannot void purchase because product "${product.name}" only has ${previousStock} units in stock`,
        });
      }

      const newStock = previousStock - normalizedQuantity;
      const newSiteBalance = currentSiteBalance - normalizedQuantity;
      tenantStockState.set(item.productId, newStock);
      siteBalanceState.set(item.productId, newSiteBalance);

      applyInventoryBalanceDelta(tx, {
        tenantId: ctx.tenantId,
        siteId: existing.siteId,
        productId: item.productId,
        delta: -normalizedQuantity,
        initialOnHandIfMissing: currentSiteBalance,
        now,
      });

      tx.insert(inventoryMovements)
        .values({
          id: nanoid(),
          tenantId: ctx.tenantId,
          productId: item.productId,
          type: 'return',
          quantity: -normalizedQuantity,
          previousStock,
          newStock,
          reference: input.id,
          notes: `Voided purchase ${existing.purchaseNumber}`,
          createdBy: ctx.user!.id,
          syncStatus: 'pending',
          syncVersion: 1,
          createdAt: now,
        })
        .run();
    }

    tx.update(purchases)
      .set({
        status: 'voided',
        notes: buildVoidedPurchaseNotes(existing.notes, input.reason),
        updatedAt: now,
        syncStatus: 'pending',
        syncVersion: nextSyncVersion,
      })
      .where(eq(purchases.id, input.id))
      .run();

    // ENG-007 — voiding a purchase reverses destination stock at the
    // receiving site and pushes the purchase row into `voided`. Audit row
    // is written inside the same transaction as the reversal so either
    // both land or neither does.
    writeAuditLog({
      tx,
      tenantId: ctx.tenantId,
      actorId: ctx.user!.id,
      action: 'purchase.void',
      resourceType: 'purchase',
      resourceId: input.id,
      before: {
        status: existing.status,
        total: existing.total,
        purchaseNumber: existing.purchaseNumber,
      },
      after: { status: 'voided' },
      metadata: {
        ...(input.reason ? { reason: input.reason } : {}),
        siteId: existing.siteId,
      },
    });
  });

  await enqueueSync(ctx, {
    entityType: 'purchases',
    entityId: input.id,
    operation: 'update',
    data: { id: input.id, status: 'voided', reason: input.reason },
  });

  return getPurchaseRecord(ctx.db, ctx.tenantId, input.id);
}
