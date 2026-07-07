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

type DashboardRevenuePoint = {
  date: string;
  revenue: number;
  orders: number;
};

function startOfUtcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function endOfUtcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 23, 59, 59, 999));
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
    sql`${sales.paymentStatus} != 'refunded'`,
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

    const [
      todaySalesStats,
      revenueThirtyDays,
      lowStockCount,
      lowStockItems,
      recentSales,
      topProducts,
      customerCount,
    ] =
      await Promise.all([
        ctx.db
          .select({
            revenue: sql<number>`coalesce(sum(${sales.total}), 0)`,
            orders: sql<number>`count(*)`,
          })
          .from(sales)
          .where(
            and(
              ...completedSaleConditions,
              gte(sales.createdAt, todayStart.toISOString()),
              lte(sales.createdAt, todayEnd.toISOString())
            )
          )
          .get(),
        ctx.db
          .select({
            date: sql<string>`substr(${sales.createdAt}, 1, 10)`,
            revenue: sql<number>`coalesce(sum(${sales.total}), 0)`,
            orders: sql<number>`count(*)`,
          })
          .from(sales)
          .where(
            and(...completedSaleConditions, gte(sales.createdAt, lastThirtyDaysStart.toISOString()))
          )
          .groupBy(sql`substr(${sales.createdAt}, 1, 10)`)
          .orderBy(sql`substr(${sales.createdAt}, 1, 10) asc`)
          .all(),
        ctx.db
          .select({ value: sql<number>`count(*)` })
          .from(products)
          .where(
            and(
              eq(products.tenantId, ctx.tenantId),
              eq(products.isActive, true),
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
            total: sales.total,
            createdAt: sales.createdAt,
            customerName: customers.name,
            customerEmail: customers.email,
          })
          .from(sales)
          .leftJoin(customers, eq(sales.customerId, customers.id))
          .where(eq(sales.tenantId, ctx.tenantId))
          .orderBy(desc(sales.createdAt))
          .limit(5)
          .all(),
        ctx.db
          .select({
            productId: products.id,
            productName: products.name,
            totalQuantity: sql<number>`coalesce(sum(${saleItems.quantity}), 0)`,
            totalRevenue: sql<number>`coalesce(sum(${saleItems.total}), 0)`,
          })
          .from(saleItems)
          .innerJoin(sales, eq(saleItems.saleId, sales.id))
          .innerJoin(products, eq(saleItems.productId, products.id))
          .where(
            and(
              ...completedSaleConditions,
              gte(sales.createdAt, lastSevenDaysStart.toISOString())
            )
          )
          .groupBy(products.id, products.name)
          .orderBy(desc(sql<number>`coalesce(sum(${saleItems.total}), 0)`))
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
