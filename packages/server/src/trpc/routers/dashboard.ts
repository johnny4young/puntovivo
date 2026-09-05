/**
 * Dashboard tRPC Router
 *
 * Live reporting queries for the dashboard experience.
 *
 * Procedures:
 * - dashboard.summary (tenant) - Today metrics, revenue trend, low stock, recent sales, top products
 *
 * @module trpc/routers/dashboard
 */

import { and, asc, desc, eq, gte, lte, sql } from 'drizzle-orm';
import { router } from '../init.js';
import { tenantProcedure } from '../middleware/tenant.js';
import { customers, products, saleItems, sales } from '../../db/schema.js';
import { productStockTotalSql } from '../../services/inventory-balances/derive.js';
import {
  dailyDatedRevenueSql,
  datedRevenueSaleConditions,
  netSaleItemQuantitySql,
  netSaleItemTotalSql,
  netSaleTotalSql,
  windowReturnedAmountSql,
} from '../../services/reports/net-sales.js';

type DashboardRevenuePoint = {
  date: string;
  revenue: number;
  orders: number;
};

function startOfUtcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function endOfUtcDay(date: Date): Date {
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 23, 59, 59, 999)
  );
}

function addUtcDays(date: Date, days: number): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + days));
}

function toIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function buildRevenueSeries(days: number, today: Date, rows: DashboardRevenuePoint[]) {
  const rowMap = new Map(rows.map(row => [row.date, row]));
  const startDate = addUtcDays(startOfUtcDay(today), -(days - 1));

  return Array.from({ length: days }, (_, offset) => {
    const currentDate = addUtcDays(startDate, offset);
    const isoDate = toIsoDate(currentDate);
    const row = rowMap.get(isoDate);

    return {
      date: isoDate,
      revenue: row?.revenue ?? 0,
      orders: row?.orders ?? 0,
    };
  });
}

function getRevenueEligibleSaleConditions(tenantId: string) {
  return [
    eq(sales.tenantId, tenantId),
    eq(sales.status, 'completed'),
    sql`(${sales.returnState} is null or ${sales.returnState} != 'refunded')`,
  ] as const;
}

