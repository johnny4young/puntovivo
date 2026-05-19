/**
 * ENG-098 — `refreshKdsOrderItems` hook.
 *
 * Rewrites the `items_json` snapshot and `table_id` / `table_label`
 * on an existing `kds_orders` row when the underlying sale changes
 * shape WITHOUT crossing a lifecycle boundary that should create or
 * destroy the card. Two callers:
 *
 *   - `sales.changeTable` — same items, new table label.
 *   - `sales.splitDraft`  — source sale lost items to the split;
 *      refresh shrinks the snapshot in place. The split's NEW draft
 *      goes through `enqueueKdsOrder` (a different row).
 *
 * The hook is a no-op when no row exists for the sale (kds module
 * disabled, retail sale, draft never reached the kitchen). It does
 * NOT honour the `kds` module gate explicitly — the absence of a
 * row already short-circuits the work.
 *
 * @module services/kds/refresh
 */

import { and, eq } from 'drizzle-orm';
import {
  kdsOrders,
  products,
  restaurantTables,
  saleItems,
  sales,
} from '../../db/schema.js';
import { createModuleLogger } from '../../logging/logger.js';
import { removeKdsOrders } from './remove.js';
import type { KdsHookContext, KdsItemSnapshot } from './types.js';

const log = createModuleLogger('kds');

export interface RefreshKdsOrderArgs {
  ctx: KdsHookContext;
  saleId: string;
}

export async function refreshKdsOrderItems(args: RefreshKdsOrderArgs): Promise<void> {
  const { ctx, saleId } = args;
  try {
    const existingRows = await ctx.db
      .select({
        id: kdsOrders.id,
        siteId: kdsOrders.siteId,
        station: kdsOrders.station,
      })
      .from(kdsOrders)
      .where(and(eq(kdsOrders.tenantId, ctx.tenantId), eq(kdsOrders.saleId, saleId)))
      .all();
    if (existingRows.length === 0) return;

    const saleRow = await ctx.db
      .select({
        tableId: sales.tableId,
        suspendedLabel: sales.suspendedLabel,
        notes: sales.notes,
      })
      .from(sales)
      .where(and(eq(sales.id, saleId), eq(sales.tenantId, ctx.tenantId)))
      .get();
    if (!saleRow) return;

    const items = await loadItemSnapshots(ctx.db, saleId);
    if (items.length === 0) {
      // ENG-098 — `sales.splitDraft` may have carved every item out of
      // the source, leaving the cart empty. Don't park a zombie card on
      // the kitchen board; remove it instead. The split's new draft
      // already produces its own card via `enqueueKdsOrder`.
      await removeKdsOrders({ ctx, saleId, reason: 'empty_after_split' });
      return;
    }
    const tableLabel = await resolveTableLabel(
      ctx.db,
      ctx.tenantId,
      saleRow.tableId ?? null,
      saleRow.suspendedLabel ?? null
    );

    const now = new Date().toISOString();
    ctx.db
      .update(kdsOrders)
      .set({
        tableId: saleRow.tableId ?? null,
        tableLabel,
        itemsJson: JSON.stringify(items),
        notes: saleRow.notes ?? null,
        updatedAt: now,
      })
      .where(and(eq(kdsOrders.tenantId, ctx.tenantId), eq(kdsOrders.saleId, saleId)))
      .run();

    for (const row of existingRows) {
      ctx.sse?.broadcast(
        'kds.order.updated',
        {
          saleId,
          siteId: row.siteId,
          station: row.station,
          tableLabel,
          itemCount: items.length,
        },
        ctx.tenantId
      );
    }
  } catch (err) {
    (ctx.log ?? log).warn({ err, saleId, tenantId: ctx.tenantId }, 'kds refresh failed');
  }
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
  }));
}

async function resolveTableLabel(
  db: KdsHookContext['db'],
  tenantId: string,
  tableId: string | null,
  fallbackLabel: string | null
): Promise<string | null> {
  if (!tableId) return fallbackLabel;
  const row = await db
    .select({ name: restaurantTables.name })
    .from(restaurantTables)
    .where(
      and(eq(restaurantTables.id, tableId), eq(restaurantTables.tenantId, tenantId))
    )
    .get();
  return row?.name ?? fallbackLabel;
}
