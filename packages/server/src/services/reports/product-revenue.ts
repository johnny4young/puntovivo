/** Shared, read-only allocation of realized merchandise revenue. */
import { and, eq, gte, lte, sql } from 'drizzle-orm';
import type { DatabaseInstance } from '../../db/index.js';
import { saleItems, saleReturns, sales } from '../../db/schema.js';
import {
  netSaleItemBaseQuantitySql,
  netSaleItemRevenueSql,
  netSaleItemTotalSql,
} from './net-sales.js';

/** Tenant-scoped, inclusive sale-time window (returns use frozen snapshots). */
interface ProductRevenueInput {
  tenantId: string;
  fromDate: string;
  toDate: string;
}

/**
 * Allocate the unreturned ticket discount across all remaining merchandise,
 * before any product ranking/limit. Weights follow the return planner's gross
 * merchandise policy, not current catalog prices. Cumulative rounded cents in
 * stable line-id order conserve every cent, including the final remainder.
 *
 * Taxes, tips and service charges are not product revenue. A discount can
 * exceed the tax-exclusive base: retain that loss instead of clamping it away.
 * Zero-price lines carry no weight (checkout forbids a discount above gross).
 * CTE/window queries keep the cashier projection bounded in SQL without ever
 * reading owner-only costs, or a quadratic per-line cumulative subquery.
 */
export function buildProductRevenueQuery(db: DatabaseInstance, input: ProductRevenueInput) {
  const { tenantId, fromDate, toDate } = input;
  const eligible = and(
    eq(sales.tenantId, tenantId),
    eq(sales.status, 'completed'),
    sql`${sales.paymentStatus} != 'refunded'`,
    gte(sales.createdAt, fromDate),
    lte(sales.createdAt, toDate)
  );
  // Aggregate each ticket's returns once, not once per merchandise line.
  const returns = db.$with('report_ticket_returns').as(
    db
      .select({
        saleId: saleReturns.saleId,
        discount: sql<number>`sum(${saleReturns.discountAmount})`.as('returned_discount'),
      })
      .from(saleReturns)
      .innerJoin(sales, and(eq(saleReturns.saleId, sales.id), eq(sales.tenantId, tenantId)))
      .where(and(eq(saleReturns.tenantId, tenantId), eligible))
      .groupBy(saleReturns.saleId)
  );
  const lines = db.$with('report_revenue_lines').as(
    db
      .select({
        lineId: saleItems.id,
        saleId: saleItems.saleId,
        productId: saleItems.productId,
        baseQuantity: netSaleItemBaseQuantitySql(tenantId).as('net_base_quantity'),
        beforeDiscount: netSaleItemRevenueSql(tenantId).as('before_discount'),
        grossCents:
          sql<number>`cast(round(${netSaleItemTotalSql(tenantId)} * 100, 0) as integer)`.as(
            'gross_cents'
          ),
        discountCents: sql<number>`cast(round((coalesce(${sales.discountAmount}, 0)
          - coalesce(${returns.discount}, 0)) * 100, 0) as integer)`.as('discount_cents'),
      })
      .from(saleItems)
      .innerJoin(sales, and(eq(saleItems.saleId, sales.id), eq(sales.tenantId, tenantId)))
      .leftJoin(returns, eq(returns.saleId, sales.id))
      .where(eligible)
  );
  const weights = db.$with('report_revenue_weights').as(
    db
      .select({
        lineId: lines.lineId,
        saleId: lines.saleId,
        productId: lines.productId,
        baseQuantity: lines.baseQuantity,
        beforeDiscount: lines.beforeDiscount,
        grossCents: lines.grossCents,
        discountCents: lines.discountCents,
        saleGrossCents:
          sql<number>`sum(${lines.grossCents}) over (partition by ${lines.saleId})`.as(
            'sale_gross_cents'
          ),
        cumulativeGrossCents: sql<number>`sum(${lines.grossCents}) over (
        partition by ${lines.saleId} order by ${lines.lineId}
        rows between unbounded preceding and current row
      )`.as('cumulative_gross_cents'),
      })
      .from(lines)
  );
  const revenue = sql<number>`round(${weights.beforeDiscount} - case
    when ${weights.saleGrossCents} > 0 then (
      round(${weights.discountCents} * (1.0 * ${weights.cumulativeGrossCents} / ${weights.saleGrossCents}), 0)
      - round(${weights.discountCents} * (1.0 * (${weights.cumulativeGrossCents} - ${weights.grossCents}) / ${weights.saleGrossCents}), 0)
    ) / 100.0 else 0 end, 2)`;
  return { returns, lines, weights, revenue };
}
