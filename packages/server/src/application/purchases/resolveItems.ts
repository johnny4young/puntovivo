/**
 * Purchase item resolvers (new purchase, return, order receipt).
 *
 * extracted verbatim from the former monolithic
 * `trpc/routers/purchases.ts` during the megafile decomposition.
 *
 * @module application/purchases/resolveItems
 */
import { roundQuantity } from '@puntovivo/shared/unit-math';
import { TRPCError } from '@trpc/server';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { nanoid } from 'nanoid';

import type { DatabaseInstance } from '../../db/index.js';
import {
  orderItems,
  orders,
  products,
  purchaseItemLots,
  purchaseItems,
  purchaseReturnItemLots,
  purchaseReturnItems,
  purchaseReturns,
  purchases,
  unitXProduct,
  units,
} from '../../db/schema.js';
import { roundMoney } from '../../lib/money.js';
import { QUANTITY_EPSILON } from '../../lib/quantity.js';
import { throwServerError } from '../../lib/errorCodes.js';
import type { CreatePurchaseInput } from '../../trpc/schemas/purchases.js';
import { getProductStockTotals } from '../../services/inventory-balances.js';
import { assertLotTrackingMatchesProvenance } from '../../services/inventory-lots/index.js';
import { normalizeSerialReceiptNumbers } from '../../services/product-serials.js';
import {
  assertAggregateStockMutationAllowed,
  assertCatalogStockMutationAllowed,
  assertServiceStockMutationAllowed,
} from '../../services/products/lot-tracking.js';
import { getNormalizedPurchaseQuantity } from './helpers.js';
import type {
  ResolvedOrderReceiptItem,
  ResolvedPurchaseItem,
  ResolvedPurchaseReturnItem,
} from './types.js';

function resolveLotReceipts(input: {
  tracksLots: boolean;
  normalizedQuantity: number;
  lotReceipts?:
    | Array<{
        lotNumber: string;
        expiresAt?: string | null | undefined;
        baseQuantity: number;
        notes?: string | null | undefined;
      }>
    | undefined;
}) {
  const receipts = input.lotReceipts ?? [];
  if (!input.tracksLots) {
    if (receipts.length > 0) {
      throwServerError({
        trpcCode: 'BAD_REQUEST',
        errorCode: 'PRODUCT_LOT_TRACKING_REQUIRED',
        message: 'Lot receipts can only be supplied for lot-tracked products',
      });
    }
    return [];
  }
  if (receipts.length === 0) {
    throwServerError({
      trpcCode: 'BAD_REQUEST',
      errorCode: 'LOT_ALLOCATION_REQUIRED',
      message: 'Every lot-tracked purchase line requires exact received batches',
    });
  }

  const normalized = receipts.map(receipt => ({
    lotNumber: receipt.lotNumber.trim(),
    expiresAt: receipt.expiresAt ?? null,
    baseQuantity: receipt.baseQuantity,
    notes: receipt.notes?.trim() || null,
  }));
  const lotNumbers = normalized.map(receipt => receipt.lotNumber);
  if (new Set(lotNumbers).size !== lotNumbers.length) {
    throwServerError({
      trpcCode: 'BAD_REQUEST',
      errorCode: 'LOT_ALLOCATION_DUPLICATE',
      message: 'The same lot number can only appear once on a purchase line',
    });
  }
  const allocated = normalized.reduce(
    (sum, receipt) => roundQuantity(sum + receipt.baseQuantity, 12),
    0
  );
  if (Math.abs(allocated - input.normalizedQuantity) > QUANTITY_EPSILON) {
    throwServerError({
      trpcCode: 'BAD_REQUEST',
      errorCode: 'LOT_ALLOCATION_QUANTITY_MISMATCH',
      message: 'Lot receipt quantities must equal the purchase line base quantity',
      details: { allocated, required: input.normalizedQuantity },
    });
  }
  return normalized;
}

