/**
 * Purchase read model — single-purchase record with items + returns.
 *
 * ENG-178 — extracted verbatim from the former monolithic
 * `trpc/routers/purchases.ts` during the megafile decomposition (mirrors
 * `application/sales/sale-read.ts`). Used by the router's `getById` and by
 * every mutation use-case to return the canonical record.
 *
 * @module application/purchases/purchase-read
 */
import { TRPCError } from '@trpc/server';
import { and, desc, eq } from 'drizzle-orm';

import type { DatabaseInstance } from '../../db/index.js';
import {
  orders,
  products,
  providers,
  purchaseItems,
  purchaseReturnItems,
  purchaseReturns,
  purchases,
  sites,
  units,
  users,
} from '../../db/schema.js';
import { roundMoney } from '../../lib/money.js';

export async function getPurchaseRecord(db: DatabaseInstance, tenantId: string, purchaseId: string) {
  const purchase = await db
    .select({
      id: purchases.id,
      tenantId: purchases.tenantId,
      purchaseNumber: purchases.purchaseNumber,
      providerId: purchases.providerId,
      providerName: providers.name,
      orderId: purchases.orderId,
      sourceOrderNumber: orders.orderNumber,
      siteId: purchases.siteId,
      siteName: sites.name,
      status: purchases.status,
      subtotal: purchases.subtotal,
      total: purchases.total,
      notes: purchases.notes,
      createdBy: purchases.createdBy,
      syncStatus: purchases.syncStatus,
      syncVersion: purchases.syncVersion,
      createdAt: purchases.createdAt,
      updatedAt: purchases.updatedAt,
    })
    .from(purchases)
    .innerJoin(providers, eq(purchases.providerId, providers.id))
    .leftJoin(orders, eq(purchases.orderId, orders.id))
    .innerJoin(sites, eq(purchases.siteId, sites.id))
    .where(and(eq(purchases.id, purchaseId), eq(purchases.tenantId, tenantId)))
    .get();

  if (!purchase) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'Purchase not found' });
  }

  const items = await db
    .select({
      id: purchaseItems.id,
      purchaseId: purchaseItems.purchaseId,
      productId: purchaseItems.productId,
      sourceOrderItemId: purchaseItems.sourceOrderItemId,
      productName: products.name,
      productSku: products.sku,
      quantity: purchaseItems.quantity,
      unitId: purchaseItems.unitId,
      unitEquivalence: purchaseItems.unitEquivalence,
      unitName: units.name,
      unitAbbreviation: units.abbreviation,
      costPerUnit: purchaseItems.costPerUnit,
      baseUnitCost: purchaseItems.baseUnitCost,
      total: purchaseItems.total,
    })
    .from(purchaseItems)
    .innerJoin(products, eq(purchaseItems.productId, products.id))
    .innerJoin(units, eq(purchaseItems.unitId, units.id))
    .where(eq(purchaseItems.purchaseId, purchaseId))
    .all();

  const returns = await db
    .select({
      id: purchaseReturns.id,
      purchaseId: purchaseReturns.purchaseId,
      returnAmount: purchaseReturns.returnAmount,
      reason: purchaseReturns.reason,
      createdBy: purchaseReturns.createdBy,
      createdByName: users.name,
      createdAt: purchaseReturns.createdAt,
      updatedAt: purchaseReturns.updatedAt,
    })
    .from(purchaseReturns)
    .leftJoin(users, eq(purchaseReturns.createdBy, users.id))
    .where(eq(purchaseReturns.purchaseId, purchaseId))
    .orderBy(desc(purchaseReturns.createdAt))
    .all();

  const returnItems = await db
    .select({
      id: purchaseReturnItems.id,
      purchaseReturnId: purchaseReturnItems.purchaseReturnId,
      purchaseItemId: purchaseReturnItems.purchaseItemId,
      productId: purchaseReturnItems.productId,
      productName: products.name,
      productSku: products.sku,
      quantity: purchaseReturnItems.quantity,
      unitId: purchaseReturnItems.unitId,
      unitEquivalence: purchaseReturnItems.unitEquivalence,
      unitName: units.name,
      unitAbbreviation: units.abbreviation,
      costPerUnit: purchaseReturnItems.costPerUnit,
      baseUnitCost: purchaseReturnItems.baseUnitCost,
      total: purchaseReturnItems.total,
    })
    .from(purchaseReturnItems)
    .innerJoin(purchaseReturns, eq(purchaseReturnItems.purchaseReturnId, purchaseReturns.id))
    .innerJoin(products, eq(purchaseReturnItems.productId, products.id))
    .innerJoin(units, eq(purchaseReturnItems.unitId, units.id))
    .where(eq(purchaseReturns.purchaseId, purchaseId))
    .all();

  const returnedQuantityByItem = new Map<string, number>();
  for (const item of returnItems) {
    returnedQuantityByItem.set(
      item.purchaseItemId,
      (returnedQuantityByItem.get(item.purchaseItemId) ?? 0) + item.quantity
    );
  }

  const returnsWithItems = returns.map(returnRecord => ({
    ...returnRecord,
    items: returnItems.filter(item => item.purchaseReturnId === returnRecord.id),
  }));

  const returnedAmount = returns.reduce(
    (sum, returnRecord) => roundMoney(sum + returnRecord.returnAmount),
    0
  );
  const returnedAt = returns[0]?.createdAt ?? null;
  const latestReturnReason = returns[0]?.reason ?? null;
  const latestReturnCreatedByName = returns[0]?.createdByName ?? null;

  return {
    ...purchase,
    returnedAmount,
    returnedAt,
    latestReturnReason,
    latestReturnCreatedByName,
    returnCount: returns.length,
    returns: returnsWithItems,
    items: items.map(item => {
      const returnedQuantity = returnedQuantityByItem.get(item.id) ?? 0;
      return {
        ...item,
        returnedQuantity,
        remainingQuantity: item.quantity - returnedQuantity,
      };
    }),
  };
}
