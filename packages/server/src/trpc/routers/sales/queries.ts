/**
 * Sales router read-side procedures (summary KPIs, list, getById, listDrafts).
 *
 * ENG-178 — extracted verbatim from the former flat `trpc/routers/sales.ts`
 * during the megafile decomposition. Exported as a procedure record that
 * `index.ts` spreads into the assembled `salesRouter` (paths unchanged).
 *
 * @module trpc/routers/sales/queries
 */
import { and, desc, eq, gte, lte, sql } from 'drizzle-orm';

import { tenantProcedure } from '../../middleware/tenant.js';
import {
  cashSessions,
  customers,
  restaurantTables,
  saleItems,
  saleReturns,
  sales,
} from '../../../db/schema.js';
import { getSaleInput, listDraftsInput, listSalesInput } from '../../schemas/sales.js';
import { getSaleRecord } from '../../../application/sales/sale-read.js';
import { getRevenueEligibleSaleConditions } from './helpers.js';

export const salesQueryProcedures = {
  summary: tenantProcedure.query(async ({ ctx }) => {
    const now = new Date();
    const startOfToday = new Date(now);
    startOfToday.setHours(0, 0, 0, 0);
    const endOfToday = new Date(startOfToday);
    endOfToday.setDate(endOfToday.getDate() + 1);

    const completedSaleConditions = getRevenueEligibleSaleConditions(ctx.tenantId);

    const [today, totals, pending] = await Promise.all([
      ctx.db
        .select({
          total: sql<number>`coalesce(sum(${sales.total}), 0)`,
        })
        .from(sales)
        .where(
          and(
            ...completedSaleConditions,
            gte(sales.createdAt, startOfToday.toISOString()),
            lte(sales.createdAt, endOfToday.toISOString())
          )
        )
        .get(),
      ctx.db
        .select({
          transactionCount: sql<number>`count(*)`,
          grossTotal: sql<number>`coalesce(sum(${sales.total}), 0)`,
        })
        .from(sales)
        .where(and(...completedSaleConditions))
        .get(),
      ctx.db
        .select({
          total: sql<number>`coalesce(sum(${sales.total}), 0)`,
        })
        .from(sales)
        .where(and(...completedSaleConditions, eq(sales.paymentStatus, 'pending')))
        .get(),
    ]);

    const transactionCount = totals?.transactionCount ?? 0;
    const grossTotal = totals?.grossTotal ?? 0;

    return {
      todaySalesTotal: today?.total ?? 0,
      transactionCount,
      averageOrder: transactionCount > 0 ? grossTotal / transactionCount : 0,
      pendingPaymentsTotal: pending?.total ?? 0,
    };
  }),

  /**
   * List sales for the current tenant with pagination and filtering
   */
  list: tenantProcedure.input(listSalesInput).query(async ({ ctx, input }) => {
    const { page, perPage, customerId, status, paymentStatus, fromDate, toDate } = input;
    const offset = (page - 1) * perPage;

    const conditions = [eq(sales.tenantId, ctx.tenantId)];
    if (customerId) conditions.push(eq(sales.customerId, customerId));
    if (status) conditions.push(eq(sales.status, status));
    if (paymentStatus) conditions.push(eq(sales.paymentStatus, paymentStatus));
    if (fromDate) conditions.push(gte(sales.createdAt, fromDate));
    if (toDate) conditions.push(lte(sales.createdAt, toDate));

    const where = and(...conditions);

    const [items, countResult] = await Promise.all([
      ctx.db
        .select({
          id: sales.id,
          tenantId: sales.tenantId,
          saleNumber: sales.saleNumber,
          customerId: sales.customerId,
          customerName: customers.name,
          subtotal: sales.subtotal,
          taxAmount: sales.taxAmount,
          discountAmount: sales.discountAmount,
          total: sales.total,
          paymentMethod: sales.paymentMethod,
          paymentStatus: sales.paymentStatus,
          status: sales.status,
          notes: sales.notes,
          createdBy: sales.createdBy,
          syncStatus: sales.syncStatus,
          syncVersion: sales.syncVersion,
          createdAt: sales.createdAt,
          updatedAt: sales.updatedAt,
          returnId: saleReturns.id,
          returnReason: saleReturns.reason,
          refundAmount: saleReturns.refundAmount,
          returnedAt: saleReturns.createdAt,
        })
        .from(sales)
        .leftJoin(customers, eq(sales.customerId, customers.id))
        .leftJoin(saleReturns, eq(saleReturns.saleId, sales.id))
        .where(where)
        .orderBy(desc(sales.createdAt))
        .limit(perPage)
        .offset(offset)
        .all(),
      ctx.db
        .select({ count: sql<number>`count(*)` })
        .from(sales)
        .where(where)
        .get(),
    ]);

    const totalItems = countResult?.count ?? 0;

    return {
      items,
      page,
      perPage,
      totalItems,
      totalPages: Math.ceil(totalItems / perPage),
    };
  }),

  /**
   * Get a single sale with its line items
   */
  getById: tenantProcedure.input(getSaleInput).query(async ({ ctx, input }) => {
    return getSaleRecord(ctx.db, ctx.tenantId, input.id);
  }),

  /**
   * ENG-018 — List suspended drafts. Cashiers only see drafts they
   * themselves suspended; managers and admins see every suspended
   * draft for the tenant (optionally narrowed by site).
   *
   * Returned shape is intentionally flat (no items/payments) so the
   * resume panel renders fast. The full sale is fetched via
   * `sales.resume` or `sales.getById` when the operator picks one.
   */
  listDrafts: tenantProcedure.input(listDraftsInput).query(async ({ ctx, input }) => {
    const { page, perPage, siteId: siteFilter, search } = input;
    const offset = (page - 1) * perPage;

    const conditions = [
      eq(sales.tenantId, ctx.tenantId),
      eq(sales.status, 'draft'),
      sql`${sales.suspendedAt} IS NOT NULL`,
    ];

    const actorRole = ctx.user?.role;
    if (actorRole === 'cashier') {
      // Cashiers never see another operator's draft — not even on the
      // same site — to keep the surface small and private.
      conditions.push(eq(sales.suspendedBy, ctx.user!.id));
    }

    if (siteFilter) {
      conditions.push(
        sql`${sales.cashSessionId} IN (SELECT id FROM ${cashSessions} WHERE ${cashSessions.siteId} = ${siteFilter} AND ${cashSessions.tenantId} = ${ctx.tenantId})`
      );
    }

    if (search && search.length > 0) {
      const pattern = `%${search.toLowerCase()}%`;
      conditions.push(
        sql`(lower(${sales.saleNumber}) LIKE ${pattern} OR lower(coalesce(${sales.suspendedLabel}, '')) LIKE ${pattern})`
      );
    }

    const where = and(...conditions);

    const [items, countResult] = await Promise.all([
      ctx.db
        .select({
          id: sales.id,
          saleNumber: sales.saleNumber,
          customerId: sales.customerId,
          customerName: customers.name,
          subtotal: sales.subtotal,
          taxAmount: sales.taxAmount,
          total: sales.total,
          notes: sales.notes,
          suspendedAt: sales.suspendedAt,
          suspendedBy: sales.suspendedBy,
          suspendedLabel: sales.suspendedLabel,
          // ENG-039c — surface the restaurant table linkage so the
          // suspended-sales panel can render a resolved badge instead
          // of relying on the denormalized free-text label.
          tableId: sales.tableId,
          tableName: restaurantTables.name,
          createdBy: sales.createdBy,
          cashSessionId: sales.cashSessionId,
          createdAt: sales.createdAt,
          updatedAt: sales.updatedAt,
          itemCount: sql<number>`(SELECT count(*) FROM ${saleItems} WHERE ${saleItems.saleId} = ${sales.id})`,
        })
        .from(sales)
        .leftJoin(customers, eq(sales.customerId, customers.id))
        .leftJoin(
          restaurantTables,
          and(
            eq(sales.tableId, restaurantTables.id),
            eq(restaurantTables.tenantId, ctx.tenantId)
          )
        )
        .where(where)
        .orderBy(desc(sales.suspendedAt))
        .limit(perPage)
        .offset(offset)
        .all(),
      ctx.db
        .select({ count: sql<number>`count(*)` })
        .from(sales)
        .where(where)
        .get(),
    ]);

    const totalItems = countResult?.count ?? 0;

    return {
      items,
      page,
      perPage,
      totalItems,
      totalPages: Math.ceil(totalItems / perPage),
    };
  }),
};