export function resolvePurchaseItems(
  db: DatabaseInstance,
  tenantId: string,
  inputItems: CreatePurchaseInput['items']
) {
  const productIds = [...new Set(inputItems.map(item => item.productId))];
  const productRows = db
    .select()
    .from(products)
    .where(and(eq(products.tenantId, tenantId), inArray(products.id, productIds)))
    .all();
  const productMap = new Map(productRows.map(product => [product.id, product]));

  const unitAssignments = db
    .select({
      productId: unitXProduct.productId,
      unitId: unitXProduct.unitId,
      equivalence: unitXProduct.equivalence,
      isActive: units.isActive,
    })
    .from(unitXProduct)
    .innerJoin(units, and(eq(unitXProduct.unitId, units.id), eq(units.tenantId, tenantId)))
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

    // Reject service items before any purchase header, line or stock row is
    // written. The balance-layer guard remains defense in depth for legacy
    // data and any future inventory writer.
    assertServiceStockMutationAllowed({ tracksStock: product.tracksStock, delta: 1 });

    const assignment = assignmentMap.get(`${item.productId}:${item.unitId}`);
    if (!assignment || assignment.isActive === false) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: `Unit selection is invalid for product "${product.name}"`,
      });
    }

    const normalizedQuantity = getNormalizedPurchaseQuantity(item.quantity, assignment.equivalence);
    const serialNumbers = normalizeSerialReceiptNumbers({
      tracksSerials: product.tracksSerials,
      normalizedQuantity,
      serialNumbers: item.serialNumbers,
    });
    const lotReceipts = resolveLotReceipts({
      tracksLots: product.tracksLots,
      normalizedQuantity,
      lotReceipts: item.lotReceipts,
    });
    if (product.tracksSerials) {
      assertCatalogStockMutationAllowed({
        catalogType: product.catalogType,
        delta: normalizedQuantity,
      });
    } else if (product.tracksLots) {
      assertCatalogStockMutationAllowed({
        catalogType: product.catalogType,
        delta: normalizedQuantity,
      });
    } else {
      assertAggregateStockMutationAllowed({
        tracksLots: product.tracksLots,
        tracksSerials: false,
        catalogType: product.catalogType,
        delta: normalizedQuantity,
      });
    }
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
      tracksLots: product.tracksLots,
      tracksSerials: product.tracksSerials,
      serialNumbers,
      lotReceipts,
    });
  }

  return {
    productStocks,
    rows,
    subtotal,
  };
}

