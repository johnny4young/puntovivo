/**
 * ENG-065b — Inventory reports sub-router (`reports.inventory.*`).
 *
 * Tenant-wide read-only discrepancy view for the Operations Center
 * Inventory tab.
 *
 * **Structurally impossible post-unification (Auditoría 2026-07).** Stock
 * used to be maintained in two caches — the denormalized `products.stock`
 * total and the per-(site, product) `inventory_balances.on_hand`. Drift
 * between them was possible, and this view detected it. `products.stock`
 * has since been removed: `inventory_balances` is the single source of
 * truth and the tenant-wide total is derived from it on read, so there is
 * nothing left to drift against. `listInventoryDiscrepancyCandidates`
 * therefore always returns an empty set and this endpoint always reports
 * zero discrepancies. The procedure is retained (not deleted) because a
 * web client and tests still call it.
 *
 * Read-only — manager + admin gated. The (now no-op) reconcile mutation the
 * panel button fires is `inventory.reconcileBalances`.
 *
 * @module trpc/routers/reports/inventory
 */

import { roundQuantity } from '@puntovivo/shared/unit-math';
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
