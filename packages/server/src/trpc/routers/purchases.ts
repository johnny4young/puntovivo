import { TRPCError } from '@trpc/server';
import { and, asc, desc, eq, gte, inArray, lte, sql } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { router } from '../init.js';
import { adminProcedure, managerOrAdminProcedure } from '../middleware/roles.js';
import {
  inventoryBalances,
  inventoryMovements,
  orderItems,
  orders,
  products,
  providers,
  purchaseItems,
  purchaseReturnItems,
  purchaseReturns,
  purchases,
  sequentials,
  sites,
  syncQueue,
  unitXProduct,
  units,
  users,
} from '../../db/schema.js';
import type { Context } from '../context.js';
import {
  applyInventoryBalanceDelta,
  ensureInventoryBalancesForSite,
  ensurePrimaryInventoryBalanceSnapshot,
} from '../../services/inventory-balances.js';
import {
  createPurchaseInput,
  createPurchaseFromOrderInput,
  getPurchaseInput,
  listPurchasesInput,
  returnPurchaseInput,
  voidPurchaseInput,
} from '../schemas/purchases.js';
import type { CreatePurchaseInput } from '../schemas/purchases.js';

type ResolvedPurchaseItem = {
  id: string;
  productId: string;
  quantity: number;
  unitId: string;
  unitEquivalence: number;
  costPerUnit: number;
  baseUnitCost: number;
  total: number;
  normalizedQuantity: number;
};

type ResolvedPurchaseReturnItem = {
  id: string;
  purchaseItemId: string;
  productId: string;
  quantity: number;
  unitId: string;
  unitEquivalence: number;
  costPerUnit: number;
  baseUnitCost: number;
  total: number;
  normalizedQuantity: number;
};

type PurchaseSequentialContext = {
  id: string;
  prefix: string;
  currentValue: number;
  siteId: string;
  siteName: string;
};

type PurchaseSiteContext = {
  id: string;
  name: string;
};

type ResolvedOrderReceiptItem = ResolvedPurchaseItem & {
  sourceOrderItemId: string;
};

function buildVoidedPurchaseNotes(existingNotes: string | null, reason: string | undefined) {
  if (!reason) {
    return `${existingNotes ? `${existingNotes} | ` : ''}Voided`;
  }

  return `${existingNotes ? `${existingNotes} | ` : ''}Voided: ${reason}`;
}

function buildReturnedPurchaseNotes(existingNotes: string | null, reason: string | undefined) {
  if (!reason) {
    return existingNotes;
  }

  return `${existingNotes ? `${existingNotes} | ` : ''}Returned: ${reason}`;
}

function getNormalizedPurchaseQuantity(quantity: number, equivalence: number) {
  const normalizedQuantity = quantity * equivalence;

  if (!Number.isFinite(normalizedQuantity) || normalizedQuantity <= 0) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: 'The selected quantity must resolve to a positive stock quantity',
    });
  }

  return normalizedQuantity;
}

async function getPurchaseSiteContext(
  db: Context['db'],
  tenantId: string,
  preferredSiteId: string | null,
  fallbackSiteId: string
): Promise<PurchaseSiteContext> {
  const resolvedSiteId = preferredSiteId ?? fallbackSiteId;
  const site = await db
    .select({
      id: sites.id,
      name: sites.name,
      isActive: sites.isActive,
    })
    .from(sites)
    .where(and(eq(sites.tenantId, tenantId), eq(sites.id, resolvedSiteId)))
    .get();

  if (!site || site.isActive === false) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: 'Selected purchase site was not found or is inactive',
    });
  }

  return {
    id: site.id,
    name: site.name,
  };
}

async function getInventoryBalanceStateForSite(
  db: Context['db'],
  tenantId: string,
  siteId: string,
  productIds: string[]
) {
  if (productIds.length === 0) {
    return new Map<string, number>();
  }

  ensureInventoryBalancesForSite(db, tenantId, siteId);

  const balances = await db
    .select({
      productId: inventoryBalances.productId,
      onHand: inventoryBalances.onHand,
    })
    .from(inventoryBalances)
    .where(
      and(
        eq(inventoryBalances.tenantId, tenantId),
        eq(inventoryBalances.siteId, siteId),
        inArray(inventoryBalances.productId, productIds)
      )
    )
    .all();

  return new Map(balances.map(balance => [balance.productId, balance.onHand]));
}

