/**
 * Frozen-return-aware SQL expressions for realized sales reads.
 *
 * These helpers deliberately subtract immutable sale-return snapshots, never
 * live catalog values. They are correlated through indexed identifiers and
 * tenant-scoped inside each subquery so a dashboard/report cannot overstate a
 * partially returned ticket or cross a tenant boundary.
 *
 * TWO DIFFERENT QUESTIONS, TWO DIFFERENT SHAPES.
 *
 * "What is this ticket worth now?" is a property of the ticket, so the
 * `net*Sql` helpers below subtract its LIFETIME returns from the row. That is
 * correct for per-ticket displays.
 *
 * "How much did we make in this period?" is not. Correlating lifetime returns
 * onto sale rows and then windowing on the SALE date means a return booked
 * today silently rewrites the day it was sold — restating a closed period and
 * a signed day close — while contributing nothing to today. It also cannot
 * express the opposite case at all: a return booked inside the window for a
 * sale made before it belongs to this period's revenue, but its sale row is
 * not in the window to be correlated against.
 *
 * Periods therefore book returns as DATED EVENTS: sum the sales completed in
 * the window, then subtract, as a separate term, the returns CREATED in the
 * window regardless of when their sale happened. That is what
 * `windowReturnedAmountSql` and its line-level siblings are for, and it is the
 * same instant the accounting path already books at, so the two views of the
 * same money finally agree.
 */

import { sql, type SQL } from 'drizzle-orm';
import { saleItems, sales } from '../../db/schema.js';

export function saleReturnedAmountSql(tenantId: string): SQL<number> {
  return sql<number>`coalesce((
    select sum(sr.refund_amount)
    from sale_returns sr
    where sr.tenant_id = ${tenantId} and sr.sale_id = ${sales.id}
  ), 0)`;
}

export function netSaleTotalSql(tenantId: string): SQL<number> {
  return sql<number>`max(0, round(${sales.total} - ${saleReturnedAmountSql(tenantId)}, 2))`;
}

export function returnedSaleItemQuantitySql(tenantId: string): SQL<number> {
  return sql<number>`coalesce((
    select sum(sri.quantity)
    from sale_return_items sri
    where sri.tenant_id = ${tenantId} and sri.sale_item_id = ${saleItems.id}
  ), 0)`;
}

export function returnedSaleItemBaseQuantitySql(tenantId: string): SQL<number> {
  return sql<number>`coalesce((
    select sum(sri.base_quantity)
    from sale_return_items sri
    where sri.tenant_id = ${tenantId} and sri.sale_item_id = ${saleItems.id}
  ), 0)`;
}

export function returnedSaleItemTotalSql(tenantId: string): SQL<number> {
  return sql<number>`coalesce((
    select sum(sri.total)
    from sale_return_items sri
    where sri.tenant_id = ${tenantId} and sri.sale_item_id = ${saleItems.id}
  ), 0)`;
}

export function returnedSaleItemCostSql(tenantId: string): SQL<number> {
  return sql<number>`coalesce((
    select sum(sri.cost_amount)
    from sale_return_items sri
    where sri.tenant_id = ${tenantId} and sri.sale_item_id = ${saleItems.id}
  ), 0)`;
}

export function netSaleItemQuantitySql(tenantId: string): SQL<number> {
  return sql<number>`max(0, round(
    ${saleItems.quantity} - ${returnedSaleItemQuantitySql(tenantId)},
    3
  ))`;
}

export function netSaleItemBaseQuantitySql(tenantId: string): SQL<number> {
  return sql<number>`max(0, round(
    (${saleItems.quantity} * ${saleItems.unitEquivalence}) -
      ${returnedSaleItemBaseQuantitySql(tenantId)},
    3
  ))`;
}

export function netSaleItemTotalSql(tenantId: string): SQL<number> {
  return sql<number>`max(0, round(
    ${saleItems.total} - ${returnedSaleItemTotalSql(tenantId)},
    2
  ))`;
}

export function netSaleItemCostSql(tenantId: string, originalCost: SQL<number>): SQL<number> {
  return sql<number>`max(0, round(
    ${originalCost} - ${returnedSaleItemCostSql(tenantId)},
    2
  ))`;
}

/**
 * Refunds BOOKED inside [fromIso, toIso), whatever period their sale belongs
 * to. Subtract this from a window's gross sales instead of correlating
 * lifetime returns onto the sale rows.
 */
