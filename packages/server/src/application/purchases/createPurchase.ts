/**
 * Create a completed purchase (immediate stock-in).
 *
 * ENG-178 — extracted from the former monolithic `trpc/routers/purchases.ts`
 * during the megafile decomposition. The transaction body (sequential
 * advance, purchase + line inserts, per-item stock / balance / movement
 * writes) is relocated verbatim; the tRPC procedure now adapts its context
 * and calls this use-case.
 *
 * @module application/purchases/createPurchase
 */
import { eq, sql } from 'drizzle-orm';
import { nanoid } from 'nanoid';

import {
  inventoryMovements,
  products,
  purchaseItems,
  purchases,
  sequentials,
} from '../../db/schema.js';
import { enqueueSync } from '../../services/sync/enqueue.js';
import {
  applyInventoryBalanceDelta,
  ensurePrimaryInventoryBalanceSnapshot,
} from '../../services/inventory-balances.js';
import type { CreatePurchaseInput } from '../../trpc/schemas/purchases.js';
import {
  getInventoryBalanceStateForSite,
  getPurchaseSequentialContext,
  getPurchaseSiteContext,
  validateProvider,
} from './helpers.js';
import { getPurchaseRecord } from './purchase-read.js';
import { resolvePurchaseItems } from './resolveItems.js';
import type { PurchaseContext } from './types.js';

export async function createPurchase(ctx: PurchaseContext, input: CreatePurchaseInput) {
  await validateProvider(ctx.db, ctx.tenantId, input.providerId);

  const now = new Date().toISOString();
  const purchaseId = nanoid();
  const sequentialContext = await getPurchaseSequentialContext(ctx.db, ctx.tenantId, ctx.siteId);
  const purchaseSite = await getPurchaseSiteContext(
    ctx.db,
    ctx.tenantId,
    ctx.siteId,
    sequentialContext.siteId
  );
  const resolvedItems = await resolvePurchaseItems(ctx.db, ctx.tenantId, input.items);
  const subtotal = resolvedItems.subtotal;
  const total = subtotal;
  const nextSequentialValue = sequentialContext.currentValue + 1;
  const purchaseNumber = `${sequentialContext.prefix}${String(nextSequentialValue).padStart(6, '0')}`;
  const productStockState = new Map(resolvedItems.productStocks);
  const productIds = [...new Set(resolvedItems.rows.map(row => row.productId))];
  const siteBalanceState = await getInventoryBalanceStateForSite(
    ctx.db,
    ctx.tenantId,
    purchaseSite.id,
    productIds
  );

  ctx.db.transaction(tx => {
    tx.update(sequentials)
      .set({
        currentValue: nextSequentialValue,
        updatedAt: now,
      })
      .where(eq(sequentials.id, sequentialContext.id))
      .run();

    tx.insert(purchases)
      .values({
        id: purchaseId,
        tenantId: ctx.tenantId,
        purchaseNumber,
        providerId: input.providerId,
        orderId: null,
        siteId: purchaseSite.id,
        status: 'completed',
        subtotal,
        total,
        notes: input.notes,
        createdBy: ctx.user!.id,
        syncStatus: 'pending',
        syncVersion: 1,
        createdAt: now,
        updatedAt: now,
      })
      .run();

    for (const row of resolvedItems.rows) {
      tx.insert(purchaseItems)
        .values({
          id: row.id,
          purchaseId,
          productId: row.productId,
          quantity: row.quantity,
          unitId: row.unitId,
          unitEquivalence: row.unitEquivalence,
          costPerUnit: row.costPerUnit,
          baseUnitCost: row.baseUnitCost,
          total: row.total,
        })
        .run();

      const previousStock = productStockState.get(row.productId) ?? 0;
      const newStock = previousStock + row.normalizedQuantity;
      const previousSiteBalance = siteBalanceState.get(row.productId) ?? 0;
      const newSiteBalance = previousSiteBalance + row.normalizedQuantity;
      productStockState.set(row.productId, newStock);
      siteBalanceState.set(row.productId, newSiteBalance);

      ensurePrimaryInventoryBalanceSnapshot(tx, {
        tenantId: ctx.tenantId,
        productId: row.productId,
        onHandSnapshot: previousStock,
        now,
      });

      tx.update(products)
        .set({
          stock: newStock,
          cost: row.baseUnitCost,
          initialCost: row.baseUnitCost,
          syncStatus: 'pending',
          syncVersion: sql`${products.syncVersion} + 1`,
          updatedAt: now,
        })
        .where(eq(products.id, row.productId))
        .run();

      applyInventoryBalanceDelta(tx, {
        tenantId: ctx.tenantId,
        siteId: purchaseSite.id,
        productId: row.productId,
        delta: row.normalizedQuantity,
        initialOnHandIfMissing: previousSiteBalance,
        now,
      });

      tx.insert(inventoryMovements)
        .values({
          id: nanoid(),
          tenantId: ctx.tenantId,
          productId: row.productId,
          type: 'purchase',
          quantity: row.normalizedQuantity,
          previousStock,
          newStock,
          reference: purchaseId,
          notes: `Purchase ${purchaseNumber} · ${purchaseSite.name}`,
          createdBy: ctx.user!.id,
          syncStatus: 'pending',
          syncVersion: 1,
          createdAt: now,
        })
        .run();
    }

  });

  await enqueueSync(ctx, {
    entityType: 'purchases',
    entityId: purchaseId,
    operation: 'create',
    data: {
      id: purchaseId,
      purchaseNumber,
      providerId: input.providerId,
      total,
      siteId: purchaseSite.id,
    },
  });

  return getPurchaseRecord(ctx.db, ctx.tenantId, purchaseId);
}
