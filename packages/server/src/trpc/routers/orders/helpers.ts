/**
 * Orders router shared helpers (ENG-178 split).
 *
 * Leaf module: order-item resolution, provider validation, the order-sequential
 * context, the voided-notes builder, and the order-record reader. Imported by
 * queries.ts + mutations.ts.
 *
 * @module trpc/routers/orders/helpers
 */
import { TRPCError } from '@trpc/server';
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { orderItems, orders, purchaseItems, purchases, products, providers, sequentials, sites, unitXProduct, units } from '../../../db/schema.js';
import type { Context } from '../../context.js';
import { type CreateOrderInput } from '../../schemas/orders.js';
import { roundMoney } from '../../../lib/money.js';

export type ResolvedOrderItem = {
  id: string;
  productId: string;
  quantity: number;
  unitId: string;
  unitEquivalence: number;
  costPerUnit: number;
  baseUnitCost: number;
  total: number;
};

export type OrderSequentialContext = {
  id: string;
  prefix: string;
  currentValue: number;
  siteId: string;
  siteName: string;
};

export function buildVoidedOrderNotes(existingNotes: string | null, reason: string | undefined) {
  if (!reason) {
    return `${existingNotes ? `${existingNotes} | ` : ''}Voided`;
  }

  return `${existingNotes ? `${existingNotes} | ` : ''}Voided: ${reason}`;
}

export async function getOrderSequentialContext(
  db: Context['db'],
  tenantId: string,
  siteId: string | null
): Promise<OrderSequentialContext> {
  const baseConditions = [
    eq(sequentials.tenantId, tenantId),
    eq(sequentials.documentType, 'order'),
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
      message: 'No active order sequential is configured for the current tenant',
    });
  }

  return fallbackSequential;
}

export async function validateProvider(db: Context['db'], tenantId: string, providerId: string) {
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

export async function resolveOrderItems(
  db: Context['db'],
  tenantId: string,
  inputItems: CreateOrderInput['items']
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
  const rows: ResolvedOrderItem[] = [];

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
    });
  }

  return {
    rows,
    subtotal,
  };
}

export async function getOrderRecord(db: Context['db'], tenantId: string, orderId: string) {
  const order = await db
    .select({
      id: orders.id,
      tenantId: orders.tenantId,
      orderNumber: orders.orderNumber,
      providerId: orders.providerId,
      providerName: providers.name,
      siteId: orders.siteId,
      siteName: sites.name,
      status: orders.status,
      subtotal: orders.subtotal,
      total: orders.total,
      notes: orders.notes,
      createdBy: orders.createdBy,
      syncStatus: orders.syncStatus,
      syncVersion: orders.syncVersion,
      createdAt: orders.createdAt,
      updatedAt: orders.updatedAt,
    })
    .from(orders)
    .innerJoin(providers, eq(orders.providerId, providers.id))
    .innerJoin(sites, eq(orders.siteId, sites.id))
    .where(and(eq(orders.id, orderId), eq(orders.tenantId, tenantId)))
    .get();

  if (!order) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'Order not found' });
  }

  const items = await db
    .select({
      id: orderItems.id,
      orderId: orderItems.orderId,
      productId: orderItems.productId,
      productName: products.name,
      productSku: products.sku,
      quantity: orderItems.quantity,
      unitId: orderItems.unitId,
      unitEquivalence: orderItems.unitEquivalence,
      unitName: units.name,
      unitAbbreviation: units.abbreviation,
      costPerUnit: orderItems.costPerUnit,
      baseUnitCost: orderItems.baseUnitCost,
      total: orderItems.total,
    })
    .from(orderItems)
    .innerJoin(products, eq(orderItems.productId, products.id))
    .innerJoin(units, eq(orderItems.unitId, units.id))
    .where(eq(orderItems.orderId, orderId))
    .all();

  const linkedPurchases = await db
    .select({
      id: purchases.id,
      purchaseNumber: purchases.purchaseNumber,
      status: purchases.status,
      total: purchases.total,
      createdAt: purchases.createdAt,
    })
    .from(purchases)
    .where(and(eq(purchases.tenantId, tenantId), eq(purchases.orderId, orderId)))
    .orderBy(desc(purchases.createdAt))
    .all();

  const latestPurchase = linkedPurchases[0] ?? null;
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
  const receivedQuantityMap = new Map(
    receivedQuantities
      .filter(item => item.sourceOrderItemId)
      .map(item => [item.sourceOrderItemId as string, item.receivedQuantity ?? 0])
  );

  return {
    ...order,
    linkedPurchaseCount: linkedPurchases.length,
    linkedPurchases,
    receivedPurchaseId: latestPurchase?.id ?? null,
    receivedPurchaseNumber: latestPurchase?.purchaseNumber ?? null,
    items: items.map(item => {
      const receivedQuantity = receivedQuantityMap.get(item.id) ?? 0;
      return {
        ...item,
        receivedQuantity,
        remainingQuantity: item.quantity - receivedQuantity,
      };
    }),
  };
}
