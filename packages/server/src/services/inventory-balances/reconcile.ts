import { eq } from 'drizzle-orm';
import type { DatabaseInstance } from '../../db/index.js';
import { products } from '../../db/schema.js';
import { getTimestamp } from './helpers.js';
import { syncProductStockFromBalances } from './apply-delta.js';

/**
 * Heals historical drift by recomputing `products.stock` for every product
 * in the tenant as Σ(inventory_balances.on_hand). Intended as an
 * admin-triggered reconciliation after migrations or data imports; inside
 * normal mutation paths, `applyInventoryBalanceDelta` already keeps the
 * cache in lockstep.
 */
export function reconcileProductStockFromBalances(
  db: DatabaseInstance,
  tenantId: string
): { productsUpdated: number } {
  const now = getTimestamp();

  return db.transaction(tx => {
    const tenantProducts = tx
      .select({ id: products.id })
      .from(products)
      .where(eq(products.tenantId, tenantId))
      .all();

    for (const product of tenantProducts) {
      syncProductStockFromBalances(tx, {
        tenantId,
        productId: product.id,
        now,
      });
    }

    return { productsUpdated: tenantProducts.length };
  });
}
