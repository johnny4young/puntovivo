/**
 * Derived product stock totals (Auditoría 2026-07 — single source of truth;
 * ENG-197 — materialized rollup).
 *
 * `inventory_balances` is the authoritative per-site stock. The tenant-wide
 * total for a product is `Σ(on_hand)` across its site balances — there is no
 * longer a denormalized `products.stock` column. Since ENG-197 that sum is
 * MATERIALIZED into `product_stock_totals`, maintained exclusively by the
 * SQLite triggers of migration 0008 (every insert/update/delete of a balance
 * row upserts the rollup in the same transaction), so these helpers read a
 * PK point-lookup instead of scanning and summing the balances per product:
 *
 * - `productStockTotalSql` — a scalar-subquery SQL fragment usable inside a
 *   `db.select({...})` so a product read can project its total without a
 *   GROUP BY on the outer query.
 * - `getProductStockTotal` / `getProductStockTotals` — direct reads for the
 *   write paths (adjust / entry / reversal) that need the current total to
 *   compute a delta or a movement's previous/new snapshot.
 *
 * The API of all three predates the rollup — readers did not change when the
 * implementation swapped. Parity rollup ≡ Σ(balances) is pinned by
 * `inventory-stock-rollup.test.ts`.
 *
 * @module services/inventory-balances/derive
 */

import { and, eq, inArray, sql } from 'drizzle-orm';
import type { DatabaseInstance } from '../../db/index.js';
import { productStockTotals } from '../../db/schema.js';

/**
 * Scalar subquery: the materialized total for the outer `products` row,
 * coalesced to 0. The COALESCE covers products whose balances were never
 * touched (no rollup row yet); note the inverse does NOT hold — the triggers
 * create a rollup row even for an on_hand=0 insert, and deleting the last
 * balance row leaves a total=0 rollup row behind (the delete trigger
 * subtracts, it does not delete). Both shapes read as 0 either way. Use as
 * a select field, e.g. `db.select({ stock: productStockTotalSql })`.
 */
// NOTE: the correlated columns MUST be table-qualified. When drizzle
// interpolates a `Column` into a `sql` template it renders the bare column
// name (e.g. `"id"`), and because `product_stock_totals` also has a
// `tenant_id` column, an unqualified identifier inside the subquery would
// bind to the wrong table — silently returning 0. We therefore spell the
// identifiers out, fully qualified. The (tenant_id, product_id) predicate is
// the rollup's PRIMARY KEY, so this is an O(1) index point-lookup per row
// instead of the pre-ENG-197 scan-and-sum over inventory_balances.
export const productStockTotalSql = sql<number>`coalesce((select product_stock_totals.total from product_stock_totals where product_stock_totals.product_id = products.id and product_stock_totals.tenant_id = products.tenant_id), 0)`;

/** The current tenant-wide total for a single product (0 when no balances). */
export function getProductStockTotal(
  db: DatabaseInstance,
  tenantId: string,
  productId: string
): number {
  const row = db
    .select({ total: productStockTotals.total })
    .from(productStockTotals)
    .where(
      and(eq(productStockTotals.tenantId, tenantId), eq(productStockTotals.productId, productId))
    )
    .get();
  return row?.total ?? 0;
}

/** Batch variant: a Map of productId → total (missing products default to 0). */
export function getProductStockTotals(
  db: DatabaseInstance,
  tenantId: string,
  productIds: string[]
): Map<string, number> {
  const result = new Map<string, number>();
  if (productIds.length === 0) {
    return result;
  }
  const rows = db
    .select({
      productId: productStockTotals.productId,
      total: productStockTotals.total,
    })
    .from(productStockTotals)
    .where(
      and(
        eq(productStockTotals.tenantId, tenantId),
        inArray(productStockTotals.productId, productIds)
      )
    )
    .all();
  for (const row of rows) {
    result.set(row.productId, row.total);
  }
  for (const id of productIds) {
    if (!result.has(id)) result.set(id, 0);
  }
  return result;
}
