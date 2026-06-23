import { and, eq, sql } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import type { DatabaseInstance } from '../../db/index.js';
import { inventoryBalances, products } from '../../db/schema.js';
import { getPrimarySiteId, getTimestamp } from './helpers.js';

/**
 * Applies a signed delta (positive = credit, negative = debit) to the
 * (tenantId, siteId, productId) balance row inside an existing transaction.
 *
 * Phase 2 API-103 wires this into `sales.create` / `returnSale` / `void` so
 * the site's `inventory_balances` tracks real POS activity, not just
 * transfers.
 *
 * **Seeding contract.** Callers that touch `products.stock` in the same
 * transaction must pass `initialOnHandIfMissing` as the PRE-delta stock
 * snapshot they captured before mutating it. Without that, seeding would
 * read `products.stock` after the caller's update and apply the delta on
 * top of an already-decremented value (double-count). When
 * `initialOnHandIfMissing` is omitted, the helper uses the primary-site
 * migration rule (current `products.stock` for the primary site, 0 for
 * everyone else) — safe for callers that do NOT mutate `products.stock`.
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
     * Optional pre-delta `on_hand` snapshot for seeding a missing row. Use
     * this when the caller is mutating `products.stock` in the same
     * transaction — otherwise the default seed would read the post-mutation
     * value and the delta would double-count.
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

  const now = args.now ?? getTimestamp();

  // Resolve the seed value. Explicit caller snapshot wins; otherwise fall
  // back to the primary-site migration rule.
  let seedOnHand: number;
  if (args.initialOnHandIfMissing !== undefined) {
    seedOnHand = args.initialOnHandIfMissing;
  } else if (getPrimarySiteId(tx, args.tenantId) === args.siteId) {
    const productStock = tx
      .select({ stock: products.stock })
      .from(products)
      .where(and(eq(products.tenantId, args.tenantId), eq(products.id, args.productId)))
      .get();
    seedOnHand = productStock?.stock ?? 0;
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

  // Phase 2 API-103 step 4: keep `products.stock` as a derived cache equal
  // to the sum of all site balances for this product. Callers that also
  // write `products.stock` directly in the same transaction see their value
  // ratified (or corrected) by this write, eliminating drift under per-site
  // adjustments.
  syncProductStockFromBalances(tx, {
    tenantId: args.tenantId,
    productId: args.productId,
    now,
  });

  return nextOnHand;
}

/**
 * Recomputes `products.stock` as Σ(`inventory_balances.on_hand`) across all
 * sites for the given product, then persists the result. Idempotent and safe
 * to call repeatedly inside a transaction.
 *
 * Used internally by `applyInventoryBalanceDelta` after every balance
 * mutation so the legacy tenant-wide `products.stock` field never diverges
 * from the per-site balance table. External callers rarely need this — reach
 * for `reconcileProductStockFromBalances` instead when healing historical
 * drift for many products at once.
 */
export function syncProductStockFromBalances(
  tx: DatabaseInstance,
  args: { tenantId: string; productId: string; now?: string }
): number {
  const aggregate = tx
    .select({
      total: sql<number>`coalesce(sum(${inventoryBalances.onHand}), 0)`,
    })
    .from(inventoryBalances)
    .where(
      and(
        eq(inventoryBalances.tenantId, args.tenantId),
        eq(inventoryBalances.productId, args.productId)
      )
    )
    .get();
  const nextStock = aggregate?.total ?? 0;
  const now = args.now ?? getTimestamp();

  tx.update(products)
    .set({
      stock: nextStock,
      syncStatus: 'pending',
      updatedAt: now,
    })
    .where(and(eq(products.tenantId, args.tenantId), eq(products.id, args.productId)))
    .run();

  return nextStock;
}
