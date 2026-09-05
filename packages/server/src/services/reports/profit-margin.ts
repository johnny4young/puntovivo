/**
 * Profit / margin report query.
 *
 * Surfaces realized gross margin by sourcing COGS from the per-lot ledger
 * (`sale_item_lots`) that Phase C.2 populates, falling back to the
 * `sale_items.cost_at_sale` snapshot for non-lot lines. It is the read side of
 * the "point margin/COGS reports at sale_item_lots" refinement in
 * `docs/INVENTORY-MODEL.md` §Phase C.
 *
 * Correctness notes baked into the query:
 * - Eligible sales use the SAME realized-revenue filter as
 * `dashboard.summary` (completed AND not fully refunded). Partial returns
 * subtract their frozen line revenue, base quantity, and exact return-cost
 * snapshot; the report never guesses from the current product catalog.
 * - Per line, COGS comes from the lot ledger when the line has ≥1 lot row
 * (the auditable per-lot cost), otherwise from
 * `cost_at_sale × normalized quantity`. `cost_at_sale` is the product's
 * base-unit cost snapshot, so packaging / case sales must include the
 * line's `unit_equivalence`.
 * Presence of lot rows is the history-faithful signal — a line sold
 * before `tracks_lots` was enabled has none.
 * - Every monetary intermediate + accumulation passes through `roundMoney`
 * (: uniform 2-decimal, half-away-from-zero).
 *
 * @module services/reports/profit-margin
 */

import { normalizedQuantity, roundQuantity } from '@puntovivo/shared/unit-math';
import { and, eq, gte, lte, sql } from 'drizzle-orm';
import type { DatabaseInstance } from '../../db/index.js';
import { products, saleItemLots, saleItems, sales } from '../../db/schema.js';
import { roundMoney } from '../../lib/money.js';
import {
  netSaleItemBaseQuantitySql,
  netSaleItemTotalSql,
  returnedSaleItemCostSql,
} from './net-sales.js';

/** Query parameters for {@link computeProfitMarginReport}. */
export interface ProfitMarginReportInput {
  /** Tenant scope — every row is filtered by this. */
  tenantId: string;
  /** Inclusive lower bound on `sales.created_at` (ISO 8601). */
  fromDate: string;
  /** Inclusive upper bound on `sales.created_at` (ISO 8601). */
  toDate: string;
  /** Max product rows returned, ordered by gross profit descending. */
  limit: number;
}

/**
 * One product's aggregated performance over the range. `revenue`, `cogs`, and
 * `grossProfit` are 2-decimal money; `quantity` is base units sold (3-decimal);
 * `grossMarginPct` is `grossProfit / revenue × 100` (0 when revenue ≤ 0).
 */
export interface ProfitMarginProductRow {
  productId: string;
  name: string;
  sku: string;
  quantity: number;
  revenue: number;
  cogs: number;
  grossProfit: number;
  grossMarginPct: number;
}

/**
 * Range-wide totals. `cogsFromLots` + `cogsFromSnapshot` = `cogs`; the split
 * makes the per-lot ledger's contribution visible against the legacy snapshot
 * cost. `salesCount` is distinct eligible sales; `lineCount` is eligible
 * sale-item lines.
 */
export interface ProfitMarginReportSummary {
  revenue: number;
  cogs: number;
  cogsFromLots: number;
  cogsFromSnapshot: number;
  grossProfit: number;
  grossMarginPct: number;
  salesCount: number;
  lineCount: number;
}

/** Full report payload: range-wide summary + per-product breakdown. */
export interface ProfitMarginReport {
  summary: ProfitMarginReportSummary;
  products: ProfitMarginProductRow[];
}

/** Gross margin percentage, guarding the revenue ≤ 0 (incl. divide-by-zero) case. */
function marginPct(grossProfit: number, revenue: number): number {
  if (revenue <= 0) return 0;
  return roundMoney((grossProfit / revenue) * 100);
}

/**
 * Compute the profit/margin report for a tenant over a date range. Pure read —
 * no writes, no side effects. Runs two set-based queries (eligible lines, then
 * lot COGS grouped by sale item) and merges them in JS by `saleItemId`, which
 * sidesteps the correlated-subquery column-qualification footgun.
 */