async function getPurchaseSequentialContext(
  db: Context['db'],
  tenantId: string,
  siteId: string | null
): Promise<PurchaseSequentialContext> {
  const baseConditions = [
    eq(sequentials.tenantId, tenantId),
    eq(sequentials.documentType, 'purchase'),
    eq(sites.isActive, true),
  ];

  if (siteId) {
    const siteScopedSequential = await db
      .select({
        id: sequentials.id,
        prefix: sequentials.prefix,
        currentValue: sequentials.currentValue,
        siteId: sequentials.siteId,
        siteName: sites.name,
      })
      .from(sequentials)
      .innerJoin(sites, eq(sequentials.siteId, sites.id))
      .where(and(...baseConditions, eq(sequentials.siteId, siteId)))
      .get();

    if (siteScopedSequential) {
      return siteScopedSequential;
    }
  }

  const fallbackSequential = await db
    .select({
      id: sequentials.id,
      prefix: sequentials.prefix,
      currentValue: sequentials.currentValue,
      siteId: sequentials.siteId,
      siteName: sites.name,
    })
    .from(sequentials)
    .innerJoin(sites, eq(sequentials.siteId, sites.id))
    .where(and(...baseConditions))
    .orderBy(asc(sites.name))
    .get();

  if (!fallbackSequential) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: 'No active purchase sequential is configured for the current tenant',
    });
  }

  return fallbackSequential;
}

async function validateProvider(db: Context['db'], tenantId: string, providerId: string) {
  const provider = await db
    .select({ id: providers.id, isActive: providers.isActive })
    .from(providers)
    .where(and(eq(providers.id, providerId), eq(providers.tenantId, tenantId)))
    .get();

  if (!provider || provider.isActive === false) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: 'Selected provider was not found or is inactive',
    });
  }
}

