/**
 * Purchase item resolvers (new purchase, return, order receipt).
 *
 * ENG-178 — extracted verbatim from the former monolithic
 * `trpc/routers/purchases.ts` during the megafile decomposition.
 *
 * @module application/purchases/resolveItems
 */
import { TRPCError } from '@trpc/server';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { nanoid } from 'nanoid';

import type { DatabaseInstance } from '../../db/index.js';
import {
  orderItems,
  products,
  purchaseItems,
  purchaseReturnItems,
  purchaseReturns,
  purchases,
  unitXProduct,
  units,
} from '../../db/schema.js';
import { roundMoney } from '../../lib/money.js';
import type { CreatePurchaseInput } from '../../trpc/schemas/purchases.js';
import { getProductStockTotals } from '../../services/inventory-balances.js';
import { assertAggregateStockMutationAllowed } from '../../services/products/lot-tracking.js';
import { getNormalizedPurchaseQuantity } from './helpers.js';
import type {
  ResolvedOrderReceiptItem,
  ResolvedPurchaseItem,
  ResolvedPurchaseReturnItem,
} from './types.js';

export async function resolvePurchaseItems(
  db: DatabaseInstance,
  tenantId: string,
  inputItems: CreatePurchaseInput['items']
) {
  const productIds = [...new Set(inputItems.map(item => item.productId))];
  const productRows = await db
    .select()
    .from(products)
    .where(and(eq(products.tenantId, tenantId), inArray(products.id, productIds)))
    .all();
  const productMap = new Map(productRows.map(product => [product.id, product]));

  const unitAssignments = await db
    .select({
      productId: unitXProduct.productId,
      unitId: unitXProduct.unitId,
      equivalence: unitXProduct.equivalence,
      isActive: units.isActive,
    })
    .from(unitXProduct)
    .innerJoin(units, eq(unitXProduct.unitId, units.id))
    .where(inArray(unitXProduct.productId, productIds))
    .all();
  const assignmentMap = new Map(
    unitAssignments.map(assignment => [`${assignment.productId}:${assignment.unitId}`, assignment])
  );

  let subtotal = 0;
  const rows: ResolvedPurchaseItem[] = [];
  // Tenant-wide stock is derived from Σ(inventory_balances.on_hand).
  const productStocks = getProductStockTotals(db, tenantId, productIds);

  for (const item of inputItems) {
    const product = productMap.get(item.productId);

    if (!product || product.isActive === false) {
      throw new TRPCError({
        code: 'NOT_FOUND',
        message: `Product ${item.productId} was not found or is inactive`,
      });
    }

    const assignment = assignmentMap.get(`${item.productId}:${item.unitId}`);
    if (!assignment || assignment.isActive === false) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: `Unit selection is invalid for product "${product.name}"`,
      });
    }

    const normalizedQuantity = getNormalizedPurchaseQuantity(item.quantity, assignment.equivalence);
    assertAggregateStockMutationAllowed({
      tracksLots: product.tracksLots,
      tracksSerials: product.tracksSerials,
      catalogType: product.catalogType,
      delta: normalizedQuantity,
    });
    const costPerUnit = roundMoney(item.costPerUnit);
    const baseUnitCost = roundMoney(costPerUnit / assignment.equivalence);
    const total = roundMoney(costPerUnit * item.quantity);

    subtotal = roundMoney(subtotal + total);
    rows.push({
      id: nanoid(),
      productId: item.productId,
      quantity: item.quantity,
      unitId: item.unitId,
      unitEquivalence: assignment.equivalence,
      costPerUnit,
      baseUnitCost,
      total,
      normalizedQuantity,
    });
  }

  return {
    productStocks,
    rows,
    subtotal,
  };
}

