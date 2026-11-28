import { and, eq, inArray, sql } from 'drizzle-orm';
import { roundQuantity } from '@puntovivo/shared/unit-math';

import type { DatabaseInstance } from '../../db/index.js';
import { purchaseItems, purchaseReturnItems, purchaseReturns } from '../../db/schema.js';
import { roundMoney } from '../../lib/money.js';

export interface NetKeptProductSummary {
  netQuantity: number;
  netTotal: number;
  returnedQuantity: number;
  returnedTotal: number;
}

/**
 * What the store kept of the given purchases once supplier returns are netted:
 * the figure an invoice must reconcile to, and the one the picker must show.
 */
export function computeNetKeptGoods(
  tx: DatabaseInstance,
  tenantId: string,
  linkedPurchaseIds: string[]
): {
  byProduct: Map<string, NetKeptProductSummary>;
  totalByPurchase: Map<string, number>;
  total: number;
  hasItems: boolean;
} {
  const receivedItems = tx
    .select({
      id: purchaseItems.id,
      purchaseId: purchaseItems.purchaseId,
      productId: purchaseItems.productId,
      quantity: purchaseItems.quantity,
      unitEquivalence: purchaseItems.unitEquivalence,
      total: purchaseItems.total,
    })
    .from(purchaseItems)
    .where(inArray(purchaseItems.purchaseId, linkedPurchaseIds))
    .all();

  const returnedItems = tx
    .select({
      purchaseItemId: purchaseReturnItems.purchaseItemId,
      baseQuantity: sql<number>`sum(${purchaseReturnItems.quantity} * ${purchaseReturnItems.unitEquivalence})`,
      lineTotal: sql<number>`sum(${purchaseReturnItems.total})`,
    })
    .from(purchaseReturnItems)
    .innerJoin(purchaseReturns, eq(purchaseReturnItems.purchaseReturnId, purchaseReturns.id))
    .where(
      and(
        eq(purchaseReturns.tenantId, tenantId),
        inArray(purchaseReturns.purchaseId, linkedPurchaseIds)
      )
    )
    .groupBy(purchaseReturnItems.purchaseItemId)
    .all();
  const returnedByItem = new Map(returnedItems.map(row => [row.purchaseItemId, row]));

  const byProduct = new Map<string, NetKeptProductSummary>();
  const totalByPurchase = new Map<string, number>();
  let total = 0;

  for (const item of receivedItems) {
    const ret = returnedByItem.get(item.id);
    const receivedQty = roundQuantity(Number(item.quantity) * Number(item.unitEquivalence), 12);
    const returnedQty = ret ? roundQuantity(Number(ret.baseQuantity), 12) : 0;
    const netQty = roundQuantity(Math.max(0, receivedQty - returnedQty), 12);
    const receivedTotal = roundMoney(Number(item.total));
    // Clamp fully returned lines to zero value so per-return cent rounding
    // residuals cannot become negative or bleed across consolidated purchases.
    const fullyReturned = netQty <= 1e-9;
    const returnedTotal = fullyReturned
      ? receivedTotal
      : ret
        ? roundMoney(Number(ret.lineTotal))
        : 0;
    const netTotal = fullyReturned ? 0 : roundMoney(Math.max(0, receivedTotal - returnedTotal));

    const current = byProduct.get(item.productId) ?? {
      netQuantity: 0,
      netTotal: 0,
      returnedQuantity: 0,
      returnedTotal: 0,
    };
    byProduct.set(item.productId, {
      netQuantity: roundQuantity(current.netQuantity + netQty, 12),
      netTotal: roundMoney(current.netTotal + netTotal),
      returnedQuantity: roundQuantity(current.returnedQuantity + returnedQty, 12),
      returnedTotal: roundMoney(current.returnedTotal + returnedTotal),
    });
    totalByPurchase.set(
      item.purchaseId,
      roundMoney((totalByPurchase.get(item.purchaseId) ?? 0) + netTotal)
    );
    total = roundMoney(total + netTotal);
  }

  return { byProduct, totalByPurchase, total, hasItems: receivedItems.length > 0 };
}
