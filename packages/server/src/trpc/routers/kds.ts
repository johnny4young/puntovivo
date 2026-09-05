/** Site-scoped preparation board; all writes persist event/audit/outbox under one writer. */
import { and, asc, eq, gte, or, sql } from 'drizzle-orm';
import { kdsOrders } from '../../db/schema.js';
import { projectKitchenOrders, type KdsOrderResponse } from '../../application/kds/read.js';
import {
  transitionKdsOrder,
  transitionKdsLine,
  resendKdsOrder,
} from '../../application/kds/transitionOrder.js';
import { router } from '../init.js';
import { cashierManagerOrAdminProcedure } from '../middleware/roles.js';
import { createModuleGuard } from '../middleware/modules.js';
import { ensureTenantSite } from '../middleware/tenantSite.js';
import {
  listKdsOrdersInput,
  markKdsOrderReadyInput,
  recallKdsOrderInput,
  transitionKdsLineInput,
} from '../schemas/kds.js';
import { kdsConfigurationProcedures } from './kdsConfiguration.js';
import type { Context } from '../context.js';

export type { KdsOrderResponse } from '../../application/kds/read.js';
const READY_TTL_MINUTES = 5;
const kdsProcedure = cashierManagerOrAdminProcedure.use(createModuleGuard('kds'));

function contextFor(ctx: Context) {
  return { db: ctx.db, tenantId: ctx.tenantId!, actorId: ctx.user!.id, siteId: ctx.siteId ?? null };
}
/** Re-read after transition under one snapshot; the board gets persisted, not synthesized, state. */
function responseFor(ctx: Context, id: string): KdsOrderResponse {
  return ctx.db.transaction(rawTx => {
    const tx = rawTx as unknown as typeof ctx.db;
    const row = tx
      .select()
      .from(kdsOrders)
      .where(
        and(
          eq(kdsOrders.id, id),
          eq(kdsOrders.tenantId, ctx.tenantId!),
          eq(kdsOrders.siteId, ctx.siteId!)
        )
      )
      .get()!;
    return projectKitchenOrders(tx, ctx.tenantId!, ctx.siteId!, [row])[0]!;
  });
}

export const kdsRouter = router({
  ...kdsConfigurationProcedures,
  list: kdsProcedure.input(listKdsOrdersInput).query(async ({ ctx, input }) => {
    const siteId = input.siteId ?? ctx.siteId;
    if (!siteId)
      return {
        items: [] as KdsOrderResponse[],
        hasMore: false,
        readyTtlMinutes: READY_TTL_MINUTES,
      };
    await ensureTenantSite(ctx.db, ctx.tenantId, siteId);
    return ctx.db.transaction(rawTx => {
      const tx = rawTx as unknown as typeof ctx.db;
      const cutoff = new Date(Date.now() - READY_TTL_MINUTES * 60_000).toISOString();
      const rows = tx
        .select()
        .from(kdsOrders)
        .where(
          and(
            eq(kdsOrders.tenantId, ctx.tenantId),
            eq(kdsOrders.siteId, siteId),
            input.station ? eq(kdsOrders.station, input.station) : undefined,
            or(
              eq(kdsOrders.status, 'pending'),
              and(eq(kdsOrders.status, 'ready'), gte(kdsOrders.readyAt, cutoff)),
              and(eq(kdsOrders.status, 'cancelled'), gte(kdsOrders.updatedAt, cutoff))
            )
          )
        )
        // Unfinished work must win before LIMIT, regardless of history volume.
        .orderBy(
          sql`CASE WHEN ${kdsOrders.status} = 'pending' THEN 0 ELSE 1 END`,
          asc(kdsOrders.createdAt),
          asc(kdsOrders.id)
        )
        .limit(input.limit + 1)
        .all();
      return {
        items: projectKitchenOrders(tx, ctx.tenantId, siteId, rows.slice(0, input.limit)),
        hasMore: rows.length > input.limit,
        readyTtlMinutes: READY_TTL_MINUTES,
      };
    });
  }),
  markReady: kdsProcedure.input(markKdsOrderReadyInput).mutation(({ ctx, input }) => {
    transitionKdsOrder(contextFor(ctx), input.id, 'ready', input.expectedVersion);
    return responseFor(ctx, input.id);
  }),
  recall: kdsProcedure.input(recallKdsOrderInput).mutation(({ ctx, input }) => {
    transitionKdsOrder(contextFor(ctx), input.id, 'pending', input.expectedVersion);
    return responseFor(ctx, input.id);
  }),
  transitionLine: kdsProcedure.input(transitionKdsLineInput).mutation(({ ctx, input }) => {
    transitionKdsLine(contextFor(ctx), input);
    return responseFor(ctx, input.orderId);
  }),
  resend: kdsProcedure.input(markKdsOrderReadyInput).mutation(({ ctx, input }) => {
    resendKdsOrder(contextFor(ctx), input.id, input.expectedVersion);
    return responseFor(ctx, input.id);
  }),
});
