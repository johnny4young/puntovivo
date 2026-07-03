import type { DatabaseInstance } from '../../db/index.js';

/**
 * Reconciliation of the denormalized `products.stock` cache, retired by the
 * single-source unification (Auditoría 2026-07).
 *
 * The `products.stock` column has been removed: `inventory_balances` is the
 * single source of truth and the tenant-wide total is derived from it on read.
 * There is no cache to recompute, so this is a no-op that always reports zero
 * products updated. Retained (rather than deleted) because the
 * `inventory.reconcileBalances` router procedure and its tests still call it.
 */
export function reconcileProductStockFromBalances(
  _db: DatabaseInstance,
  _tenantId: string
): { productsUpdated: number } {
  return { productsUpdated: 0 };
}
