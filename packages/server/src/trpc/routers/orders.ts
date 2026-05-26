import { TRPCError } from '@trpc/server';
import { and, asc, desc, eq, gte, inArray, lte, sql } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import {
  orderItems,
  orders,
  purchaseItems,
  purchases,
  products,
  providers,
  sequentials,
  sites,
  unitXProduct,
  units,
} from '../../db/schema.js';
import { enqueueSync } from '../../services/sync/enqueue.js';
import type { Context } from '../context.js';
import { router } from '../init.js';
import { managerOrAdminProcedure, adminProcedure } from '../middleware/roles.js';
import {
  createOrderInput,
  getOrderInput,
  listOrdersInput,
  voidOrderInput,
} from '../schemas/orders.js';
import type { CreateOrderInput } from '../schemas/orders.js';
import { roundMoney } from '../../lib/money.js';

type ResolvedOrderItem = {
  id: string;
  productId: string;
  quantity: number;
  unitId: string;
  unitEquivalence: number;
  costPerUnit: number;
  baseUnitCost: number;
  total: number;
};

type OrderSequentialContext = {
  id: string;
  prefix: string;
  currentValue: number;
  siteId: string;
  siteName: string;
};

function buildVoidedOrderNotes(existingNotes: string | null, reason: string | undefined) {
  if (!reason) {
    return `${existingNotes ? `${existingNotes} | ` : ''}Voided`;
  }

  return `${existingNotes ? `${existingNotes} | ` : ''}Voided: ${reason}`;
}

