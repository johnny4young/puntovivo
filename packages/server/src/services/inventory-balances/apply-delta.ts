import { and, eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import type { DatabaseInstance } from '../../db/index.js';
import { inventoryBalances, products } from '../../db/schema.js';
import { assertCatalogStockMutationAllowed } from '../products/lot-tracking.js';
import { getProductStockTotal } from './derive.js';
import { getPrimarySiteId, getTimestamp } from './helpers.js';

/**
 * Applies a signed delta (positive = credit, negative = debit) to the
 * (tenantId, siteId, productId) balance row inside an existing transaction.
 *
 * Phase 2 API-103 wires this into `sales.create` / `returnSale` / `void` so
 * the site's `inventory_balances` tracks real POS activity, not just
 * transfers.
 *
 * **Seeding contract.** When seeding a missing balance row, callers may pass
 * `initialOnHandIfMissing` as the opening `on_hand` for the row. When omitted,
 * the helper uses the primary-site migration rule (the product's current
 * derived total for the primary site, 0 for everyone else). Since
 * `inventory_balances` is now the single source of truth, that derived total
 * is 0 in practice for a product with no balances yet.
 *
 * Returns the final `onHand` value written to the row or `null` when the
 * call is a no-op.
 *
 * No-op cases:
 *   - `siteId` is falsy (legacy/pre-site sales) — returns `null`.
 *   - `delta` is 0 or not finite — returns `null`.
 *
 * Does NOT enforce non-negative balances; stock validation is the caller's
 * responsibility earlier in the pipeline.
 */
export function applyInventoryBalanceDelta(
  tx: DatabaseInstance,
  args: {
    tenantId: string;
    siteId: string | null | undefined;
    productId: string;
    delta: number;
    /**
     * Optional opening `on_hand` snapshot for seeding a missing row. When
     * omitted, the primary-site migration rule supplies the seed (the
     * product's derived total, which is 0 with no balances yet).
     */
    initialOnHandIfMissing?: number;
    now?: string;
  }
): number | null {
  if (!args.siteId) {
    return null;
  }
  if (!Number.isFinite(args.delta) || args.delta === 0) {
    return null;
  }

  // ENG-110b — re-check at the central mutation boundary. A sale or purchase
  // may resolve a standard product before a concurrent matrix conversion;
  // checking again inside the caller's transaction prevents that stale read
  // from restoring stock to the newly catalog-only parent.
  const product = tx
    .select({ catalogType: products.catalogType })
    .from(products)
    .where(and(eq(products.tenantId, args.tenantId), eq(products.id, args.productId)))
    .get();
  if (product) {
    assertCatalogStockMutationAllowed({
      catalogType: product.catalogType,
      delta: args.delta,
    });
  }

  const now = args.now ?? getTimestamp();

  // Resolve the seed value. Explicit caller snapshot wins; otherwise fall
  // back to the primary-site migration rule.
  let seedOnHand: number;
  if (args.initialOnHandIfMissing !== undefined) {
    seedOnHand = args.initialOnHandIfMissing;
  } else if (getPrimarySiteId(tx, args.tenantId) === args.siteId) {
    seedOnHand = getProductStockTotal(tx, args.tenantId, args.productId);
  } else {
    seedOnHand = 0;
  }

  tx.insert(inventoryBalances)
    .values({
      id: nanoid(),
      tenantId: args.tenantId,
      siteId: args.siteId,
      productId: args.productId,
      onHand: seedOnHand,
      reserved: 0,
      syncStatus: 'pending',
      syncVersion: 0,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoNothing({
      target: [inventoryBalances.tenantId, inventoryBalances.siteId, inventoryBalances.productId],
    })
    .run();

  const existing = tx
    .select({ onHand: inventoryBalances.onHand })
    .from(inventoryBalances)
    .where(
      and(
        eq(inventoryBalances.tenantId, args.tenantId),
        eq(inventoryBalances.siteId, args.siteId),
        eq(inventoryBalances.productId, args.productId)
      )
    )
    .get();

  const nextOnHand = (existing?.onHand ?? seedOnHand) + args.delta;

  tx.update(inventoryBalances)
    .set({
      onHand: nextOnHand,
      syncStatus: 'pending',
      updatedAt: now,
    })
    .where(
      and(
        eq(inventoryBalances.tenantId, args.tenantId),
        eq(inventoryBalances.siteId, args.siteId),
        eq(inventoryBalances.productId, args.productId)
      )
    )
    .run();

  // `inventory_balances` is the single source of truth; the tenant-wide total
  // is derived on read. There is no denormalized column to keep in lockstep,
  // so this simply returns the freshly-computed total for callers that use it.
  syncProductStockFromBalances(tx, {
    tenantId: args.tenantId,
    productId: args.productId,
    now,
  });

  return nextOnHand;
}

/**
 * Computes Σ(`inventory_balances.on_hand`) across all sites for the given
 * product and returns it. Formerly this persisted the value into the
 * denormalized `products.stock` column; that column has been removed and the
 * tenant-wide total is now derived on read, so this is a pure read — it writes
 * nothing. Retained (as a no-op writer) because `applyInventoryBalanceDelta`
 * calls it and callers may want the recomputed total.
 */
export function syncProductStockFromBalances(
  tx: DatabaseInstance,
  args: { tenantId: string; productId: string; now?: string }
): number {
  return getProductStockTotal(tx, args.tenantId, args.productId);
}
