/**
 * ENG-190 — Profit / margin report query.
 *
 * Surfaces realized gross margin by sourcing COGS from the per-lot ledger
 * (`sale_item_lots`) that Phase C.2 populates, falling back to the
 * `sale_items.cost_at_sale` snapshot for non-lot lines. It is the read side of
 * the "point margin/COGS reports at sale_item_lots" refinement in
 * `docs/INVENTORY-MODEL.md` §Phase C.
 *
 * Correctness notes baked into the query:
 *   - Eligible sales use the SAME realized-revenue filter as
 *     `dashboard.summary` (completed AND not refunded) so revenue is
 *     consistent across surfaces. A refunded sale keeps `status='completed'`
 *     (returnSale only flips `paymentStatus`) but has its `sale_item_lots`
 *     rows deleted by `restoreLotsForSale`; excluding it here is what stops
 *     its COGS from collapsing to 0 while its revenue still counts.
 *   - Per line, COGS comes from the lot ledger when the line has ≥1 lot row
 *     (the auditable per-lot cost), otherwise from `cost_at_sale × quantity`.
 *     Presence of lot rows is the history-faithful signal — a line sold
 *     before `tracks_lots` was enabled has none.
 *   - Every monetary intermediate + accumulation passes through `roundMoney`
 *     (ENG-176a: uniform 2-decimal, half-away-from-zero).
 *
 * @module services/reports/profit-margin
 */

import { and, eq, gte, lte, sql } from 'drizzle-orm';
import type { DatabaseInstance } from '../../db/index.js';
import { products, saleItemLots, saleItems, sales } from '../../db/schema.js';
import { roundMoney } from '../../lib/money.js';

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

/** Quantities are not money; round to 3 decimals like the inventory reports. */
function roundQuantity(value: number): number {
  return Math.round(value * 1000) / 1000;
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

  const eligibleSaleConditions = and(
    eq(sales.tenantId, tenantId),
    eq(sales.status, 'completed'),
    sql`${sales.paymentStatus} != 'refunded'`,
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
      quantity: saleItems.quantity,
      unitEquivalence: saleItems.unitEquivalence,
      revenue: saleItems.total,
      costAtSale: saleItems.costAtSale,
    })
    .from(saleItems)
    .innerJoin(sales, eq(saleItems.saleId, sales.id))
    .innerJoin(products, eq(saleItems.productId, products.id))
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
    .innerJoin(sales, eq(saleItems.saleId, sales.id))
    .where(and(eq(saleItemLots.tenantId, tenantId), eligibleSaleConditions))
    .groupBy(saleItemLots.saleItemId)
    .all();

  const lotCostByItem = new Map<string, number>();
  for (const row of lotRows) lotCostByItem.set(row.saleItemId, row.lotCost);

  const perProduct = new Map<string, ProfitMarginProductRow>();
  const saleIds = new Set<string>();
  let totalRevenue = 0;
  let totalCogsFromLots = 0;
  let totalCogsFromSnapshot = 0;

  for (const line of lines) {
    saleIds.add(line.saleId);
    const lineRevenue = roundMoney(line.revenue);
    const baseQuantity = roundQuantity(line.quantity * line.unitEquivalence);
    const hasLots = lotCostByItem.has(line.saleItemId);
    const lineCogs = hasLots
      ? roundMoney(lotCostByItem.get(line.saleItemId) ?? 0)
      : roundMoney(line.costAtSale * line.quantity);

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
      lineCount: lines.length,
    },
    products: productRows.slice(0, limit),
  };
}