export function windowReturnedAmountSql(
  tenantId: string,
  fromIso: string,
  toIso: string
): SQL<number> {
  return sql<number>`coalesce((
    select sum(sr.refund_amount)
    from sale_returns sr
    join sales s on s.id = sr.sale_id and s.tenant_id = sr.tenant_id
    where sr.tenant_id = ${tenantId}
      and s.status = 'completed'
      and sr.created_at >= ${fromIso}
      and sr.created_at < ${toIso}
  ), 0)`;
}

/** Line quantity returned inside the window, for unit-count reports. */
export function windowReturnedItemQuantitySql(
  tenantId: string,
  fromIso: string,
  toIso: string
): SQL<number> {
  return sql<number>`coalesce((
    select sum(sri.quantity)
    from sale_return_items sri
    join sale_returns sr on sr.id = sri.sale_return_id and sr.tenant_id = sri.tenant_id
    join sales s on s.id = sr.sale_id and s.tenant_id = sr.tenant_id
    where sri.tenant_id = ${tenantId}
      and s.status = 'completed'
      and sr.created_at >= ${fromIso}
      and sr.created_at < ${toIso}
  ), 0)`;
}

/** Line revenue returned inside the window, for line-level revenue reports. */
export function windowReturnedItemTotalSql(
  tenantId: string,
  fromIso: string,
  toIso: string
): SQL<number> {
  return sql<number>`coalesce((
    select sum(sri.total)
    from sale_return_items sri
    join sale_returns sr on sr.id = sri.sale_return_id and sr.tenant_id = sri.tenant_id
    join sales s on s.id = sr.sale_id and s.tenant_id = sr.tenant_id
    where sri.tenant_id = ${tenantId}
      and s.status = 'completed'
      and sr.created_at >= ${fromIso}
      and sr.created_at < ${toIso}
  ), 0)`;
}

/**
 * Sale-side conditions for a DATED revenue window.
 *
 * Deliberately does NOT exclude sales that were later returned. Under the
 * dated model the refund is subtracted as its own event in the period it was
 * booked, so filtering the sale out as well would remove it twice — and would
 * remove it from the period it was actually sold in, which is the retroactive
 * restatement this model exists to stop. A ticket sold today and fully
 * returned today nets to zero because both events land in today, not because
 * the sale was hidden.
 */
export function datedRevenueSaleConditions(tenantId: string): readonly SQL[] {
  return [sql`${sales.tenantId} = ${tenantId}`, sql`${sales.status} = 'completed'`];
}

/**
 * Daily revenue series as a UNION of dated events: each sale contributes its
 * total on the day it completed, each return contributes a NEGATIVE refund on
 * the day it was booked. Grouping the union by that date is what keeps a
 * refund out of the period its ticket was sold in.
 *
 * `orders` keeps its previous meaning on purpose: a fully returned ticket was
 * never counted and still is not. Only the MONEY moves to dated events; the
 * review comment was about revenue restating a closed period, not about
 * redefining throughput.
 *
 * Returns rows of { date, revenue, orders }, ascending by date. A day with
 * only refunds appears with negative revenue and zero orders, which is the
 * honest picture and something the previous per-sale correlation could not
 * represent at all.
 */
export function dailyDatedRevenueSql(tenantId: string, fromIso: string): SQL {
  return sql`
    select
      event_date as date,
      round(coalesce(sum(amount), 0), 2) as revenue,
      coalesce(sum(orders), 0) as orders
    from (
      select
        substr(coalesce(s.checkout_completed_at, s.created_at), 1, 10) as event_date,
        s.total as amount,
        case when s.return_state is null or s.return_state != 'refunded' then 1 else 0 end as orders
      from sales s
      where s.tenant_id = ${tenantId}
        and s.status = 'completed'
        and coalesce(s.checkout_completed_at, s.created_at) >= ${fromIso}
      union all
      select
        substr(sr.created_at, 1, 10) as event_date,
        -sr.refund_amount as amount,
        0 as orders
      from sale_returns sr
      join sales s2 on s2.id = sr.sale_id and s2.tenant_id = sr.tenant_id
      where sr.tenant_id = ${tenantId}
        and s2.status = 'completed'
        and sr.created_at >= ${fromIso}
    )
    group by event_date
    order by event_date asc
  `;
}