export function resolvePurchaseReturnItems(
  db: DatabaseInstance,
  tenantId: string,
  purchaseId: string,
  inputItems: Array<{
    purchaseItemId: string;
    quantity: number;
    serialIds?: string[] | undefined;
    lotAllocations?: Array<{ purchaseItemLotId: string; baseQuantity: number }> | undefined;
  }>
) {
  const purchaseItemIds = [...new Set(inputItems.map(item => item.purchaseItemId))];

  if (purchaseItemIds.length !== inputItems.length) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: 'Duplicate purchase lines cannot be returned in the same request',
    });
  }

  const purchaseLineItems = db
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
    .innerJoin(
      products,
      and(eq(purchaseItems.productId, products.id), eq(products.tenantId, tenantId))
    )
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
  const returnedQuantities = db
    .select({
      purchaseItemId: purchaseReturnItems.purchaseItemId,
      returnedQuantity: sql<number>`coalesce(sum(${purchaseReturnItems.quantity}), 0)`,
    })
    .from(purchaseReturnItems)
    .innerJoin(purchaseReturns, eq(purchaseReturnItems.purchaseReturnId, purchaseReturns.id))
    .where(and(eq(purchaseReturns.tenantId, tenantId), eq(purchaseReturns.purchaseId, purchaseId)))
    .groupBy(purchaseReturnItems.purchaseItemId)
    .all();

  const returnedQuantityMap = new Map(
    returnedQuantities.map(item => [
      item.purchaseItemId,
      roundQuantity(item.returnedQuantity ?? 0, 12),
    ])
  );

  const purchaseLotRows = db
    .select({
      id: purchaseItemLots.id,
      purchaseItemId: purchaseItemLots.purchaseItemId,
      inventoryLotId: purchaseItemLots.inventoryLotId,
      lotNumberSnapshot: purchaseItemLots.lotNumberSnapshot,
      expiresAtSnapshot: purchaseItemLots.expiresAtSnapshot,
      baseQuantity: purchaseItemLots.baseQuantity,
      unitCost: purchaseItemLots.unitCost,
    })
    .from(purchaseItemLots)
    .where(
      and(
        eq(purchaseItemLots.tenantId, tenantId),
        inArray(purchaseItemLots.purchaseItemId, purchaseItemIds)
      )
    )
    .all();
  const purchaseLotById = new Map(purchaseLotRows.map(row => [row.id, row]));
  const purchaseLotItemIds = new Set(purchaseLotRows.map(row => row.purchaseItemId));
  const returnedLotRows = purchaseLotRows.length
    ? db
        .select({
          purchaseItemLotId: purchaseReturnItemLots.purchaseItemLotId,
          returnedBaseQuantity: sql<number>`coalesce(sum(${purchaseReturnItemLots.baseQuantity}), 0)`,
        })
        .from(purchaseReturnItemLots)
        .where(
          and(
            eq(purchaseReturnItemLots.tenantId, tenantId),
            inArray(
              purchaseReturnItemLots.purchaseItemLotId,
              purchaseLotRows.map(row => row.id)
            )
          )
        )
        .groupBy(purchaseReturnItemLots.purchaseItemLotId)
        .all()
    : [];
  const returnedBaseQuantityByPurchaseLot = new Map(
    returnedLotRows.map(row => [row.purchaseItemLotId, row.returnedBaseQuantity ?? 0])
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
    const remainingQuantity = roundQuantity(purchaseItem.quantity - alreadyReturnedQuantity, 12);

    if (remainingQuantity <= QUANTITY_EPSILON) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: `Purchase line "${purchaseItem.productName}" has already been fully returned`,
      });
    }

    if (inputItem.quantity - remainingQuantity > QUANTITY_EPSILON) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: `Cannot return ${inputItem.quantity} units for "${purchaseItem.productName}" because only ${remainingQuantity} remain available to return`,
      });
    }

    const normalizedQuantity = getNormalizedPurchaseQuantity(
      inputItem.quantity,
      purchaseItem.unitEquivalence
    );
    assertLotTrackingMatchesProvenance({
      tracksLots: purchaseItem.tracksLots,
      hasLotProvenance: purchaseLotItemIds.has(purchaseItem.id),
      referenceId: purchaseItem.id,
    });
    const serialIds = inputItem.serialIds ?? [];
    const inputLotAllocations = inputItem.lotAllocations ?? [];
    let lotAllocations: ResolvedPurchaseReturnItem['lotAllocations'] = [];
    if (purchaseItem.tracksSerials) {
      assertCatalogStockMutationAllowed({
        catalogType: purchaseItem.catalogType,
        delta: -normalizedQuantity,
      });
      if (
        !Number.isInteger(normalizedQuantity) ||
        serialIds.length !== normalizedQuantity ||
        new Set(serialIds).size !== serialIds.length
      ) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Select exactly one unique serial number per returned serialized unit',
        });
      }
      if (inputLotAllocations.length > 0) {
        throwServerError({
          trpcCode: 'BAD_REQUEST',
          errorCode: 'PRODUCT_LOT_TRACKING_REQUIRED',
          message: 'Serialized purchase returns cannot include lot allocations',
        });
      }
    } else if (purchaseItem.tracksLots) {
      if (serialIds.length > 0) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Serial identities cannot be returned for lot-tracked products',
        });
      }
      if (inputLotAllocations.length === 0) {
        throwServerError({
          trpcCode: 'BAD_REQUEST',
          errorCode: 'LOT_ALLOCATION_REQUIRED',
          message: 'Select the exact purchase lots being returned to the provider',
        });
      }
      const allocationIds = inputLotAllocations.map(allocation => allocation.purchaseItemLotId);
      if (new Set(allocationIds).size !== allocationIds.length) {
        throwServerError({
          trpcCode: 'BAD_REQUEST',
          errorCode: 'LOT_ALLOCATION_DUPLICATE',
          message: 'A purchase lot can only appear once in one return line',
        });
      }
      let allocatedBaseQuantity = 0;
      lotAllocations = inputLotAllocations.map(allocation => {
        const purchaseLot = purchaseLotById.get(allocation.purchaseItemLotId);
        if (!purchaseLot || purchaseLot.purchaseItemId !== purchaseItem.id) {
          throwServerError({
            trpcCode: 'NOT_FOUND',
            errorCode: 'LOT_NOT_FOUND',
            message: 'The selected lot does not belong to this purchase line',
            details: { purchaseItemLotId: allocation.purchaseItemLotId },
          });
        }
        const alreadyReturned = returnedBaseQuantityByPurchaseLot.get(purchaseLot.id) ?? 0;
        const remainingBaseQuantity = purchaseLot.baseQuantity - alreadyReturned;
        if (allocation.baseQuantity - remainingBaseQuantity > QUANTITY_EPSILON) {
          throwServerError({
            trpcCode: 'CONFLICT',
            errorCode: 'LOT_ALLOCATION_PROVENANCE_EXCEEDED',
            message: 'The selected lot return exceeds the quantity received by this purchase',
            details: {
              purchaseItemLotId: purchaseLot.id,
              remainingBaseQuantity,
              requestedBaseQuantity: allocation.baseQuantity,
            },
          });
        }
        allocatedBaseQuantity = roundQuantity(allocatedBaseQuantity + allocation.baseQuantity, 12);
        return {
          purchaseItemLotId: purchaseLot.id,
          inventoryLotId: purchaseLot.inventoryLotId,
          lotNumberSnapshot: purchaseLot.lotNumberSnapshot,
          expiresAtSnapshot: purchaseLot.expiresAtSnapshot,
          baseQuantity: allocation.baseQuantity,
          unitCost: purchaseLot.unitCost,
        };
      });
      if (Math.abs(allocatedBaseQuantity - normalizedQuantity) > QUANTITY_EPSILON) {
        throwServerError({
          trpcCode: 'BAD_REQUEST',
          errorCode: 'LOT_ALLOCATION_QUANTITY_MISMATCH',
          message: 'Returned lot quantities must equal the purchase return line quantity',
          details: { allocated: allocatedBaseQuantity, required: normalizedQuantity },
        });
      }
      assertCatalogStockMutationAllowed({
        catalogType: purchaseItem.catalogType,
        delta: -normalizedQuantity,
      });
    } else {
      if (serialIds.length > 0) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Serial identities can only be returned for serialized products',
        });
      }
      if (inputLotAllocations.length > 0) {
        throwServerError({
          trpcCode: 'BAD_REQUEST',
          errorCode: 'PRODUCT_LOT_TRACKING_REQUIRED',
          message: 'Lot allocations can only be returned for lot-tracked products',
        });
      }
      assertAggregateStockMutationAllowed({
        tracksLots: purchaseItem.tracksLots,
        tracksSerials: false,
        catalogType: purchaseItem.catalogType,
        delta: -normalizedQuantity,
      });
    }
    const costPerUnit = roundMoney(purchaseItem.costPerUnit);
    const baseUnitCost = roundMoney(purchaseItem.baseUnitCost);
    const total = roundMoney(inputItem.quantity * costPerUnit);
    const nextReturnedQuantity = roundQuantity(alreadyReturnedQuantity + inputItem.quantity, 12);

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
      tracksLots: purchaseItem.tracksLots,
      tracksSerials: purchaseItem.tracksSerials,
      serialIds,
      lotAllocations,
    });
    returnAmount = roundMoney(returnAmount + total);
    returnedQuantityMap.set(inputItem.purchaseItemId, nextReturnedQuantity);
  }

  const totalFullyReturnedItems = purchaseLineItems.reduce((count, item) => {
    const nextReturnedQuantity = returnedQuantityMap.get(item.id) ?? 0;
    return Math.abs(nextReturnedQuantity - item.quantity) <= QUANTITY_EPSILON ? count + 1 : count;
  }, 0);

  return {
    rows,
    returnAmount,
    totalItemCount: purchaseLineItems.length,
    totalFullyReturnedItems,
  };
}

