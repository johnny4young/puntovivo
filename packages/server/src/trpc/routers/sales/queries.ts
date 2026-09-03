/**
 * Sales router read-side procedures (summary KPIs, list, getById, listDrafts).
 *
 * extracted verbatim from the former flat `trpc/routers/sales.ts`
 * during the megafile decomposition. Exported as a procedure record that
 * `index.ts` spreads into the assembled `salesRouter` (paths unchanged).
 *
 * @module trpc/routers/sales/queries
 */
import { and, desc, eq, gte, lte, sql } from 'drizzle-orm';

import { tenantProcedure } from '../../middleware/tenant.js';
import { cashierManagerOrAdminProcedure } from '../../middleware/roles.js';
import {
  cashSessions,
  customers,
  restaurantChecks,
  restaurantServices,
  restaurantTables,
  saleItems,
  sales,
} from '../../../db/schema.js';
import { getSaleInput, listDraftsInput, listSalesInput } from '../../schemas/sales.js';
import { getSaleRecord } from '../../../application/sales/sale-read.js';
import { netSaleTotalSql } from '../../../services/reports/net-sales.js';
import { getRevenueEligibleSaleConditions } from './helpers.js';
import { ensureTenantSite } from '../../middleware/tenantSite.js';

export const salesQueryProcedures = {
  summary: tenantProcedure.query(async ({ ctx }) => {
    const now = new Date();
    const startOfToday = new Date(now);
    startOfToday.setHours(0, 0, 0, 0);
    const endOfToday = new Date(startOfToday);
    endOfToday.setDate(endOfToday.getDate() + 1);

    const completedSaleConditions = getRevenueEligibleSaleConditions(ctx.tenantId);
    const netSaleTotal = netSaleTotalSql(ctx.tenantId);

    const [today, totals, pending] = await Promise.all([
      ctx.db
        .select({
          total: sql<number>`round(coalesce(sum(${netSaleTotal}), 0), 2)`,
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
          grossTotal: sql<number>`round(coalesce(sum(${netSaleTotal}), 0), 2)`,
        })
        .from(sales)
        .where(and(...completedSaleConditions))
        .get(),
      ctx.db
        .select({
          total: sql<number>`round(coalesce(sum(${netSaleTotal}), 0), 2)`,
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
          currencyCode: sales.currencyCode,
          customerId: sales.customerId,
          customerName: sql<
            string | null
          >`coalesce(${sales.customerNameSnapshot}, ${customers.name})`,
          customerNameSnapshot: sales.customerNameSnapshot,
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
          // Partial returns are one-to-many. Correlated summaries keep one
          // list row per sale so pagination/counts cannot be multiplied by
          // the number of return events. Detail/history remains authoritative
          // through getSaleRecord.
          returnId: sql<string | null>`(
            select sr.id from sale_returns sr
            where sr.sale_id = ${sales.id} and sr.tenant_id = ${ctx.tenantId}
            order by sr.created_at desc, sr.id desc limit 1
          )`,
          returnReason: sql<string | null>`(
            select sr.reason from sale_returns sr
            where sr.sale_id = ${sales.id} and sr.tenant_id = ${ctx.tenantId}
            order by sr.created_at desc, sr.id desc limit 1
          )`,
          refundAmount: sql<number>`coalesce((
            select sum(sr.refund_amount) from sale_returns sr
            where sr.sale_id = ${sales.id} and sr.tenant_id = ${ctx.tenantId}
          ), 0)`,
          returnedAt: sql<string | null>`(
            select sr.created_at from sale_returns sr
            where sr.sale_id = ${sales.id} and sr.tenant_id = ${ctx.tenantId}
            order by sr.created_at desc, sr.id desc limit 1
          )`,
        })
        .from(sales)
        .leftJoin(
          customers,
          and(eq(sales.customerId, customers.id), eq(customers.tenantId, ctx.tenantId))
        )
        .where(where)
        .orderBy(desc(sales.createdAt), desc(sales.id))
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
   * List parked drafts plus the caller's own active recovery claims. Cashiers
   * see drafts they parked, legacy ownerless parks they created, and open
   * normalized restaurant checks at the explicitly requested site, enabling
   * waiter-to-register handoff without exposing unrelated retail carts.
   * Managers and admins see every suspended draft for the tenant (optionally
   * narrowed by site).
   *
   * Returned shape is intentionally flat (no items/payments) so the
   * resume panel renders fast. The full sale is fetched via
   * `sales.resume` or `sales.getById` when the operator picks one.
   */
  listDrafts: cashierManagerOrAdminProcedure
    .input(listDraftsInput)
    .query(async ({ ctx, input }) => {
      const { page, perPage, siteId: siteFilter, search } = input;
      const offset = (page - 1) * perPage;

      if (siteFilter) {
        await ensureTenantSite(ctx.db, ctx.tenantId, siteFilter);
      }

      const conditions = [eq(sales.tenantId, ctx.tenantId), eq(sales.status, 'draft')];

      const actorRole = ctx.user?.role;
      if (actorRole === 'cashier') {
        // An active claim is visible only to its actor so a re-authenticated
        // session can recover it after local-storage loss or token expiry.
        // Parked generic retail drafts remain owner-only. Historical rows
        // migrated from an active legacy draft have no suspendedBy; createdBy
        // is the conservative compatibility owner. A normalized open check is
        // shared only when the caller deliberately requests that service's
        // site; an unfiltered query must never become tenant-wide handoff.
        conditions.push(
          siteFilter
            ? sql`(
                (${sales.suspendedAt} IS NULL AND ${sales.resumedBy} = ${ctx.user!.id})
                OR (${sales.suspendedAt} IS NOT NULL AND (
                  ${sales.suspendedBy} = ${ctx.user!.id}
                  OR (${sales.suspendedBy} IS NULL AND ${sales.createdBy} = ${ctx.user!.id})
                  OR EXISTS (
                    SELECT 1
                    FROM ${restaurantChecks}
                    INNER JOIN ${restaurantServices}
                      ON ${restaurantServices.id} = ${restaurantChecks.serviceId}
                      AND ${restaurantServices.tenantId} = ${ctx.tenantId}
                    WHERE ${restaurantChecks.tenantId} = ${ctx.tenantId}
                      AND ${restaurantChecks.saleId} = ${sales.id}
                      AND ${restaurantChecks.status} = 'open'
                      AND ${restaurantServices.status} = 'open'
                      AND ${restaurantServices.siteId} = ${siteFilter}
                      AND ${restaurantServices.tableId} = ${sales.tableId}
                  )
                ))
              )`
            : sql`(
                (${sales.suspendedAt} IS NULL AND ${sales.resumedBy} = ${ctx.user!.id})
                OR (${sales.suspendedAt} IS NOT NULL AND (
                  ${sales.suspendedBy} = ${ctx.user!.id}
                  OR (${sales.suspendedBy} IS NULL AND ${sales.createdBy} = ${ctx.user!.id})
                ))
              )`
        );
      } else {
        // Managers/admins see every parked draft, but an active draft remains
        // private to its current actor. Their server-side override still
        // applies when they address a known id deliberately.
        conditions.push(
          sql`(${sales.suspendedAt} IS NOT NULL OR (${sales.suspendedAt} IS NULL AND ${sales.resumedBy} = ${ctx.user!.id}))`
        );
      }

      if (siteFilter) {
        conditions.push(
          sql`(${sales.cashSessionId} IS NULL OR ${sales.cashSessionId} IN (SELECT id FROM ${cashSessions} WHERE ${cashSessions.siteId} = ${siteFilter} AND ${cashSessions.tenantId} = ${ctx.tenantId})) AND (${sales.tableId} IS NULL OR ${sales.tableId} IN (SELECT id FROM ${restaurantTables} WHERE ${restaurantTables.siteId} = ${siteFilter} AND ${restaurantTables.tenantId} = ${ctx.tenantId}))`
        );
      }

      if (search && search.length > 0) {
        const pattern = `%${search.toLowerCase()}%`;
        conditions.push(
          sql`(lower(${sales.saleNumber}) LIKE ${pattern} OR lower(coalesce(${sales.suspendedLabel}, '')) LIKE ${pattern} OR lower(coalesce((SELECT ${restaurantChecks.label} FROM ${restaurantChecks} WHERE ${restaurantChecks.tenantId} = ${ctx.tenantId} AND ${restaurantChecks.saleId} = ${sales.id} LIMIT 1), '')) LIKE ${pattern})`
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
            resumedBy: sales.resumedBy,
            resumedDeviceId: sales.resumedDeviceId,
            suspendedLabel: sales.suspendedLabel,
            restaurantCheckLabel: sql<
              string | null
            >`(SELECT ${restaurantChecks.label} FROM ${restaurantChecks} WHERE ${restaurantChecks.tenantId} = ${ctx.tenantId} AND ${restaurantChecks.saleId} = ${sales.id} LIMIT 1)`,
            restaurantCheckId: sql<
              string | null
            >`(SELECT ${restaurantChecks.id} FROM ${restaurantChecks} WHERE ${restaurantChecks.tenantId} = ${ctx.tenantId} AND ${restaurantChecks.saleId} = ${sales.id} LIMIT 1)`,
            // surface the restaurant table linkage so the
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
          .leftJoin(
            customers,
            and(eq(sales.customerId, customers.id), eq(customers.tenantId, ctx.tenantId))
          )
          .leftJoin(
            restaurantTables,
            and(eq(sales.tableId, restaurantTables.id), eq(restaurantTables.tenantId, ctx.tenantId))
          )
          .where(where)
          .orderBy(desc(sales.suspendedAt), desc(sales.id))
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
