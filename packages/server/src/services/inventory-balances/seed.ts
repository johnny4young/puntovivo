import { and, eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import type { DatabaseInstance } from '../../db/index.js';
import { inventoryBalances, products } from '../../db/schema.js';
import { getPrimarySiteId, getTimestamp } from './helpers.js';

/**
 * Service helpers for per-site inventory balances.
 *
 * `inventory_balances` is the single source of truth for stock (Auditoría
 * 2026-07). This helper lazily materializes a 0-on_hand row for any active
 * product that has no balance on `siteId` yet, so the per-site listing is
 * never dead. Actual opening quantities are written by the mutation paths
 * (product create seeding, entries, adjustments, transfers), never here.
 */

/**
 * Ensures every active product in the tenant has a balance row on `siteId`.
 *
 * Seed-only semantics: rows are only created when missing, always with an
 * initial `on_hand` of 0. Real quantities come from the mutation paths.
 *
 * **Not an upsert.** Once a balance row exists, it is owned by the
 * transfer-aware write paths (`transfers.create`, future `sales`/`purchases`
 * integrations). Re-seeding on every read would clobber those writes.
 *
 * Reads and writes run inside the same better-sqlite3 transaction so the
 * "which site is primary" and "which products exist" decisions are consistent
 * with the inserts.
 */
export function ensureInventoryBalancesForSite(
  db: DatabaseInstance,
  tenantId: string,
  siteId: string
): void {
  const now = getTimestamp();

  db.transaction(
    tx => {
      // service items (tracksStock=false) own no inventory: a
      // zero balance row would resurface them in per-site stock listings
      // and imply an inventory identity they do not have.
      const tenantProducts = tx
        .select({ id: products.id })
        .from(products)
        .where(
          and(
            eq(products.tenantId, tenantId),
            eq(products.isActive, true),
            eq(products.tracksStock, true)
          )
        )
        .all();

      if (tenantProducts.length === 0) {
        return;
      }

      // chunked multi-row insert. The previous per-product
      // `forEach` issued one INSERT per row, which on a 50k-product tenant
      // held the write lock for >1s during site onboarding. A single
      // `.values([...])` insert is one statement per chunk. 10 bound columns
      // per row, so 90 rows stays well under SQLITE_MAX_VARIABLE_NUMBER (999).
      // `onConflictDoNothing` preserves the seed-only contract: rows already
      // owned by the transfer-aware write paths are never clobbered.
      const CHUNK_SIZE = 90;
      const rows = tenantProducts.map(product => ({
        id: nanoid(),
        tenantId,
        siteId,
        productId: product.id,
        onHand: 0,
        reserved: 0,
        syncStatus: 'pending' as const,
        syncVersion: 0,
        createdAt: now,
        updatedAt: now,
      }));

      for (let offset = 0; offset < rows.length; offset += CHUNK_SIZE) {
        tx.insert(inventoryBalances)
          .values(rows.slice(offset, offset + CHUNK_SIZE))
          .onConflictDoNothing({
            target: [
              inventoryBalances.tenantId,
              inventoryBalances.siteId,
              inventoryBalances.productId,
            ],
          })
          .run();
      }
    },
    // Reserve SQLite's single writer before reading the product set. A
    // deferred transaction can lose the read-to-write upgrade race and throw
    // SQLITE_BUSY immediately, bypassing busy_timeout during a parallel sale.
    { behavior: 'immediate' }
  );
}

/**
 * Ensures the primary site has a balance row for `productId`, opening at zero.
 *
 * Called before stock moves at a NON-primary site, so the primary has a row to
 * carry its own writes later. It used to take the pre-delta tenant-wide total
 * as the opening quantity, from the pre-balances model where a tenant's whole
 * stock was implicitly held at the primary site.
 *
 * That is wrong since migration `0008`. `product_stock_totals` is now
 * maintained exclusively by triggers over `inventory_balances`, and `0008`
 * backfilled it as `SUM(on_hand)`, so `total ≡ Σ(on_hand)` has held ever
 * since. A primary site with no row therefore holds exactly zero: the whole
 * total is already accounted for by the other sites' rows. Opening it at the
 * tenant-wide total added every other site's stock to the primary a second
 * time — 11 physical units read back as 21.
 *
 * The rollup parity test cannot catch that, because the trigger recomputes the
 * total from the balances and `total ≡ Σ(on_hand)` still holds afterwards.
 * Only physical reality disagrees, which is why this needs its own test.
 *
 * Opening at zero is also what the module contract above already says: actual
 * opening quantities come from the mutation paths, never from a seeder. The
 * caller no longer passes a quantity at all, so no call site can reintroduce
 * one by passing the wrong aggregate.
 */
export function ensurePrimaryInventoryBalanceSnapshot(
  tx: DatabaseInstance,
  args: {
    tenantId: string;
    productId: string;
    now?: string;
  }
): string | null {
  const primarySiteId = getPrimarySiteId(tx, args.tenantId);
  if (!primarySiteId) {
    return null;
  }

  const now = args.now ?? getTimestamp();

  tx.insert(inventoryBalances)
    .values({
      id: nanoid(),
      tenantId: args.tenantId,
      siteId: primarySiteId,
      productId: args.productId,
      onHand: 0,
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

  return primarySiteId;
}
