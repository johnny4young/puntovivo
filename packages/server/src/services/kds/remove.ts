/**
 * `removeKdsOrders` hook.
 *
 * Deletes every `kds_orders` row for a given sale and broadcasts
 * one `kds.order.removed` event per deleted row so the board
 * surface drops the card on the next render. Idempotent — calling
 * with a sale that never had a card is a silent no-op.
 *
 * Called from `discardDraft` (cashier walked away from the draft)
 * and `voidSale` (admin reversed a completed sale). Refunds are
 * deliberately not wired here: by the time `sales.returnSale` runs,
 * the card has already aged out via the 5-minute ready TTL or has
 * never existed because the sale never carried a `tableId`.
 *
 * @module services/kds/remove
 */

import { and, eq } from 'drizzle-orm';
import { kdsOrders } from '../../db/schema.js';
import { createModuleLogger } from '../../logging/logger.js';
import type { KdsHookContext } from './types.js';

const log = createModuleLogger('kds');

export interface RemoveKdsOrdersArgs {
  ctx: KdsHookContext;
  saleId: string;
  reason?: string;
}

export async function removeKdsOrders(args: RemoveKdsOrdersArgs): Promise<void> {
  const { ctx, saleId, reason } = args;
  try {
    const existing = await ctx.db
      .select({
        id: kdsOrders.id,
        siteId: kdsOrders.siteId,
        station: kdsOrders.station,
      })
      .from(kdsOrders)
      .where(and(eq(kdsOrders.tenantId, ctx.tenantId), eq(kdsOrders.saleId, saleId)))
      .all();
    if (existing.length === 0) return;

    ctx.db
      .delete(kdsOrders)
      .where(and(eq(kdsOrders.tenantId, ctx.tenantId), eq(kdsOrders.saleId, saleId)))
      .run();

    for (const row of existing) {
      ctx.sse?.broadcast(
        'kds.order.removed',
        {
          saleId,
          siteId: row.siteId,
          station: row.station,
          reason: reason ?? null,
        },
        ctx.tenantId
      );
    }
  } catch (err) {
    (ctx.log ?? log).warn({ err, saleId, tenantId: ctx.tenantId }, 'kds remove failed');
  }
}
