/**
 * Void a completed purchase, reversing destination-site stock.
 *
 * extracted from the former monolithic `trpc/routers/purchases.ts`
 * during the megafile decomposition. The status guards + the void
 * transaction (per-item stock reversal + the in-transaction `writeAuditLog`,
 * ) relocate verbatim; the tRPC procedure adapts its context and
 * calls this use-case.
 *
 * @module application/purchases/voidPurchase
 */
import { TRPCError } from '@trpc/server';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { nanoid } from 'nanoid';

import { inventoryMovements, products, purchaseItems, purchases } from '../../db/schema.js';
import { enqueueSync } from '../../services/sync/enqueue.js';
import {
  applyInventoryBalanceDelta,
  getProductStockTotals,
} from '../../services/inventory-balances.js';
import { assertAggregateStockMutationAllowed } from '../../services/products/lot-tracking.js';
import { returnPurchasedProductSerials } from '../../services/product-serials.js';
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

  const now = new Date().toISOString();

  ctx.db.transaction(
    tx => {
      // Serialize the status and stock snapshot with every competing return,
      // sale or second void. Preflight above remains useful for fast errors;
      // this transaction-local read is authoritative.
      const current = tx
        .select()
        .from(purchases)
        .where(and(eq(purchases.id, input.id), eq(purchases.tenantId, ctx.tenantId)))
        .get();
      if (!current) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Purchase not found' });
      }
      if (current.status === 'voided') {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Purchase is already voided' });
      }
      if (current.status !== 'completed') {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Only completed purchases can be voided',
        });
      }

      const purchaseLineItems = tx
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
      const currentProducts = tx
        .select({
          id: products.id,
          name: products.name,
          tracksLots: products.tracksLots,
          tracksSerials: products.tracksSerials,
          catalogType: products.catalogType,
        })
        .from(products)
        .where(and(eq(products.tenantId, ctx.tenantId), inArray(products.id, productIds)))
        .all();
      const productById = new Map(currentProducts.map(product => [product.id, product]));
      const tenantStockState = getProductStockTotals(tx, ctx.tenantId, productIds);
      const siteBalanceState = getInventoryBalanceStateForSite(
        tx,
        ctx.tenantId,
        current.siteId,
        productIds
      );

      for (const item of purchaseLineItems) {
        const normalizedQuantity = getNormalizedPurchaseQuantity(
          item.quantity,
          item.unitEquivalence
        );
        const product = productById.get(item.productId);

        if (!product) {
          throw new TRPCError({
            code: 'NOT_FOUND',
            message: `Product ${item.productId} was not found while voiding the purchase`,
          });
        }

        if (!product.tracksSerials) {
          assertAggregateStockMutationAllowed({
            tracksLots: product.tracksLots,
            tracksSerials: false,
            catalogType: product.catalogType,
            delta: -normalizedQuantity,
          });
        }

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

        if (product.tracksSerials) {
          returnPurchasedProductSerials(tx as unknown as typeof ctx.db, {
            tenantId: ctx.tenantId,
            siteId: current.siteId,
            purchaseItemId: item.id,
            productId: item.productId,
            quantity: normalizedQuantity,
            now,
            syncContext: { ...ctx, db: tx as unknown as typeof ctx.db },
          });
        }

        applyInventoryBalanceDelta(tx, {
          tenantId: ctx.tenantId,
          siteId: current.siteId,
          productId: item.productId,
          delta: -normalizedQuantity,
          initialOnHandIfMissing: currentSiteBalance,
          serialAware: product.tracksSerials,
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
            notes: `Voided purchase ${current.purchaseNumber}`,
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
          status: 'voided',
          notes: buildVoidedPurchaseNotes(current.notes, input.reason),
          updatedAt: now,
          syncStatus: 'pending',
          syncVersion: (current.syncVersion ?? 0) + 1,
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
          message: 'The purchase changed while it was being voided',
        });
      }

      // voiding a purchase reverses destination stock at the
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
          status: current.status,
          total: current.total,
          purchaseNumber: current.purchaseNumber,
        },
        after: { status: 'voided' },
        metadata: {
          ...(input.reason ? { reason: input.reason } : {}),
          siteId: current.siteId,
        },
      });
    },
    { behavior: 'immediate' }
  );

  await enqueueSync(ctx, {
    entityType: 'purchases',
    entityId: input.id,
    operation: 'update',
    data: { id: input.id, status: 'voided', reason: input.reason },
  });

  return getPurchaseRecord(ctx.db, ctx.tenantId, input.id);
}
