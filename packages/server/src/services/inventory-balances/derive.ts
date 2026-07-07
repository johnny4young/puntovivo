/**
 * Derived product stock totals (Auditoría 2026-07 — single source of truth).
 *
 * `inventory_balances` is the authoritative per-site stock. The tenant-wide
 * total for a product is `Σ(on_hand)` across its site balances — there is no
 * longer a denormalized `products.stock` column. These helpers centralize
 * that derivation:
 *
 * - `productStockTotalSql` — a correlated-subquery SQL fragment usable inside
 *   a `db.select({...})` so a product read can project its total without a
 *   GROUP BY on the outer query.
 * - `getProductStockTotal` / `getProductStockTotals` — direct reads for the
 *   write paths (adjust / entry / reversal) that need the current total to
 *   compute a delta or a movement's previous/new snapshot.
 *
 * @module services/inventory-balances/derive
 */

import { and, eq, inArray, sql } from 'drizzle-orm';
import type { DatabaseInstance } from '../../db/index.js';
import { inventoryBalances } from '../../db/schema.js';

/**
 * Correlated subquery: `Σ(inventory_balances.on_hand)` for the outer
 * `products` row, coalesced to 0. Use as a select field, e.g.
 * `db.select({ stock: productStockTotalSql })`.
 */
// NOTE: the correlated columns MUST be table-qualified. When drizzle
// interpolates a `Column` into a `sql` template it renders the bare column
// name (e.g. `"id"`), and because `inventory_balances` also has `id` /
// `tenant_id` columns, an unqualified `id` inside the subquery would bind to
// `inventory_balances.id` instead of the outer `products.id` — silently
// returning 0. We therefore spell the identifiers out, fully qualified.
export const productStockTotalSql = sql<number>`coalesce((select sum(inventory_balances.on_hand) from inventory_balances where inventory_balances.product_id = products.id and inventory_balances.tenant_id = products.tenant_id), 0)`;

/** The current tenant-wide total for a single product (0 when no balances). */
export function getProductStockTotal(
  db: DatabaseInstance,
  tenantId: string,
  productId: string
): number {
  const row = db
    .select({ total: sql<number>`coalesce(sum(${inventoryBalances.onHand}), 0)` })
    .from(inventoryBalances)
    .where(and(eq(inventoryBalances.tenantId, tenantId), eq(inventoryBalances.productId, productId)))
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
      productId: inventoryBalances.productId,
      total: sql<number>`coalesce(sum(${inventoryBalances.onHand}), 0)`,
    })
    .from(inventoryBalances)
    .where(
      and(
        eq(inventoryBalances.tenantId, tenantId),
        inArray(inventoryBalances.productId, productIds)
      )
    )
    .groupBy(inventoryBalances.productId)
    .all();
  for (const row of rows) {
    result.set(row.productId, row.total);
  }
  for (const id of productIds) {
    if (!result.has(id)) result.set(id, 0);
  }
  return result;
}