export async function resolvePurchaseReturnItems(
  db: DatabaseInstance,
  tenantId: string,
  purchaseId: string,
  inputItems: Array<{ purchaseItemId: string; quantity: number }>
) {
  const purchaseItemIds = [...new Set(inputItems.map(item => item.purchaseItemId))];

  if (purchaseItemIds.length !== inputItems.length) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: 'Duplicate purchase lines cannot be returned in the same request',
    });
  }

  const purchaseLineItems = await db
    .select({
      id: purchaseItems.id,
      purchaseId: purchaseItems.purchaseId,
      productId: purchaseItems.productId,
      productName: products.name,
      tracksLots: products.tracksLots,
      tracksSerials: products.tracksSerials,
      catalogType: products.catalogType,
      quantity: purchaseItems.quantity,
      unitId: purchaseItems.unitId,
      unitEquivalence: purchaseItems.unitEquivalence,
      costPerUnit: purchaseItems.costPerUnit,
      baseUnitCost: purchaseItems.baseUnitCost,
      total: purchaseItems.total,
    })
    .from(purchaseItems)
    .innerJoin(products, eq(purchaseItems.productId, products.id))
    .innerJoin(purchases, eq(purchaseItems.purchaseId, purchases.id))
    .where(and(eq(purchases.tenantId, tenantId), eq(purchaseItems.purchaseId, purchaseId)))
    .all();

  if (purchaseLineItems.length === 0) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: 'Cannot return a purchase without line items',
    });
  }

  const purchaseItemMap = new Map(purchaseLineItems.map(item => [item.id, item]));
  const returnedQuantities = await db
    .select({
      purchaseItemId: purchaseReturnItems.purchaseItemId,
      returnedQuantity: sql<number>`coalesce(sum(${purchaseReturnItems.quantity}), 0)`,
    })
    .from(purchaseReturnItems)
    .innerJoin(purchaseReturns, eq(purchaseReturnItems.purchaseReturnId, purchaseReturns.id))
    .where(eq(purchaseReturns.purchaseId, purchaseId))
    .groupBy(purchaseReturnItems.purchaseItemId)
    .all();

  const returnedQuantityMap = new Map(
    returnedQuantities.map(item => [item.purchaseItemId, item.returnedQuantity ?? 0])
  );

  const rows: ResolvedPurchaseReturnItem[] = [];
  let returnAmount = 0;

  for (const inputItem of inputItems) {
    const purchaseItem = purchaseItemMap.get(inputItem.purchaseItemId);

    if (!purchaseItem) {
      throw new TRPCError({
        code: 'NOT_FOUND',
        message: `Purchase line ${inputItem.purchaseItemId} was not found`,
      });
    }

    const alreadyReturnedQuantity = returnedQuantityMap.get(inputItem.purchaseItemId) ?? 0;
    const remainingQuantity = purchaseItem.quantity - alreadyReturnedQuantity;

    if (remainingQuantity <= 0) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: `Purchase line "${purchaseItem.productName}" has already been fully returned`,
      });
    }

    if (inputItem.quantity > remainingQuantity) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: `Cannot return ${inputItem.quantity} units for "${purchaseItem.productName}" because only ${remainingQuantity} remain available to return`,
      });
    }

    const normalizedQuantity = getNormalizedPurchaseQuantity(
      inputItem.quantity,
      purchaseItem.unitEquivalence
    );
    assertAggregateStockMutationAllowed({
      tracksLots: purchaseItem.tracksLots,
      tracksSerials: purchaseItem.tracksSerials,
      catalogType: purchaseItem.catalogType,
      delta: -normalizedQuantity,
    });
    const costPerUnit = roundMoney(purchaseItem.costPerUnit);
    const baseUnitCost = roundMoney(purchaseItem.baseUnitCost);
    const total = roundMoney(inputItem.quantity * costPerUnit);
    const nextReturnedQuantity = alreadyReturnedQuantity + inputItem.quantity;

    rows.push({
      id: nanoid(),
      purchaseItemId: inputItem.purchaseItemId,
      productId: purchaseItem.productId,
      quantity: inputItem.quantity,
      unitId: purchaseItem.unitId,
      unitEquivalence: purchaseItem.unitEquivalence,
      costPerUnit,
      baseUnitCost,
      total,
      normalizedQuantity,
    });
    returnAmount = roundMoney(returnAmount + total);
    returnedQuantityMap.set(inputItem.purchaseItemId, nextReturnedQuantity);
  }

  const totalFullyReturnedItems = purchaseLineItems.reduce((count, item) => {
    const nextReturnedQuantity = returnedQuantityMap.get(item.id) ?? 0;
    return nextReturnedQuantity === item.quantity ? count + 1 : count;
  }, 0);

  return {
    rows,
    returnAmount,
    totalItemCount: purchaseLineItems.length,
    totalFullyReturnedItems,
  };
}