export const dashboardRouter = router({
  summary: tenantProcedure.query(async ({ ctx }) => {
    const now = new Date();
    const todayStart = startOfUtcDay(now);
    const todayEnd = endOfUtcDay(now);
    const lastThirtyDaysStart = addUtcDays(todayStart, -29);
    const lastSevenDaysStart = addUtcDays(todayStart, -6);

    const completedSaleConditions = getRevenueEligibleSaleConditions(ctx.tenantId);
    const netSaleTotal = netSaleTotalSql(ctx.tenantId);
    // Period revenue books returns as dated events; see net-sales. The
    // per-ticket helper above stays for the recent-sales list, where lifetime
    // net is a property of the ticket rather than of a period.
    const todayFrom = todayStart.toISOString();
    const todayTo = todayEnd.toISOString();
    const todayRefunds = windowReturnedAmountSql(ctx.tenantId, todayFrom, todayTo);
    const netLineQuantity = netSaleItemQuantitySql(ctx.tenantId);
    const netLineTotal = netSaleItemTotalSql(ctx.tenantId);
    // Drafts can stay open across a reporting boundary. Completed-at
    // is the authoritative business instant; created-at remains the
    // compatibility fallback for historical rows predating telemetry.
    const completedAt = sql<string>`coalesce(${sales.checkoutCompletedAt}, ${sales.createdAt})`;

    const [
      todaySalesStats,
      revenueThirtyDays,
      lowStockCount,
      lowStockItems,
      recentSales,
      topProducts,
      customerCount,
    ] = await Promise.all([
      ctx.db
        .select({
          revenue: sql<number>`round(coalesce(sum(${sales.total}), 0) - ${todayRefunds}, 2)`,
          // Revenue goes dated; the ORDER count deliberately does not change
          // meaning. A fully returned ticket was never counted as an order and
          // still is not — the review comment was about revenue restating a
          // closed period, not about redefining throughput.
          orders: sql<number>`sum(case when ${sales.returnState} is null or ${sales.returnState} != 'refunded' then 1 else 0 end)`,
        })
        .from(sales)
        .where(
          and(
            ...datedRevenueSaleConditions(ctx.tenantId),
            gte(completedAt, todayFrom),
            lte(completedAt, todayTo)
          )
        )
        .get(),
      Promise.resolve(
        ctx.db.all(dailyDatedRevenueSql(ctx.tenantId, lastThirtyDaysStart.toISOString())) as unknown
      ) as Promise<Array<{ date: string; revenue: number; orders: number }>>,
      ctx.db
        .select({ value: sql<number>`count(*)` })
        .from(products)
        .where(
          and(
            eq(products.tenantId, ctx.tenantId),
            eq(products.isActive, true),
            // service items have no inventory identity: their
            // structural stock 0 with the default minStock 0 would make
            // every service permanently low-stock and evict the physical
            // products that are actually running out.
            eq(products.tracksStock, true),
            lte(productStockTotalSql, products.minStock)
          )
        )
        .get(),
      ctx.db
        .select({
          productId: products.id,
          name: products.name,
          sku: products.sku,
          stock: productStockTotalSql,
          minStock: products.minStock,
        })
        .from(products)
        .where(
          and(
            eq(products.tenantId, ctx.tenantId),
            eq(products.isActive, true),
            // service items have no inventory identity: their
            // structural stock 0 with the default minStock 0 would make
            // every service permanently low-stock and evict the physical
            // products that are actually running out.
            eq(products.tracksStock, true),
            lte(productStockTotalSql, products.minStock)
          )
        )
        .orderBy(asc(productStockTotalSql), desc(products.updatedAt))
        .limit(5)
        .all(),
      ctx.db
        .select({
          id: sales.id,
          saleNumber: sales.saleNumber,
          total: netSaleTotal,
          createdAt: completedAt,
          customerName: customers.name,
          customerEmail: customers.email,
        })
        .from(sales)
        .leftJoin(
          customers,
          and(eq(sales.customerId, customers.id), eq(customers.tenantId, ctx.tenantId))
        )
        // Same revenue-eligibility filter the stats above use: a
        // parked draft, a cancelled ticket or a voided/refunded sale
        // is not a recent SALE, and listing them made the panel
        // disagree with the totals right beside it.
        .where(and(...completedSaleConditions))
        .orderBy(desc(completedAt))
        .limit(5)
        .all(),
      ctx.db
        .select({
          productId: products.id,
          productName: products.name,
          totalQuantity: sql<number>`round(coalesce(sum(${netLineQuantity}), 0), 3)`,
          totalRevenue: sql<number>`round(coalesce(sum(${netLineTotal}), 0), 2)`,
        })
        .from(saleItems)
        .innerJoin(sales, and(eq(saleItems.saleId, sales.id), eq(sales.tenantId, ctx.tenantId)))
        .innerJoin(
          products,
          and(eq(saleItems.productId, products.id), eq(products.tenantId, ctx.tenantId))
        )
        .where(
          and(
            ...completedSaleConditions,
            gte(completedAt, lastSevenDaysStart.toISOString()),
            sql`${netLineQuantity} > 0`
          )
        )
        .groupBy(products.id, products.name)
        .orderBy(desc(sql<number>`round(coalesce(sum(${netLineTotal}), 0), 2)`))
        .limit(5)
        .all(),
      ctx.db
        .select({ value: sql<number>`count(*)` })
        .from(customers)
        .where(and(eq(customers.tenantId, ctx.tenantId), eq(customers.isActive, true)))
        .get(),
    ]);

    const revenueSeries = buildRevenueSeries(30, now, revenueThirtyDays);
    const revenueThirtyDayTotal = revenueSeries.reduce((total, point) => total + point.revenue, 0);

    return {
      generatedAt: now.toISOString(),
      stats: {
        todayRevenue: {
          value: todaySalesStats?.revenue ?? 0,
          label: 'completed sales today',
        },
        todayOrders: {
          value: todaySalesStats?.orders ?? 0,
          label: 'completed orders today',
        },
        lowStockCount: {
          value: lowStockCount?.value ?? 0,
          label: 'products at or below min stock',
        },
        revenueThirtyDays: {
          value: revenueThirtyDayTotal,
          label: 'completed sales over the last 30 days',
        },
        customers: {
          value: customerCount?.value ?? 0,
          label: 'active customer records',
        },
      },
      revenueChart: revenueSeries,
      recentSales: recentSales.map(sale => ({
        id: sale.id,
        saleNumber: sale.saleNumber,
        customerName: sale.customerName ?? 'Walk-in customer',
        customerEmail: sale.customerEmail ?? 'No email',
        total: sale.total,
        createdAt: sale.createdAt,
      })),
      topProducts: topProducts.map(product => ({
        productId: product.productId,
        name: product.productName,
        sales: product.totalQuantity,
        revenue: product.totalRevenue,
      })),
      lowStockItems,
    };
  }),
});