export function resolveOrderReceiptItems(
  db: DatabaseInstance,
  tenantId: string,
  orderId: string,
  inputItems?: Array<{
    orderItemId: string;
    quantity: number;
    serialNumbers?: string[] | undefined;
    lotReceipts?:
      | Array<{
          lotNumber: string;
          expiresAt?: string | null | undefined;
          baseQuantity: number;
          notes?: string | null | undefined;
        }>
      | undefined;
  }>
) {
  const orderLineItems = db
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
    .innerJoin(
      products,
      and(eq(orderItems.productId, products.id), eq(products.tenantId, tenantId))
    )
    .innerJoin(orders, and(eq(orderItems.orderId, orders.id), eq(orders.tenantId, tenantId)))
    .where(and(eq(orderItems.orderId, orderId), eq(orders.id, orderId)))
    .all();

  if (orderLineItems.length === 0) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: 'Order cannot be received because it has no line items',
    });
  }

  const receivedQuantities = db
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
      .map(item => [
        item.sourceOrderItemId as string,
        roundQuantity(item.receivedQuantity ?? 0, 12),
      ])
  );

  const normalizedInputItems: Array<{
    orderItemId: string;
    quantity: number;
    serialNumbers?: string[] | undefined;
    lotReceipts?:
      | Array<{
          lotNumber: string;
          expiresAt?: string | null | undefined;
          baseQuantity: number;
          notes?: string | null | undefined;
        }>
      | undefined;
  }> =
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
    const remainingQuantity = roundQuantity(orderLine.quantity - alreadyReceivedQuantity, 12);

    if (remainingQuantity <= QUANTITY_EPSILON) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: `Order line "${orderLine.productName}" is already fully received`,
      });
    }

    if (inputItem.quantity - remainingQuantity > QUANTITY_EPSILON) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: `Cannot receive ${inputItem.quantity} units for "${orderLine.productName}" because only ${remainingQuantity} remain pending`,
      });
    }

    const normalizedQuantity = getNormalizedPurchaseQuantity(
      inputItem.quantity,
      orderLine.unitEquivalence
    );
    const serialNumbers = normalizeSerialReceiptNumbers({
      tracksSerials: orderLine.tracksSerials,
      normalizedQuantity,
      serialNumbers: inputItem.serialNumbers,
    });
    const lotReceipts = resolveLotReceipts({
      tracksLots: orderLine.tracksLots,
      normalizedQuantity,
      lotReceipts: inputItem.lotReceipts,
    });
    if (orderLine.tracksSerials) {
      assertCatalogStockMutationAllowed({
        catalogType: orderLine.catalogType,
        delta: normalizedQuantity,
      });
    } else if (orderLine.tracksLots) {
      assertCatalogStockMutationAllowed({
        catalogType: orderLine.catalogType,
        delta: normalizedQuantity,
      });
    } else {
      assertAggregateStockMutationAllowed({
        tracksLots: orderLine.tracksLots,
        tracksSerials: false,
        catalogType: orderLine.catalogType,
        delta: normalizedQuantity,
      });
    }
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
      tracksLots: orderLine.tracksLots,
      tracksSerials: orderLine.tracksSerials,
      serialNumbers,
      lotReceipts,
    });

    receivedQuantityMap.set(
      orderLine.id,
      roundQuantity(alreadyReceivedQuantity + inputItem.quantity, 12)
    );
  }

  const totalFullyReceivedItems = orderLineItems.reduce((count, item) => {
    const receivedQuantity = receivedQuantityMap.get(item.id) ?? 0;
    return receivedQuantity + QUANTITY_EPSILON >= item.quantity ? count + 1 : count;
  }, 0);

  return {
    rows,
    subtotal,
    productStockState,
    totalItemCount: orderLineItems.length,
    totalFullyReceivedItems,
  };
}