async function resolvePurchaseItems(
  db: Context['db'],
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
  const productStocks = new Map(productRows.map(product => [product.id, product.stock]));

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
    const baseUnitCost = item.costPerUnit / assignment.equivalence;
    const total = item.costPerUnit * item.quantity;

    subtotal += total;
    rows.push({
      id: nanoid(),
      productId: item.productId,
      quantity: item.quantity,
      unitId: item.unitId,
      unitEquivalence: assignment.equivalence,
      costPerUnit: item.costPerUnit,
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

async function resolvePurchaseReturnItems(
  db: Context['db'],
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
    const total = inputItem.quantity * purchaseItem.costPerUnit;
    const nextReturnedQuantity = alreadyReturnedQuantity + inputItem.quantity;

    rows.push({
      id: nanoid(),
      purchaseItemId: inputItem.purchaseItemId,
      productId: purchaseItem.productId,
      quantity: inputItem.quantity,
      unitId: purchaseItem.unitId,
      unitEquivalence: purchaseItem.unitEquivalence,
      costPerUnit: purchaseItem.costPerUnit,
      baseUnitCost: purchaseItem.baseUnitCost,
      total,
      normalizedQuantity,
    });
    returnAmount += total;
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

async function resolveOrderReceiptItems(
  db: Context['db'],
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
  const productRows = await db
    .select({ id: products.id, stock: products.stock, isActive: products.isActive })
    .from(products)
    .where(and(eq(products.tenantId, tenantId), inArray(products.id, productIds)))
    .all();
  const productStockState = new Map(productRows.map(product => [product.id, product.stock]));

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
    const total = inputItem.quantity * orderLine.costPerUnit;
    subtotal += total;

    rows.push({
      id: nanoid(),
      sourceOrderItemId: orderLine.id,
      productId: orderLine.productId,
      quantity: inputItem.quantity,
      unitId: orderLine.unitId,
      unitEquivalence: orderLine.unitEquivalence,
      costPerUnit: orderLine.costPerUnit,
      baseUnitCost: orderLine.baseUnitCost,
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

async function getPurchaseRecord(db: Context['db'], tenantId: string, purchaseId: string) {
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

  const returnedAmount = returns.reduce((sum, returnRecord) => sum + returnRecord.returnAmount, 0);
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

export const purchasesRouter = router({
  list: managerOrAdminProcedure.input(listPurchasesInput).query(async ({ ctx, input }) => {
    const { page, perPage, providerId, status, fromDate, toDate } = input;
    const offset = (page - 1) * perPage;
    const conditions = [eq(purchases.tenantId, ctx.tenantId)];

    if (providerId) conditions.push(eq(purchases.providerId, providerId));
    if (status) conditions.push(eq(purchases.status, status));
    if (fromDate) conditions.push(gte(purchases.createdAt, fromDate));
    if (toDate) conditions.push(lte(purchases.createdAt, toDate));

    const where = and(...conditions);

    const [items, countResult] = await Promise.all([
      ctx.db
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
        .where(where)
        .orderBy(desc(purchases.createdAt))
        .limit(perPage)
        .offset(offset)
        .all(),
      ctx.db
        .select({ count: sql<number>`count(*)` })
        .from(purchases)
        .where(where)
        .get(),
    ]);

    const purchaseIds = items.map(item => item.id);
    const returnRows = purchaseIds.length
      ? await ctx.db
          .select({
            purchaseId: purchaseReturns.purchaseId,
            returnAmount: purchaseReturns.returnAmount,
            reason: purchaseReturns.reason,
            createdByName: users.name,
            createdAt: purchaseReturns.createdAt,
          })
          .from(purchaseReturns)
          .leftJoin(users, eq(purchaseReturns.createdBy, users.id))
          .where(inArray(purchaseReturns.purchaseId, purchaseIds))
          .orderBy(desc(purchaseReturns.createdAt))
          .all()
      : [];

    const returnSummaryByPurchaseId = new Map<
      string,
      {
        returnedAmount: number;
        returnedAt: string | null;
        latestReturnReason: string | null;
        latestReturnCreatedByName: string | null;
        returnCount: number;
      }
    >();

    for (const returnRow of returnRows) {
      const currentSummary = returnSummaryByPurchaseId.get(returnRow.purchaseId);
      if (currentSummary) {
        currentSummary.returnedAmount += returnRow.returnAmount;
        currentSummary.returnCount += 1;
        continue;
      }

      returnSummaryByPurchaseId.set(returnRow.purchaseId, {
        returnedAmount: returnRow.returnAmount,
        returnedAt: returnRow.createdAt,
        latestReturnReason: returnRow.reason ?? null,
        latestReturnCreatedByName: returnRow.createdByName ?? null,
        returnCount: 1,
      });
    }

    const totalItems = countResult?.count ?? 0;

    return {
      items: items.map(item => ({
        ...item,
        returnedAmount: returnSummaryByPurchaseId.get(item.id)?.returnedAmount ?? 0,
        returnedAt: returnSummaryByPurchaseId.get(item.id)?.returnedAt ?? null,
        latestReturnReason: returnSummaryByPurchaseId.get(item.id)?.latestReturnReason ?? null,
        latestReturnCreatedByName:
          returnSummaryByPurchaseId.get(item.id)?.latestReturnCreatedByName ?? null,
        returnCount: returnSummaryByPurchaseId.get(item.id)?.returnCount ?? 0,
      })),
      page,
      perPage,
      totalItems,
      totalPages: Math.ceil(totalItems / perPage),
    };
  }),

  getById: managerOrAdminProcedure.input(getPurchaseInput).query(async ({ ctx, input }) => {
    return getPurchaseRecord(ctx.db, ctx.tenantId, input.id);
  }),

  create: managerOrAdminProcedure.input(createPurchaseInput).mutation(async ({ ctx, input }) => {
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

      tx.insert(syncQueue)
        .values({
          id: nanoid(),
          tenantId: ctx.tenantId,
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
          localVersion: 1,
          attempts: 0,
          createdAt: now,
        })
        .run();
    });

    return getPurchaseRecord(ctx.db, ctx.tenantId, purchaseId);
  }),

  createFromOrder: managerOrAdminProcedure
    .input(createPurchaseFromOrderInput)
    .mutation(async ({ ctx, input }) => {
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

        tx.insert(syncQueue)
          .values({
            id: nanoid(),
            tenantId: ctx.tenantId,
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
            localVersion: 1,
            attempts: 0,
            createdAt: now,
          })
          .run();

        tx.insert(syncQueue)
          .values({
            id: nanoid(),
            tenantId: ctx.tenantId,
            entityType: 'orders',
            entityId: input.orderId,
            operation: 'update',
            data: {
              id: input.orderId,
              status: nextOrderStatus,
              receivedPurchaseId: purchaseId,
            },
            localVersion: nextOrderSyncVersion,
            attempts: 0,
            createdAt: now,
          })
          .run();
      });

      return getPurchaseRecord(ctx.db, ctx.tenantId, purchaseId);
    }),

  returnPurchase: managerOrAdminProcedure
    .input(returnPurchaseInput)
    .mutation(async ({ ctx, input }) => {
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
          stock: products.stock,
        })
        .from(products)
        .where(and(eq(products.tenantId, ctx.tenantId), inArray(products.id, productIds)))
        .all();

      const productStockState = new Map(currentProducts.map(product => [product.id, product]));
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
          const product = productStockState.get(item.productId);

          if (!product) {
            throw new TRPCError({
              code: 'NOT_FOUND',
              message: `Product ${item.productId} was not found while returning the purchase`,
            });
          }

          if (product.stock < item.normalizedQuantity) {
            throw new TRPCError({
              code: 'BAD_REQUEST',
              message: `Cannot return purchase items because product "${product.name}" only has ${product.stock} units in stock`,
            });
          }

          const currentSiteBalance = siteBalanceState.get(item.productId) ?? 0;
          if (currentSiteBalance < item.normalizedQuantity) {
            throw new TRPCError({
              code: 'BAD_REQUEST',
              message: `Cannot return purchase items because the purchase site only has ${currentSiteBalance} units available`,
            });
          }

          const previousStock = product.stock;
          const newStock = previousStock - item.normalizedQuantity;
          const newSiteBalance = currentSiteBalance - item.normalizedQuantity;
          productStockState.set(item.productId, {
            ...product,
            stock: newStock,
          });
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

          tx.update(products)
            .set({
              stock: newStock,
              syncStatus: 'pending',
              syncVersion: sql`${products.syncVersion} + 1`,
              updatedAt: now,
            })
            .where(eq(products.id, item.productId))
            .run();

          applyInventoryBalanceDelta(tx, {
            tenantId: ctx.tenantId,
            siteId: existing.siteId,
            productId: item.productId,
            delta: -item.normalizedQuantity,
            initialOnHandIfMissing: currentSiteBalance,
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

          tx.insert(syncQueue)
            .values({
              id: nanoid(),
              tenantId: ctx.tenantId,
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
              localVersion: 1,
              attempts: 0,
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

        tx.insert(syncQueue)
          .values([
            {
              id: nanoid(),
              tenantId: ctx.tenantId,
              entityType: 'purchase_returns',
              entityId: purchaseReturnId,
              operation: 'create',
              data: {
                id: purchaseReturnId,
                purchaseId: input.id,
                returnAmount: resolvedReturn.returnAmount,
                reason: input.reason ?? null,
              },
              localVersion: 1,
              attempts: 0,
              createdAt: now,
            },
            {
              id: nanoid(),
              tenantId: ctx.tenantId,
              entityType: 'purchases',
              entityId: input.id,
              operation: 'update',
              data: {
                id: input.id,
                status: nextStatus,
                reason: input.reason ?? null,
                returnId: purchaseReturnId,
              },
              localVersion: nextSyncVersion,
              attempts: 0,
              createdAt: now,
            },
          ])
          .run();
      });

      return getPurchaseRecord(ctx.db, ctx.tenantId, input.id);
    }),

  void: adminProcedure.input(voidPurchaseInput).mutation(async ({ ctx, input }) => {
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
        stock: products.stock,
      })
      .from(products)
      .where(and(eq(products.tenantId, ctx.tenantId), inArray(products.id, productIds)))
      .all();

    const productStockState = new Map(currentProducts.map(product => [product.id, product]));
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
        const product = productStockState.get(item.productId);

        if (!product) {
          throw new TRPCError({
            code: 'NOT_FOUND',
            message: `Product ${item.productId} was not found while voiding the purchase`,
          });
        }

        if (product.stock < normalizedQuantity) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: `Cannot void purchase because product "${product.name}" only has ${product.stock} units in stock`,
          });
        }

        const currentSiteBalance = siteBalanceState.get(item.productId) ?? 0;
        if (currentSiteBalance < normalizedQuantity) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: `Cannot void purchase because the purchase site only has ${currentSiteBalance} units in stock`,
          });
        }

        const previousStock = product.stock;
        const newStock = previousStock - normalizedQuantity;
        const newSiteBalance = currentSiteBalance - normalizedQuantity;
        productStockState.set(item.productId, {
          ...product,
          stock: newStock,
        });
        siteBalanceState.set(item.productId, newSiteBalance);

        tx.update(products)
          .set({
            stock: newStock,
            syncStatus: 'pending',
            syncVersion: sql`${products.syncVersion} + 1`,
            updatedAt: now,
          })
          .where(eq(products.id, item.productId))
          .run();

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

      tx.insert(syncQueue)
        .values({
          id: nanoid(),
          tenantId: ctx.tenantId,
          entityType: 'purchases',
          entityId: input.id,
          operation: 'update',
          data: { id: input.id, status: 'voided', reason: input.reason },
          localVersion: nextSyncVersion,
          attempts: 0,
          createdAt: now,
        })
        .run();
    });

    return getPurchaseRecord(ctx.db, ctx.tenantId, input.id);
  }),
});