async function getOrderSequentialContext(
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

async function resolveOrderItems(
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

async function getOrderRecord(db: Context['db'], tenantId: string, orderId: string) {
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

export const ordersRouter = router({
  list: managerOrAdminProcedure.input(listOrdersInput).query(async ({ ctx, input }) => {
    const { page, perPage, providerId, status, fromDate, toDate } = input;
    const offset = (page - 1) * perPage;
    const conditions = [eq(orders.tenantId, ctx.tenantId)];

    if (providerId) conditions.push(eq(orders.providerId, providerId));
    if (status) conditions.push(eq(orders.status, status));
    if (fromDate) conditions.push(gte(orders.createdAt, fromDate));
    if (toDate) conditions.push(lte(orders.createdAt, toDate));

    const where = and(...conditions);

    const [items, countResult] = await Promise.all([
      ctx.db
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
        .where(where)
        .orderBy(desc(orders.createdAt))
        .limit(perPage)
        .offset(offset)
        .all(),
      ctx.db
        .select({ count: sql<number>`count(*)` })
        .from(orders)
        .where(where)
        .get(),
    ]);

    const totalItems = countResult?.count ?? 0;
    const orderIds = items.map(item => item.id);
    const linkedPurchases = orderIds.length
      ? await ctx.db
          .select({
            orderId: purchases.orderId,
            id: purchases.id,
            purchaseNumber: purchases.purchaseNumber,
            createdAt: purchases.createdAt,
          })
          .from(purchases)
          .where(and(eq(purchases.tenantId, ctx.tenantId), inArray(purchases.orderId, orderIds)))
          .orderBy(desc(purchases.createdAt))
          .all()
      : [];
    const linkedPurchaseCountByOrderId = new Map<string, number>();
    for (const purchase of linkedPurchases) {
      if (!purchase.orderId) {
        continue;
      }

      linkedPurchaseCountByOrderId.set(
        purchase.orderId,
        (linkedPurchaseCountByOrderId.get(purchase.orderId) ?? 0) + 1
      );
    }
    const latestPurchaseByOrderId = new Map<string, (typeof linkedPurchases)[number]>();
    for (const purchase of linkedPurchases) {
      if (purchase.orderId && !latestPurchaseByOrderId.has(purchase.orderId)) {
        latestPurchaseByOrderId.set(purchase.orderId, purchase);
      }
    }

    return {
      items: items.map(item => {
        const latestPurchase = latestPurchaseByOrderId.get(item.id);
        return {
          ...item,
          linkedPurchaseCount: linkedPurchaseCountByOrderId.get(item.id) ?? 0,
          receivedPurchaseId: latestPurchase?.id ?? null,
          receivedPurchaseNumber: latestPurchase?.purchaseNumber ?? null,
        };
      }),
      page,
      perPage,
      totalItems,
      totalPages: Math.ceil(totalItems / perPage),
    };
  }),

  getById: managerOrAdminProcedure.input(getOrderInput).query(async ({ ctx, input }) => {
    return getOrderRecord(ctx.db, ctx.tenantId, input.id);
  }),

  create: managerOrAdminProcedure.input(createOrderInput).mutation(async ({ ctx, input }) => {
    await validateProvider(ctx.db, ctx.tenantId, input.providerId);

    const now = new Date().toISOString();
    const orderId = nanoid();
    const sequentialContext = await getOrderSequentialContext(ctx.db, ctx.tenantId, ctx.siteId);
    const resolvedItems = await resolveOrderItems(ctx.db, ctx.tenantId, input.items);
    const subtotal = resolvedItems.subtotal;
    const total = subtotal;
    const nextSequentialValue = sequentialContext.currentValue + 1;
    const orderNumber = `${sequentialContext.prefix}${String(nextSequentialValue).padStart(6, '0')}`;

    ctx.db.transaction(tx => {
      tx.update(sequentials)
        .set({
          currentValue: nextSequentialValue,
          updatedAt: now,
        })
        .where(eq(sequentials.id, sequentialContext.id))
        .run();

      tx.insert(orders)
        .values({
          id: orderId,
          tenantId: ctx.tenantId,
          orderNumber,
          providerId: input.providerId,
          siteId: sequentialContext.siteId,
          status: 'submitted',
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
        tx.insert(orderItems)
          .values({
            id: row.id,
            orderId,
            productId: row.productId,
            quantity: row.quantity,
            unitId: row.unitId,
            unitEquivalence: row.unitEquivalence,
            costPerUnit: row.costPerUnit,
            baseUnitCost: row.baseUnitCost,
            total: row.total,
          })
          .run();
      }
    });

    for (const row of resolvedItems.rows) {
      await enqueueSync(ctx, {
        entityType: 'order_items',
        entityId: row.id,
        operation: 'create',
        data: {
          id: row.id,
          orderId,
          productId: row.productId,
          quantity: row.quantity,
          unitId: row.unitId,
          unitEquivalence: row.unitEquivalence,
          costPerUnit: row.costPerUnit,
          baseUnitCost: row.baseUnitCost,
          total: row.total,
        },
      });
    }

    await enqueueSync(ctx, {
      entityType: 'orders',
      entityId: orderId,
      operation: 'create',
      data: {
        id: orderId,
        orderNumber,
        providerId: input.providerId,
        siteId: sequentialContext.siteId,
        status: 'submitted',
        total,
      },
    });

    return getOrderRecord(ctx.db, ctx.tenantId, orderId);
  }),

  void: adminProcedure.input(voidOrderInput).mutation(async ({ ctx, input }) => {
    const existing = await ctx.db
      .select()
      .from(orders)
      .where(and(eq(orders.id, input.id), eq(orders.tenantId, ctx.tenantId)))
      .get();

    if (!existing) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Order not found' });
    }

    if (existing.status === 'voided') {
      throw new TRPCError({ code: 'BAD_REQUEST', message: 'Order is already voided' });
    }

    if (existing.status === 'received' || existing.status === 'partial_received') {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: 'Orders with received stock cannot be voided',
      });
    }

    const nextSyncVersion = (existing.syncVersion ?? 0) + 1;
    const now = new Date().toISOString();

    ctx.db.transaction(tx => {
      tx.update(orders)
        .set({
          status: 'voided',
          notes: buildVoidedOrderNotes(existing.notes, input.reason),
          updatedAt: now,
          syncStatus: 'pending',
          syncVersion: nextSyncVersion,
        })
        .where(eq(orders.id, input.id))
        .run();
    });

    await enqueueSync(ctx, {
      entityType: 'orders',
      entityId: input.id,
      operation: 'update',
      data: { id: input.id, status: 'voided', reason: input.reason },
    });

    return getOrderRecord(ctx.db, ctx.tenantId, input.id);
  }),
});