export async function resolveOrderReceiptItems(
  db: DatabaseInstance,
  tenantId: string,
  orderId: string,
  inputItems?: Array<{ orderItemId: string; quantity: number }>
) {
  const orderLineItems = await db
    .select({
      id: orderItems.id,
      orderId: orderItems.orderId,
      productId: orderItems.productId,
      productName: products.name,
      tracksLots: products.tracksLots,
      tracksSerials: products.tracksSerials,
      catalogType: products.catalogType,
      quantity: orderItems.quantity,
      unitId: orderItems.unitId,
      unitEquivalence: orderItems.unitEquivalence,
      costPerUnit: orderItems.costPerUnit,
      baseUnitCost: orderItems.baseUnitCost,
      total: orderItems.total,
    })
    .from(orderItems)
    .innerJoin(products, eq(orderItems.productId, products.id))
    .where(eq(orderItems.orderId, orderId))
    .all();

  if (orderLineItems.length === 0) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: 'Order cannot be received because it has no line items',
    });
  }

  const receivedQuantities = await db
    .select({
      sourceOrderItemId: purchaseItems.sourceOrderItemId,
      receivedQuantity: sql<number>`coalesce(sum(${purchaseItems.quantity}), 0)`,
    })
    .from(purchaseItems)
    .innerJoin(purchases, eq(purchaseItems.purchaseId, purchases.id))
    .where(
      and(
        eq(purchases.tenantId, tenantId),
        eq(purchases.orderId, orderId),
        inArray(purchases.status, ['completed', 'partial_returned', 'returned'])
      )
    )
    .groupBy(purchaseItems.sourceOrderItemId)
    .all();

  const orderLineMap = new Map(orderLineItems.map(item => [item.id, item]));
  const receivedQuantityMap = new Map(
    receivedQuantities
      .filter(item => item.sourceOrderItemId)
      .map(item => [item.sourceOrderItemId as string, item.receivedQuantity ?? 0])
  );

  const normalizedInputItems =
    inputItems && inputItems.length > 0
      ? inputItems
      : orderLineItems
          .map(item => ({
            orderItemId: item.id,
            quantity: item.quantity - (receivedQuantityMap.get(item.id) ?? 0),
          }))
          .filter(item => item.quantity > 0);

  if (normalizedInputItems.length === 0) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: 'Order has no remaining quantities available to receive',
    });
  }

  const uniqueOrderItemIds = new Set<string>();
  const rows: ResolvedOrderReceiptItem[] = [];
  const productIds = [...new Set(orderLineItems.map(item => item.productId))];
  // Tenant-wide stock is derived from Σ(inventory_balances.on_hand).
  const productStockState = getProductStockTotals(db, tenantId, productIds);

  let subtotal = 0;

  for (const inputItem of normalizedInputItems) {
    if (uniqueOrderItemIds.has(inputItem.orderItemId)) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: 'Duplicate order lines cannot be received in the same request',
      });
    }

    uniqueOrderItemIds.add(inputItem.orderItemId);

    const orderLine = orderLineMap.get(inputItem.orderItemId);
    if (!orderLine) {
      throw new TRPCError({
        code: 'NOT_FOUND',
        message: `Order line ${inputItem.orderItemId} was not found`,
      });
    }

    const alreadyReceivedQuantity = receivedQuantityMap.get(orderLine.id) ?? 0;
    const remainingQuantity = orderLine.quantity - alreadyReceivedQuantity;

    if (remainingQuantity <= 0) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: `Order line "${orderLine.productName}" is already fully received`,
      });
    }

    if (inputItem.quantity > remainingQuantity) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: `Cannot receive ${inputItem.quantity} units for "${orderLine.productName}" because only ${remainingQuantity} remain pending`,
      });
    }

    const normalizedQuantity = getNormalizedPurchaseQuantity(
      inputItem.quantity,
      orderLine.unitEquivalence
    );
    assertAggregateStockMutationAllowed({
      tracksLots: orderLine.tracksLots,
      tracksSerials: orderLine.tracksSerials,
      catalogType: orderLine.catalogType,
      delta: normalizedQuantity,
    });
    const costPerUnit = roundMoney(orderLine.costPerUnit);
    const baseUnitCost = roundMoney(orderLine.baseUnitCost);
    const total = roundMoney(inputItem.quantity * costPerUnit);
    subtotal = roundMoney(subtotal + total);

    rows.push({
      id: nanoid(),
      sourceOrderItemId: orderLine.id,
      productId: orderLine.productId,
      quantity: inputItem.quantity,
      unitId: orderLine.unitId,
      unitEquivalence: orderLine.unitEquivalence,
      costPerUnit,
      baseUnitCost,
      total,
      normalizedQuantity,
    });

    receivedQuantityMap.set(orderLine.id, alreadyReceivedQuantity + inputItem.quantity);
  }

  const totalFullyReceivedItems = orderLineItems.reduce((count, item) => {
    const receivedQuantity = receivedQuantityMap.get(item.id) ?? 0;
    return receivedQuantity >= item.quantity ? count + 1 : count;
  }, 0);

  return {
    rows,
    subtotal,
    productStockState,
    totalItemCount: orderLineItems.length,
    totalFullyReceivedItems,
  };
}
