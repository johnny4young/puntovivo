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

import { and, asc, desc, eq, lte, sql } from 'drizzle-orm';
import { isSupportedTimeZone } from '../../lib/time-zone.js';
import { throwServerError } from '../../lib/errorCodes.js';
import { router } from '../init.js';
import { tenantProcedure } from '../middleware/tenant.js';
import { customers, products, sales } from '../../db/schema.js';
import { productStockTotalSql } from '../../services/inventory-balances/derive.js';
import {
  dailyDatedRevenueSql,
  netSaleTotalSql,
  windowedProductTotalsSql,
  type WindowedProductTotalsRow,
  type DailyRevenueRow,
} from '../../services/reports/net-sales.js';
import { resolveTenantLocale } from '../../services/tenant-locale.js';
import {
  addCalendarDays,
  calendarDayInTimeZone,
  resolveUtcDayWindow,
} from '../../services/reports/day-window.js';

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
    const { timezone } = await resolveTenantLocale(ctx.db, ctx.tenantId);
    // Legacy persisted overrides predate write validation. Do not silently
    // report another calendar's totals when the company configuration is invalid.
    if (!isSupportedTimeZone(timezone)) {
      throwServerError({
        trpcCode: 'PRECONDITION_FAILED',
        errorCode: 'TENANT_TIMEZONE_INVALID',
        message: 'Correct or clear the company time zone override before loading the dashboard.',
      });
    }
    const today = calendarDayInTimeZone(now, timezone);
    const windows = Array.from({ length: 30 }, (_, offset) => {
      const date = addCalendarDays(today, offset - 29);
      return { date, ...resolveUtcDayWindow(date, timezone) };
    });
    const { endExclusiveIso } = resolveUtcDayWindow(today, timezone);
    const lastSevenDaysStart = resolveUtcDayWindow(addCalendarDays(today, -6), timezone).startIso;

    const completedSaleConditions = getRevenueEligibleSaleConditions(ctx.tenantId);
    const netSaleTotal = netSaleTotalSql(ctx.tenantId);
    // Completion is authoritative; historical rows retain their created-at fallback.
    const completedAt = sql<string>`coalesce(${sales.checkoutCompletedAt}, ${sales.createdAt})`;

    const [
      revenueThirtyDays,
      lowStockCount,
      lowStockItems,
      recentSales,
      topProducts,
      customerCount,
    ] = await Promise.all([
      ctx.db.all<DailyRevenueRow>(dailyDatedRevenueSql(ctx.tenantId, windows)),
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
      // Top products books returns as DATED EVENTS, like every other period
      // figure on this dashboard. Summing the per-line net helpers under a
      // window on the sale date instead made a return booked today shrink the
      // week its ticket was sold in, and could not represent a return booked
      // this week for a sale made before it at all.
      ctx.db.all<WindowedProductTotalsRow>(
        windowedProductTotalsSql(ctx.tenantId, lastSevenDaysStart, endExclusiveIso, 5)
      ),
      ctx.db
        .select({ value: sql<number>`count(*)` })
        .from(customers)
        .where(and(eq(customers.tenantId, ctx.tenantId), eq(customers.isActive, true)))
        .get(),
    ]);

    const rowsByDay = new Map(revenueThirtyDays.map(row => [row.date, row]));
    const revenueSeries = windows.map(
      ({ date }) => rowsByDay.get(date) ?? { date, revenue: 0, orders: 0 }
    );
    // Today and the chart share the same dated-event aggregate and calendar boundaries.
    const todaySalesStats = revenueSeries.at(-1);
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