export function computeProfitMarginReport(
  db: DatabaseInstance,
  input: ProfitMarginReportInput
): ProfitMarginReport {
  const { tenantId, fromDate, toDate, limit } = input;
  const netBaseQuantity = netSaleItemBaseQuantitySql(tenantId);
  const netLineTotal = netSaleItemTotalSql(tenantId);
  const returnedLineCost = returnedSaleItemCostSql(tenantId);

  const eligibleSaleConditions = and(
    eq(sales.tenantId, tenantId),
    eq(sales.status, 'completed'),
    sql`(${sales.returnState} is null or ${sales.returnState} != 'refunded')`,
    gte(sales.createdAt, fromDate),
    lte(sales.createdAt, toDate)
  );

  const lines = db
    .select({
      saleItemId: saleItems.id,
      saleId: saleItems.saleId,
      productId: saleItems.productId,
      name: products.name,
      sku: products.sku,
      originalQuantity: saleItems.quantity,
      unitEquivalence: saleItems.unitEquivalence,
      baseQuantity: netBaseQuantity,
      revenue: netLineTotal,
      costAtSale: saleItems.costAtSale,
      returnedCost: returnedLineCost,
    })
    .from(saleItems)
    .innerJoin(sales, and(eq(saleItems.saleId, sales.id), eq(sales.tenantId, tenantId)))
    .innerJoin(products, and(eq(saleItems.productId, products.id), eq(products.tenantId, tenantId)))
    .where(eligibleSaleConditions)
    .all();

  // Per-line lot COGS from the ledger, restricted to the same eligible sales.
  // Fully-qualified column names: `sale_item_lots` AND `sale_items` both have a
  // `quantity` column, so an unqualified `quantity` here would bind ambiguously
  // (handoff gotcha #1 — see services/inventory-balances/derive.ts).
  const lotRows = db
    .select({
      saleItemId: saleItemLots.saleItemId,
      lotCost: sql<number>`coalesce(sum(sale_item_lots.quantity * sale_item_lots.unit_cost), 0)`,
    })
    .from(saleItemLots)
    .innerJoin(saleItems, eq(saleItemLots.saleItemId, saleItems.id))
    .innerJoin(sales, and(eq(saleItems.saleId, sales.id), eq(sales.tenantId, tenantId)))
    .where(
      and(eq(saleItemLots.tenantId, tenantId), eq(sales.tenantId, tenantId), eligibleSaleConditions)
    )
    .groupBy(saleItemLots.saleItemId)
    .all();

  const lotCostByItem = new Map<string, number>();
  for (const row of lotRows) lotCostByItem.set(row.saleItemId, row.lotCost);

  const perProduct = new Map<string, ProfitMarginProductRow>();
  const saleIds = new Set<string>();
  let totalRevenue = 0;
  let totalCogsFromLots = 0;
  let totalCogsFromSnapshot = 0;
  let remainingLineCount = 0;

  for (const line of lines) {
    const lineRevenue = roundMoney(line.revenue);
    const baseQuantity = roundQuantity(line.baseQuantity);
    if (baseQuantity <= 0) continue;
    saleIds.add(line.saleId);
    remainingLineCount += 1;
    const hasLots = lotCostByItem.has(line.saleItemId);
    const originalBaseQuantity = roundQuantity(
      normalizedQuantity(line.originalQuantity, line.unitEquivalence)
    );
    const originalCogs = hasLots
      ? roundMoney(lotCostByItem.get(line.saleItemId) ?? 0)
      : roundMoney(line.costAtSale * originalBaseQuantity);
    const lineCogs = roundMoney(Math.max(0, originalCogs - line.returnedCost));

    totalRevenue = roundMoney(totalRevenue + lineRevenue);
    if (hasLots) {
      totalCogsFromLots = roundMoney(totalCogsFromLots + lineCogs);
    } else {
      totalCogsFromSnapshot = roundMoney(totalCogsFromSnapshot + lineCogs);
    }

    const existing = perProduct.get(line.productId);
    if (existing) {
      existing.quantity = roundQuantity(existing.quantity + baseQuantity);
      existing.revenue = roundMoney(existing.revenue + lineRevenue);
      existing.cogs = roundMoney(existing.cogs + lineCogs);
    } else {
      perProduct.set(line.productId, {
        productId: line.productId,
        name: line.name,
        sku: line.sku,
        quantity: baseQuantity,
        revenue: lineRevenue,
        cogs: lineCogs,
        grossProfit: 0,
        grossMarginPct: 0,
      });
    }
  }

  const productRows = [...perProduct.values()].map(row => {
    const grossProfit = roundMoney(row.revenue - row.cogs);
    return { ...row, grossProfit, grossMarginPct: marginPct(grossProfit, row.revenue) };
  });
  productRows.sort((a, b) => b.grossProfit - a.grossProfit || a.name.localeCompare(b.name));

  const totalCogs = roundMoney(totalCogsFromLots + totalCogsFromSnapshot);
  const grossProfit = roundMoney(totalRevenue - totalCogs);

  return {
    summary: {
      revenue: totalRevenue,
      cogs: totalCogs,
      cogsFromLots: totalCogsFromLots,
      cogsFromSnapshot: totalCogsFromSnapshot,
      grossProfit,
      grossMarginPct: marginPct(grossProfit, totalRevenue),
      salesCount: saleIds.size,
      lineCount: remainingLineCount,
    },
    products: productRows.slice(0, limit),
  };
}
