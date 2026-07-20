/**
 * Purchases tRPC Router.
 *
 * the purchase business logic (create / receive-from-order /
 * return / void + the OCR draft helper, resolvers, and read model) was
 * extracted into the `application/purchases/` use-case layer during the
 * megafile decomposition (mirroring `application/sales/`). This router is now
 * thin: it keeps the `list` read inline and delegates each mutation to its
 * use-case, adapting the tRPC context to the minimal `PurchaseContext`.
 *
 * @module trpc/routers/purchases
 */
import { and, desc, eq, gte, inArray, lte, sql } from 'drizzle-orm';
import { router } from '../init.js';
import { adminProcedure, managerOrAdminProcedure } from '../middleware/roles.js';
import { orders, providers, purchaseReturns, purchases, sites, users } from '../../db/schema.js';
import {
  createPurchaseFromOrderInput,
  createPurchaseInput,
  getPurchaseInput,
  listPurchasesInput,
  returnPurchaseInput,
  voidPurchaseInput,
} from '../schemas/purchases.js';
import {
  createPurchase,
  createPurchaseFromOrder,
  getPurchaseRecord,
  returnPurchase,
  voidPurchase,
  type PurchaseContext,
} from '../../application/purchases/index.js';

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
    const purchaseCtx: PurchaseContext = {
      db: ctx.db,
      tenantId: ctx.tenantId,
      siteId: ctx.siteId,
      user: { id: ctx.user!.id, role: ctx.user!.role },
    };
    return createPurchase(purchaseCtx, input);
  }),

  createFromOrder: managerOrAdminProcedure
    .input(createPurchaseFromOrderInput)
    .mutation(async ({ ctx, input }) => {
      const purchaseCtx: PurchaseContext = {
        db: ctx.db,
        tenantId: ctx.tenantId,
        siteId: ctx.siteId,
        user: { id: ctx.user!.id, role: ctx.user!.role },
      };
      return createPurchaseFromOrder(purchaseCtx, input);
    }),

  returnPurchase: managerOrAdminProcedure
    .input(returnPurchaseInput)
    .mutation(async ({ ctx, input }) => {
      const purchaseCtx: PurchaseContext = {
        db: ctx.db,
        tenantId: ctx.tenantId,
        siteId: ctx.siteId,
        user: { id: ctx.user!.id, role: ctx.user!.role },
      };
      return returnPurchase(purchaseCtx, input);
    }),

  void: adminProcedure.input(voidPurchaseInput).mutation(async ({ ctx, input }) => {
    const purchaseCtx: PurchaseContext = {
      db: ctx.db,
      tenantId: ctx.tenantId,
      siteId: ctx.siteId,
      user: { id: ctx.user!.id, role: ctx.user!.role },
    };
    return voidPurchase(purchaseCtx, input);
  }),
});
