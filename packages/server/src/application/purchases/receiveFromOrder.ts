/**
 * Receive a purchase against an existing order (full or partial receipt).
 *
 * ENG-178 — extracted from the former monolithic `trpc/routers/purchases.ts`
 * during the megafile decomposition. The order lookup + status guards + the
 * receive transaction (stock-in per line + order status transition) relocate
 * verbatim; the tRPC procedure adapts its context and calls this use-case.
 *
 * @module application/purchases/receiveFromOrder
 */
import { TRPCError } from '@trpc/server';
import { and, eq, sql } from 'drizzle-orm';
import { nanoid } from 'nanoid';

import {
  inventoryMovements,
  orders,
  products,
  providers,
  purchaseItems,
  purchases,
  sequentials,
  sites,
} from '../../db/schema.js';
import { enqueueSync } from '../../services/sync/enqueue.js';
import {
  applyInventoryBalanceDelta,
  ensurePrimaryInventoryBalanceSnapshot,
} from '../../services/inventory-balances.js';
import type { CreatePurchaseFromOrderInput } from '../../trpc/schemas/purchases.js';
import { getInventoryBalanceStateForSite, getPurchaseSequentialContext } from './helpers.js';
import { getPurchaseRecord } from './purchase-read.js';
import { resolveOrderReceiptItems } from './resolveItems.js';
import type { PurchaseContext } from './types.js';

export async function createPurchaseFromOrder(
  ctx: PurchaseContext,
  input: CreatePurchaseFromOrderInput
) {
  const orderRecord = await ctx.db
    .select({
      id: orders.id,
      providerId: orders.providerId,
      providerName: providers.name,
      siteId: orders.siteId,
      siteName: sites.name,
      orderNumber: orders.orderNumber,
      notes: orders.notes,
      status: orders.status,
      syncVersion: orders.syncVersion,
    })
    .from(orders)
    .innerJoin(providers, eq(orders.providerId, providers.id))
    .innerJoin(sites, eq(orders.siteId, sites.id))
    .where(and(eq(orders.id, input.orderId), eq(orders.tenantId, ctx.tenantId)))
    .get();

  if (!orderRecord) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'Order not found' });
  }

  if (orderRecord.status === 'voided') {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: 'Voided orders cannot be received',
    });
  }

  if (orderRecord.status === 'received') {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: 'Order has already been fully received',
    });
  }

  const now = new Date().toISOString();
  const purchaseId = nanoid();
  const sequentialContext = await getPurchaseSequentialContext(
    ctx.db,
    ctx.tenantId,
    orderRecord.siteId
  );
  const resolvedItems = await resolveOrderReceiptItems(
    ctx.db,
    ctx.tenantId,
    input.orderId,
    input.items
  );
  const subtotal = resolvedItems.subtotal;
  const total = subtotal;
  const nextSequentialValue = sequentialContext.currentValue + 1;
  const purchaseNumber = `${sequentialContext.prefix}${String(nextSequentialValue).padStart(6, '0')}`;
  const productStockState = new Map(resolvedItems.productStockState);
  const productIds = [...new Set(resolvedItems.rows.map(row => row.productId))];
  const siteBalanceState = await getInventoryBalanceStateForSite(
    ctx.db,
    ctx.tenantId,
    orderRecord.siteId,
    productIds
  );
  const nextOrderSyncVersion = (orderRecord.syncVersion ?? 0) + 1;
  const nextOrderStatus =
    resolvedItems.totalFullyReceivedItems === resolvedItems.totalItemCount
      ? 'received'
      : 'partial_received';

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
        providerId: orderRecord.providerId,
        orderId: input.orderId,
        siteId: orderRecord.siteId,
        status: 'completed',
        subtotal,
        total,
        notes: `${orderRecord.notes ? `${orderRecord.notes} | ` : ''}${input.notes ? `${input.notes} | ` : ''}Received from order ${orderRecord.orderNumber}`,
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
          sourceOrderItemId: row.sourceOrderItemId,
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
        siteId: orderRecord.siteId,
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
          notes: `Purchase ${purchaseNumber} · received from order ${orderRecord.orderNumber}`,
          createdBy: ctx.user!.id,
          syncStatus: 'pending',
          syncVersion: 1,
          createdAt: now,
        })
        .run();
    }

    tx.update(orders)
      .set({
        status: nextOrderStatus,
        updatedAt: now,
        syncStatus: 'pending',
        syncVersion: nextOrderSyncVersion,
      })
      .where(eq(orders.id, input.orderId))
      .run();
  });

  await enqueueSync(ctx, {
    entityType: 'purchases',
    entityId: purchaseId,
    operation: 'create',
    data: {
      id: purchaseId,
      purchaseNumber,
      providerId: orderRecord.providerId,
      orderId: input.orderId,
      total,
      siteId: orderRecord.siteId,
    },
  });

  await enqueueSync(ctx, {
    entityType: 'orders',
    entityId: input.orderId,
    operation: 'update',
    data: {
      id: input.orderId,
      status: nextOrderStatus,
      receivedPurchaseId: purchaseId,
    },
  });

  return getPurchaseRecord(ctx.db, ctx.tenantId, purchaseId);
}
