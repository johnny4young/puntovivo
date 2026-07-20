/**
 * Orders router — read procedures ( split).
 *
 * `list` (paginated, receipt-progress metadata) + `getById`. Both manager/admin.
 *
 * @module trpc/routers/orders/queries
 */
import { and, desc, eq, gte, inArray, lte, sql } from 'drizzle-orm';
import { orders, purchases, providers, sites } from '../../../db/schema.js';
import { managerOrAdminProcedure } from '../../middleware/roles.js';
import { getOrderInput, listOrdersInput } from '../../schemas/orders.js';
import { getOrderRecord } from './helpers.js';

export const ordersQueryProcedures = {
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
};
