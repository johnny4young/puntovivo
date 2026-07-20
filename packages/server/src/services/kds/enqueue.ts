/**
 * `enqueueKdsOrder` hook.
 *
 * Best-effort post-tx call invoked from `sales.suspend`,
 * `completeSale`, and `sales.splitDraft` (for the carved-out split).
 * Creates one `kds_orders` row per (sale, station) pair, snapshotting
 * the current `sale_items` into `items_json` so the kitchen sees a
 * frozen view of what was ordered.
 *
 * Idempotency comes from the UNIQUE(tenant_id, sale_id, station)
 * index — both the suspend and complete hook can fire for the same
 * sale and only the first one persists a row. Subsequent fires are
 * a no-op at the DB level and skip the SSE broadcast so two cooks
 * watching the board don't see a phantom flash.
 *
 * Skips silently when:
 * - the sale has no `tableId` (regular retail POS path)
 * - the `kds` module is not active for the tenant
 * - the sale row has no items (synthetic / empty cart)
 *
 * Errors are logged and swallowed — the caller already committed
 * the sale; failing the response over a kitchen-display side-effect
 * is the wrong trade.
 *
 * @module services/kds/enqueue
 */

import { and, eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import {
  kdsOrders,
  products,
  restaurantTables,
  saleItems,
  sales,
  type NewKdsOrderRow,
} from '../../db/schema.js';
import { createModuleLogger } from '../../logging/logger.js';
import { isModuleActiveForTenant } from '../../trpc/middleware/modules.js';
import type { KdsHookContext, KdsItemSnapshot } from './types.js';

const log = createModuleLogger('kds');

export interface EnqueueKdsOrderArgs {
  ctx: KdsHookContext;
  saleId: string;
  /**
   * When the caller already knows the table_id is set on the sale
   * (e.g. `splitDraft` just inserted a fresh draft) it can short-
   * circuit the re-read by passing the row. Optional; the helper
   * loads the sale itself when omitted.
   */
  saleSnapshot?: {
    saleNumber: string;
    siteId: string;
    tableId: string | null;
    tableLabel: string | null;
    notes: string | null;
  } | null;
}

export async function enqueueKdsOrder(args: EnqueueKdsOrderArgs): Promise<void> {
  const { ctx, saleId } = args;
  try {
    const moduleActive = await isModuleActiveForTenant(ctx.db, ctx.tenantId, 'kds');
    if (!moduleActive) return;

    const saleRow = args.saleSnapshot
      ? args.saleSnapshot
      : await loadSaleSnapshot(ctx.db, ctx.tenantId, saleId);
    if (!saleRow) return;
    if (!saleRow.tableId) return;
    if (!saleRow.siteId) return;

    const items = await loadItemSnapshots(ctx.db, saleId);
    if (items.length === 0) return;

    // v1: pool everything into a single 'main' station. The schema
    // already supports per-station rows (UNIQUE includes `station`)
    // so a future product-level `station` field can fan items out
    // into multiple kds_orders rows without rewriting the helper.
    const station = 'main';
    const now = new Date().toISOString();
    const row: NewKdsOrderRow = {
      id: nanoid(),
      tenantId: ctx.tenantId,
      siteId: saleRow.siteId,
      saleId,
      tableId: saleRow.tableId,
      tableLabel: saleRow.tableLabel,
      saleNumber: saleRow.saleNumber,
      station,
      itemsJson: JSON.stringify(items),
      notes: saleRow.notes,
      status: 'pending',
      createdAt: now,
      readyAt: null,
      readyByUserId: null,
      updatedAt: now,
    };

    const inserted = ctx.db
      .insert(kdsOrders)
      .values(row)
      .onConflictDoNothing({
        target: [kdsOrders.tenantId, kdsOrders.saleId, kdsOrders.station],
      })
      .run();

    // better-sqlite3 returns `changes: 0` when ON CONFLICT skipped.
    const changed =
      typeof (inserted as { changes?: number }).changes === 'number'
        ? (inserted as { changes: number }).changes
        : 1;
    if (changed === 0) {
      // Idempotent re-enqueue from the suspend → complete progression.
      // No broadcast needed; the existing card is unchanged.
      return;
    }

    ctx.sse?.broadcast(
      'kds.order.created',
      {
        saleId,
        siteId: saleRow.siteId,
        station,
        tableLabel: saleRow.tableLabel,
        saleNumber: saleRow.saleNumber,
        itemCount: items.length,
      },
      ctx.tenantId
    );
  } catch (err) {
    (ctx.log ?? log).warn({ err, saleId, tenantId: ctx.tenantId }, 'kds enqueue failed');
  }
}

async function loadSaleSnapshot(
  db: KdsHookContext['db'],
  tenantId: string,
  saleId: string
): Promise<{
  saleNumber: string;
  siteId: string;
  tableId: string | null;
  tableLabel: string | null;
  notes: string | null;
} | null> {
  const row = await db
    .select({
      saleNumber: sales.saleNumber,
      cashSessionId: sales.cashSessionId,
      tableId: sales.tableId,
      suspendedLabel: sales.suspendedLabel,
      notes: sales.notes,
    })
    .from(sales)
    .where(and(eq(sales.id, saleId), eq(sales.tenantId, tenantId)))
    .get();
  if (!row) return null;
  const siteId = await resolveSiteForSale(db, tenantId, row.cashSessionId);
  if (!siteId) return null;
  // Prefer the live `restaurant_tables.name` when the sale carries a
  // tableId so the enqueue hook captures the right label even when it
  // fires before `sales.suspend` writes `suspendedLabel`. Free-text
  // labels (no tableId) fall back to `suspendedLabel`.
  let tableLabel: string | null = row.suspendedLabel ?? null;
  if (row.tableId) {
    const tableRow = await db
      .select({ name: restaurantTables.name })
      .from(restaurantTables)
      .where(and(eq(restaurantTables.id, row.tableId), eq(restaurantTables.tenantId, tenantId)))
      .get();
    tableLabel = tableRow?.name ?? tableLabel;
  }
  return {
    saleNumber: row.saleNumber,
    siteId,
    tableId: row.tableId ?? null,
    tableLabel,
    notes: row.notes ?? null,
  };
}

async function resolveSiteForSale(
  db: KdsHookContext['db'],
  tenantId: string,
  cashSessionId: string | null
): Promise<string | null> {
  if (!cashSessionId) return null;
  const { cashSessions } = await import('../../db/schema.js');
  const row = await db
    .select({ siteId: cashSessions.siteId })
    .from(cashSessions)
    .where(and(eq(cashSessions.id, cashSessionId), eq(cashSessions.tenantId, tenantId)))
    .get();
  return row?.siteId ?? null;
}

async function loadItemSnapshots(
  db: KdsHookContext['db'],
  saleId: string
): Promise<KdsItemSnapshot[]> {
  const rows = await db
    .select({
      saleItemId: saleItems.id,
      productId: saleItems.productId,
      productName: products.name,
      quantity: saleItems.quantity,
      notes: saleItems.notes,
    })
    .from(saleItems)
    .innerJoin(products, eq(products.id, saleItems.productId))
    .where(eq(saleItems.saleId, saleId))
    .all();
  return rows.map(row => ({
    saleItemId: row.saleItemId,
    productId: row.productId,
    productName: row.productName,
    quantity: row.quantity,
    notes: row.notes,
  }));
}
