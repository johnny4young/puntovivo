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
 * - Sales belong to their checkout date; returns belong to their own date.
 * Opening/closing positions use only the frozen evidence available at each
 * boundary, so a later refund cannot restate a closed period. Return-only
 * periods can have negative revenue, quantity and COGS.
 * - Product revenue excludes frozen taxes and the unreturned ticket discount
 * (allocated in cumulative rounded cents). Tips/service charges remain outside
 * product margin; cash/ticket totals deliberately retain collected amounts.
 * - Adopted lines use frozen cogs_cost_cents, including known zero. For
 * legacy lines, COGS comes from the lot ledger when the line has ≥1 lot row
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
import { and, asc, eq, lte, sql } from 'drizzle-orm';
import type { DatabaseInstance } from '../../db/index.js';
import {
  products,
  saleItemLots,
  saleItems,
  saleReturnItems,
  saleReturns,
  sales,
} from '../../db/schema.js';
import { roundMoney } from '../../lib/money.js';

/** Query parameters for {@link computeProfitMarginReport}. */
export interface ProfitMarginReportInput {
  /** Tenant scope — every row is filtered by this. */
  tenantId: string;
  /** Inclusive lower bound on checkout/return event time (ISO 8601). */
  fromDate: string;
  /** Inclusive upper bound on checkout/return event time (ISO 8601). */
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
 * cost. Counts retain the net-throughput meaning: sales completed inside the
 * window with remaining quantity at its end, and their remaining lines.
 * Returns of older sales affect money/quantity, but do not create new sales.
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
 * no writes, no side effects. Three set-based queries load affected sale
 * lines, their lot costs, and dated frozen returns. Subtracting opening from
 * closing positions preserves the existing per-ticket discount allocation,
 * including its final cent, without moving refunds back to the sale date.
 */
export function computeProfitMarginReport(
  db: DatabaseInstance,
  input: ProfitMarginReportInput
): ProfitMarginReport {
  // A peer connection can commit a void/return between these SELECTs. Pin a
  // WAL read snapshot without reserving the writer, so line eligibility,
  // frozen costs and returns can never describe different committed states.
  return db.transaction(tx => readProfitMarginSnapshot(tx, input), { behavior: 'deferred' });
}

function readProfitMarginSnapshot(
  db: Pick<DatabaseInstance, 'select'>,
  input: ProfitMarginReportInput
): ProfitMarginReport {
  const { tenantId, fromDate, toDate, limit } = input;
  const completedAt = sql<string>`coalesce(${sales.checkoutCompletedAt}, ${sales.createdAt})`;
  const eligibleSaleConditions = and(
    eq(sales.tenantId, tenantId),
    eq(sales.status, 'completed'),
    lte(completedAt, toDate),
    // A return in this period may refer to a ticket completed years earlier.
    // Its sale remains eligible even after becoming fully refunded.
    sql`(${completedAt} >= ${fromDate} or exists (
      select 1 from sale_returns dated_return
      where dated_return.tenant_id = ${tenantId}
        and dated_return.sale_id = ${sales.id}
        and dated_return.created_at >= ${fromDate}
        and dated_return.created_at <= ${toDate}
    ))`
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
      total: saleItems.total,
      taxAmount: saleItems.taxAmount,
      discountAmount: sales.discountAmount,
      completedAt,
      costAtSale: saleItems.costAtSale,
      cogsCostCents: saleItems.cogsCostCents,
    })
    .from(saleItems)
    .innerJoin(sales, and(eq(saleItems.saleId, sales.id), eq(sales.tenantId, tenantId)))
    .innerJoin(products, and(eq(saleItems.productId, products.id), eq(products.tenantId, tenantId)))
    .where(eligibleSaleConditions)
    .orderBy(asc(sales.id), asc(saleItems.id))
    .all();

