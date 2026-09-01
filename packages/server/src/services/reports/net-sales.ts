/**
 * Frozen-return-aware SQL expressions for current realized sales reads.
 *
 * These helpers deliberately subtract immutable sale-return snapshots, never
 * live catalog values. They are correlated through indexed identifiers and
 * tenant-scoped inside each subquery so a dashboard/report cannot overstate a
 * partially returned ticket or cross a tenant boundary.
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
