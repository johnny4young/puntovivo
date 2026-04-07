/**
 * Dashboard tRPC Router
 *
 * Lightweight aggregate queries for the current dashboard shell.
 *
 * Procedures:
 * - dashboard.summary (tenant) - Stats, recent sales, and top products
 *
 * @module trpc/routers/dashboard
 */

import { and, desc, eq, gte, lt, sql } from 'drizzle-orm';
import { router } from '../init.js';
import { tenantProcedure } from '../middleware/tenant.js';
import { customers, products, saleItems, sales } from '../../db/schema.js';

function startOfMonth(date: Date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}

function addMonths(date: Date, months: number) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + months, 1));
}

function calculateChange(currentValue: number, previousValue: number) {
  if (previousValue === 0) {
    return currentValue === 0 ? 0 : 100;
  }

  return Number((((currentValue - previousValue) / previousValue) * 100).toFixed(1));
}

export const dashboardRouter = router({
  summary: tenantProcedure.query(async ({ ctx }) => {
    const now = new Date();
    const currentMonthStart = startOfMonth(now).toISOString();
    const nextMonthStart = addMonths(startOfMonth(now), 1).toISOString();
    const previousMonthStart = addMonths(startOfMonth(now), -1).toISOString();

    const salesBaseConditions = [eq(sales.tenantId, ctx.tenantId), eq(sales.status, 'completed')] as const;

    const [
      currentSalesStats,
      previousSalesStats,
      totalCustomers,
      currentCustomerCount,
      previousCustomerCount,
      totalProducts,
      currentProductCount,
      previousProductCount,
      recentSales,
      topProducts,
    ] = await Promise.all([
      ctx.db
        .select({
          revenue: sql<number>`coalesce(sum(${sales.total}), 0)`,
          orders: sql<number>`count(*)`,
        })
        .from(sales)
        .where(
          and(
            ...salesBaseConditions,
            gte(sales.createdAt, currentMonthStart),
            lt(sales.createdAt, nextMonthStart)
          )
        )
        .get(),
      ctx.db
        .select({
          revenue: sql<number>`coalesce(sum(${sales.total}), 0)`,
          orders: sql<number>`count(*)`,
        })
        .from(sales)
        .where(
          and(
            ...salesBaseConditions,
            gte(sales.createdAt, previousMonthStart),
            lt(sales.createdAt, currentMonthStart)
          )
        )
        .get(),
      ctx.db
        .select({ value: sql<number>`count(*)` })
        .from(customers)
        .where(eq(customers.tenantId, ctx.tenantId))
        .get(),
      ctx.db
        .select({ value: sql<number>`count(*)` })
        .from(customers)
        .where(
          and(
            eq(customers.tenantId, ctx.tenantId),
            gte(customers.createdAt, currentMonthStart),
            lt(customers.createdAt, nextMonthStart)
          )
        )
        .get(),
      ctx.db
        .select({ value: sql<number>`count(*)` })
        .from(customers)
        .where(
          and(
            eq(customers.tenantId, ctx.tenantId),
            gte(customers.createdAt, previousMonthStart),
            lt(customers.createdAt, currentMonthStart)
          )
        )
        .get(),
      ctx.db
        .select({ value: sql<number>`count(*)` })
        .from(products)
        .where(eq(products.tenantId, ctx.tenantId))
        .get(),
      ctx.db
        .select({ value: sql<number>`count(*)` })
        .from(products)
        .where(
          and(
            eq(products.tenantId, ctx.tenantId),
            gte(products.createdAt, currentMonthStart),
            lt(products.createdAt, nextMonthStart)
          )
        )
        .get(),
      ctx.db
        .select({ value: sql<number>`count(*)` })
        .from(products)
        .where(
          and(
            eq(products.tenantId, ctx.tenantId),
            gte(products.createdAt, previousMonthStart),
            lt(products.createdAt, currentMonthStart)
          )
        )
        .get(),
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
        .where(and(eq(sales.tenantId, ctx.tenantId), eq(sales.status, 'completed')))
        .groupBy(products.id, products.name)
        .orderBy(desc(sql<number>`coalesce(sum(${saleItems.total}), 0)`))
        .limit(5)
        .all(),
    ]);

    const currentRevenue = currentSalesStats?.revenue ?? 0;
    const previousRevenue = previousSalesStats?.revenue ?? 0;
    const currentOrders = currentSalesStats?.orders ?? 0;
    const previousOrders = previousSalesStats?.orders ?? 0;
    const currentCustomers = currentCustomerCount?.value ?? 0;
    const previousCustomers = previousCustomerCount?.value ?? 0;
    const currentProducts = currentProductCount?.value ?? 0;
    const previousProducts = previousProductCount?.value ?? 0;

    return {
      stats: {
        revenue: {
          value: currentRevenue,
          change: calculateChange(currentRevenue, previousRevenue),
          label: 'vs last month',
        },
        orders: {
          value: currentOrders,
          change: calculateChange(currentOrders, previousOrders),
          label: 'vs last month',
        },
        customers: {
          value: totalCustomers?.value ?? 0,
          change: calculateChange(currentCustomers, previousCustomers),
          label: 'new this month vs last month',
        },
        products: {
          value: totalProducts?.value ?? 0,
          change: calculateChange(currentProducts, previousProducts),
          label: 'added this month vs last month',
        },
      },
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
    };
  }),
});