  // Per-line lot COGS from the ledger, restricted to the same eligible sales.
  // Fully-qualified column names: `sale_item_lots` AND `sale_items` both have a
  // `quantity` column, so an unqualified `quantity` here would bind ambiguously
  // (handoff gotcha #1 — see services/inventory-balances/derive.ts).
  const lotRows = db
    .select({
      saleItemId: saleItemLots.saleItemId,
      lotCost: sql<number>`coalesce(sum(coalesce(sale_item_lots.total_cost_cents / 100.0, sale_item_lots.quantity * sale_item_lots.unit_cost)), 0)`,
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

  const returns = db
    .select({
      id: saleReturns.id,
      saleId: saleReturns.saleId,
      saleItemId: saleReturnItems.saleItemId,
      createdAt: saleReturns.createdAt,
      discountAmount: saleReturns.discountAmount,
      baseQuantity: saleReturnItems.baseQuantity,
      total: saleReturnItems.total,
      taxAmount: saleReturnItems.taxAmount,
      costAmount: saleReturnItems.costAmount,
    })
    .from(saleReturnItems)
    .innerJoin(
      saleReturns,
      and(eq(saleReturnItems.saleReturnId, saleReturns.id), eq(saleReturns.tenantId, tenantId))
    )
    .innerJoin(
      saleItems,
      and(
        eq(saleReturnItems.saleItemId, saleItems.id),
        eq(saleItems.saleId, saleReturns.saleId),
        eq(saleItems.productId, saleReturnItems.productId)
      )
    )
    .innerJoin(sales, and(eq(saleReturns.saleId, sales.id), eq(sales.tenantId, tenantId)))
    .where(
      and(
        eq(saleReturnItems.tenantId, tenantId),
        lte(saleReturns.createdAt, toDate),
        eligibleSaleConditions
      )
    )
    .all();

  type Position = { quantity: number; gross: number; revenue: number; cogs: number };
  const positions = new Map<string, { opening: Position; closing: Position }>();
  const tickets = new Map<
    string,
    { lines: typeof lines; openingDiscount: number; closingDiscount: number }
  >();
  for (const line of lines) {
    const quantity = roundQuantity(normalizedQuantity(line.originalQuantity, line.unitEquivalence));
    const closing = {
      quantity,
      gross: line.total,
      revenue: roundMoney(line.total - line.taxAmount),
      cogs:
        line.cogsCostCents !== null
          ? line.cogsCostCents / 100
          : lotCostByItem.has(line.saleItemId)
            ? roundMoney(lotCostByItem.get(line.saleItemId) ?? 0)
            : roundMoney(line.costAtSale * quantity),
    };
    const existedAtOpening = line.completedAt < fromDate;
    positions.set(line.saleItemId, {
      opening: existedAtOpening ? { ...closing } : { quantity: 0, gross: 0, revenue: 0, cogs: 0 },
      closing,
    });
    const ticket = tickets.get(line.saleId);
    if (ticket) ticket.lines.push(line);
    else
      tickets.set(line.saleId, {
        lines: [line],
        openingDiscount: existedAtOpening ? (line.discountAmount ?? 0) : 0,
        closingDiscount: line.discountAmount ?? 0,
      });
  }

  const seenReturns = new Set<string>();
  for (const returned of returns) {
    const position = positions.get(returned.saleItemId);
    const ticket = tickets.get(returned.saleId);
    if (!position || !ticket) continue;
    const subtract = (value: Position) => {
      value.quantity = roundQuantity(value.quantity - returned.baseQuantity);
      value.gross = roundMoney(value.gross - returned.total);
      value.revenue = roundMoney(value.revenue - roundMoney(returned.total - returned.taxAmount));
      value.cogs = roundMoney(value.cogs - returned.costAmount);
    };
    subtract(position.closing);
    if (returned.createdAt < fromDate) subtract(position.opening);
    // The header is repeated in the joined rows; allocate its discount once,
    // not once per returned product.
    if (!seenReturns.has(returned.id)) {
      seenReturns.add(returned.id);
      ticket.closingDiscount = roundMoney(ticket.closingDiscount - returned.discountAmount);
      if (returned.createdAt < fromDate)
        ticket.openingDiscount = roundMoney(ticket.openingDiscount - returned.discountAmount);
    }
  }

  for (const ticket of tickets.values()) {
    for (const boundary of ['opening', 'closing'] as const) {
      const discount = boundary === 'opening' ? ticket.openingDiscount : ticket.closingDiscount;
      const gross = ticket.lines.reduce(
        (sum, line) => roundMoney(sum + (positions.get(line.saleItemId)?.[boundary].gross ?? 0)),
        0
      );
      let cumulativeGross = 0;
      let allocatedDiscount = 0;
      // Stable sale-line order and cumulative rounded boundaries conserve
      // every header-discount cent, including across separate return periods.
      for (const line of ticket.lines) {
        const position = positions.get(line.saleItemId)?.[boundary];
        if (!position) continue;
        cumulativeGross = roundMoney(cumulativeGross + position.gross);
        const targetDiscount = gross > 0 ? roundMoney((discount * cumulativeGross) / gross) : 0;
        position.revenue = roundMoney(
          position.revenue - roundMoney(targetDiscount - allocatedDiscount)
        );
        allocatedDiscount = targetDiscount;
      }
    }
  }

  const perProduct = new Map<string, ProfitMarginProductRow>();
  const saleIds = new Set<string>();
  let totalRevenue = 0;
  let totalCogsFromLots = 0;
  let totalCogsFromSnapshot = 0;
  let remainingLineCount = 0;

  for (const line of lines) {
    const position = positions.get(line.saleItemId);
    if (!position) continue;
    const lineRevenue = roundMoney(position.closing.revenue - position.opening.revenue);
    const baseQuantity = roundQuantity(position.closing.quantity - position.opening.quantity);
    if (line.completedAt >= fromDate && position.closing.quantity > 0) {
      saleIds.add(line.saleId);
      remainingLineCount += 1;
    }
    const hasLots = lotCostByItem.has(line.saleItemId);
    const lineCogs = roundMoney(position.closing.cogs - position.opening.cogs);

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

  const productRows = [...perProduct.values()]
    .filter(row => row.quantity !== 0 || row.revenue !== 0 || row.cogs !== 0)
    .map(row => {
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
