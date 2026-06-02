/**
 * ENG-065b — Inventory reports sub-router (`reports.inventory.*`).
 *
 * Tenant-wide read-only discrepancy view for the Operations Center
 * Inventory tab.
 *
 * **What this surfaces.** The legacy data layer maintains two caches
 * for stock levels:
 *
 *   1. `products.stock` — the cached tenant-wide total per product.
 *      Sales mutations and inventory writers update it inline.
 *   2. `inventory_balances.on_hand` — the per-(site, product) cache
 *      driven by the same writers via `applyInventoryBalanceDelta`.
 *
 * Under normal operation the invariant `products.stock = Σ(inventory_balances.on_hand)`
 * holds for every product. Drift can sneak in via direct-DB edits,
 * historical data imports, or a non-atomic write path. The existing
 * `inventory.reconcileBalances` mutation HEALS the drift by recomputing
 * `products.stock` as `Σ(inventory_balances.on_hand)`. This sub-router
 * is the read-only mirror that DETECTS the drift before the operator
 * clicks the heal button — so the panel can show "5 products are
 * drifting" instead of forcing a blind reconcile.
 *
 * `inventory_movements` does NOT carry a `site_id` column (movements
 * are tenant + product scoped only); a Σ-of-movements vs balance
 * comparison would not catch site-level drift cleanly. The drift we
 * actually care about is the cache-vs-cache one above.
 *
 * **Architectural note.** The SQL aggregation lives in
 * `services/inventory-balances.ts::listInventoryDiscrepancyCandidates`
 * because the architectural lint (`__tests__/architectural-lint.test.ts`)
 * forbids `routers/reports/**` from importing `products` directly —
 * that rule protects the fiscal sub-router from accidentally joining
 * mutable source rows. The lint's documented escape hatch is "prefer
 * a service helper that takes an id list and does the join in a
 * non-reports module," which is exactly what we do here.
 *
 * Read-only — manager + admin gated. The reconcile mutation that the
 * panel button fires is `inventory.reconcileBalances` (already
 * shipped, admin-only).
 *
 * @module trpc/routers/reports/inventory
 */

import { router } from '../../init.js';
import { managerOrAdminProcedure } from '../../middleware/roles.js';
import { listInventoryDiscrepancyCandidates } from '../../../services/inventory-balances.js';
import { inventoryDiscrepanciesInput } from '../../schemas/reports.js';

/**
 * Floating-point epsilon for the `cachedStock - sumOfBalances` delta.
 * Anything strictly greater than this (in absolute value) is flagged
 * as a discrepancy. The 0.001 ceiling matches the precision of the
 * `quantity` `real` columns in the inventory writers.
 */
const INVENTORY_DELTA_EPSILON = 0.001;

function roundQuantity(value: number): number {
  return Math.round(value * 1000) / 1000;
}

export const inventoryReportsRouter = router({
  /**
   * Tenant-wide cache-vs-cache discrepancy scan.
   *
   * Returns:
   *   - `summary.productsScanned` — total products considered.
   *   - `summary.discrepancyCount` — products where
   *     `|cachedStock - sumOfBalances| > INVENTORY_DELTA_EPSILON`.
   *   - `rows` — the flagged products, ordered by `|delta|` desc and
   *     capped by `input.limit`. Each row carries enough context for
   *     the operator to act (or to file a follow-up bug if the drift
   *     correlates with a known sale path).
   */
  discrepancies: managerOrAdminProcedure
    .input(inventoryDiscrepanciesInput)
    .query(async ({ ctx, input }) => {
      const candidates = await listInventoryDiscrepancyCandidates(ctx.db, ctx.tenantId);

      const flagged = candidates
        .filter(row => Math.abs(row.delta) > INVENTORY_DELTA_EPSILON)
        .map(row => ({
          productId: row.productId,
          productName: row.productName,
          productSku: row.productSku,
          cachedStock: roundQuantity(row.cachedStock),
          sumOfBalances: roundQuantity(row.sumOfBalances),
          delta: roundQuantity(row.delta),
          siteCount: row.siteCount,
        }))
        .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));

      return {
        summary: {
          productsScanned: candidates.length,
          discrepancyCount: flagged.length,
          deltaEpsilon: INVENTORY_DELTA_EPSILON,
        },
        rows: flagged.slice(0, input.limit),
      };
    }),
});

export type InventoryReportsRouter = typeof inventoryReportsRouter;
