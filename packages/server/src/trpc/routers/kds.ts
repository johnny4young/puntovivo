/**
 * ENG-098 — `kds.*` tRPC namespace.
 *
 * Read + two writes power the kitchen display board:
 *
 *   - `list({siteId?, limit?})` — board view; auto-evicts ready rows
 *      older than `READY_TTL_MINUTES=5` so the surface doesn't grow
 *      indefinitely while the kitchen is busy.
 *   - `markReady({id})` — pending → ready, sets `ready_at +
 *      ready_by_user_id`, emits audit `kds.order.ready`.
 *   - `recall({id})` — ready → pending (recovery affordance for the
 *      cook who misclicked), emits audit `kds.order.recalled`.
 *
 * Every procedure is wrapped by `cashierManagerOrAdminProcedure`
 * (the kitchen TV is usually opened by a cook with the cashier role)
 * AND `createModuleGuard('kds')` (so the board cannot be probed by a
 * tenant that has not turned the module on).
 *
 * Multi-tenant invariant: all selects scope by `ctx.tenantId`. Cross-
 * tenant `markReady` / `recall` collapse to `KDS_ORDER_NOT_FOUND` so
 * existence never leaks.
 *
 * @module trpc/routers/kds
 */

import { and, asc, desc, eq, gte, or, sql } from 'drizzle-orm';
import {
  kdsOrders,
  restaurantTables,
  type KdsOrderRow,
} from '../../db/schema.js';
import { throwServerError } from '../../lib/errorCodes.js';
import { writeAuditLog } from '../../services/audit-logs.js';
import type { KdsItemSnapshot } from '../../services/kds/types.js';
import { router } from '../init.js';
import { cashierManagerOrAdminProcedure } from '../middleware/roles.js';
import { createModuleGuard } from '../middleware/modules.js';
import {
  listKdsOrdersInput,
  markKdsOrderReadyInput,
  recallKdsOrderInput,
} from '../schemas/kds.js';

const READY_TTL_MINUTES = 5;
const kdsProcedure = cashierManagerOrAdminProcedure.use(createModuleGuard('kds'));

export interface KdsOrderResponse {
  id: string;
  saleId: string;
  saleNumber: string;
  tableId: string | null;
  tableLabel: string | null;
  station: string;
  items: KdsItemSnapshot[];
  notes: string | null;
  status: KdsOrderRow['status'];
  createdAt: string;
  readyAt: string | null;
  readyByUserId: string | null;
  updatedAt: string;
}

function parseItems(blob: string): KdsItemSnapshot[] {
  try {
    const parsed = JSON.parse(blob);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (entry): entry is KdsItemSnapshot =>
        entry !== null &&
        typeof entry === 'object' &&
        typeof (entry as { saleItemId?: unknown }).saleItemId === 'string' &&
        typeof (entry as { productName?: unknown }).productName === 'string'
    );
  } catch {
    return [];
  }
}

function toResponse(row: KdsOrderRow): KdsOrderResponse {
  return {
    id: row.id,
    saleId: row.saleId,
    saleNumber: row.saleNumber,
    tableId: row.tableId,
    tableLabel: row.tableLabel,
    station: row.station,
    items: parseItems(row.itemsJson),
    notes: row.notes,
    status: row.status,
    createdAt: row.createdAt,
    readyAt: row.readyAt,
    readyByUserId: row.readyByUserId,
    updatedAt: row.updatedAt,
  };
}

export const kdsRouter = router({
  list: kdsProcedure.input(listKdsOrdersInput).query(async ({ ctx, input }) => {
    const siteId = input.siteId ?? ctx.siteId;
    if (!siteId) {
      return { items: [] as KdsOrderResponse[], readyTtlMinutes: READY_TTL_MINUTES };
    }

    const readyCutoff = new Date(Date.now() - READY_TTL_MINUTES * 60_000).toISOString();
    const conditions = and(
      eq(kdsOrders.tenantId, ctx.tenantId),
      eq(kdsOrders.siteId, siteId),
      // Keep every pending row + ready rows newer than the TTL.
      or(
        eq(kdsOrders.status, 'pending'),
        and(eq(kdsOrders.status, 'ready'), gte(kdsOrders.readyAt, readyCutoff))
      )
    );

    const rows = await ctx.db
      .select()
      .from(kdsOrders)
      .where(conditions)
      // Surface pending cards before ready ones — alphabetically
      // `'ready'` sorts before `'pending'`, so `desc(status)` gives
      // us pending → ready. Within a status bucket, oldest first so
      // the cook sees the longest-waiting order at the top-left.
      .orderBy(desc(kdsOrders.status), asc(kdsOrders.createdAt))
      .limit(input.limit)
      .all();

    // Hydrate `tableLabel` from `restaurant_tables.name` when the FK
    // is set so a renamed table reflects on the board live. Free-text
    // labels (no FK) keep whatever was snapshotted on enqueue.
    const tableIds = Array.from(
      new Set(rows.map(row => row.tableId).filter((id): id is string => Boolean(id)))
    );
    let tableNameById = new Map<string, string>();
    if (tableIds.length > 0) {
      const tableRows = await ctx.db
        .select({ id: restaurantTables.id, name: restaurantTables.name })
        .from(restaurantTables)
        .where(
          and(
            eq(restaurantTables.tenantId, ctx.tenantId),
            // inArray would be ideal but the IDs vary; the IN clause
            // is built via sql template to stay portable.
            sql`${restaurantTables.id} IN (${sql.join(
              tableIds.map(id => sql`${id}`),
              sql`, `
            )})`
          )
        )
        .all();
      tableNameById = new Map(tableRows.map(row => [row.id, row.name]));
    }

    return {
      items: rows.map(row => {
        const hydrated = toResponse(row);
        if (row.tableId && tableNameById.has(row.tableId)) {
          hydrated.tableLabel = tableNameById.get(row.tableId) ?? hydrated.tableLabel;
        }
        return hydrated;
      }),
      readyTtlMinutes: READY_TTL_MINUTES,
    };
  }),

  markReady: kdsProcedure
    .input(markKdsOrderReadyInput)
    .mutation(async ({ ctx, input }) => {
      const existing = await ctx.db
        .select()
        .from(kdsOrders)
        .where(and(eq(kdsOrders.id, input.id), eq(kdsOrders.tenantId, ctx.tenantId)))
        .get();
      if (!existing) {
        throwServerError({
          trpcCode: 'NOT_FOUND',
          errorCode: 'KDS_ORDER_NOT_FOUND',
          message: 'KDS order not found',
          details: { id: input.id },
        });
      }

      // Idempotent: already-ready row returns the current state
      // without writing a second audit row. Two cooks hitting the
      // same card race-safe.
      if (existing.status === 'ready') {
        return toResponse(existing);
      }

      const now = new Date().toISOString();
      const updated: KdsOrderRow = {
        ...existing,
        status: 'ready',
        readyAt: now,
        readyByUserId: ctx.user!.id,
        updatedAt: now,
      };

      ctx.db.transaction(tx => {
        tx.update(kdsOrders)
          .set({
            status: 'ready',
            readyAt: now,
            readyByUserId: ctx.user!.id,
            updatedAt: now,
          })
          .where(and(eq(kdsOrders.id, input.id), eq(kdsOrders.tenantId, ctx.tenantId)))
          .run();

        writeAuditLog({
          tx,
          tenantId: ctx.tenantId,
          actorId: ctx.user!.id,
          action: 'kds.order.ready',
          resourceType: 'kds_order',
          resourceId: input.id,
          before: { status: existing.status },
          after: { status: 'ready', readyAt: now, readyByUserId: ctx.user!.id },
          metadata: {
            saleId: existing.saleId,
            saleNumber: existing.saleNumber,
            station: existing.station,
            tableId: existing.tableId,
            tableLabel: existing.tableLabel,
          },
        });
      });

      ctx.req?.server?.sse?.broadcast(
        'kds.order.ready',
        {
          id: updated.id,
          saleId: updated.saleId,
          siteId: updated.siteId,
          station: updated.station,
          readyAt: now,
        },
        ctx.tenantId
      );

      return toResponse(updated);
    }),

  recall: kdsProcedure
    .input(recallKdsOrderInput)
    .mutation(async ({ ctx, input }) => {
      const existing = await ctx.db
        .select()
        .from(kdsOrders)
        .where(and(eq(kdsOrders.id, input.id), eq(kdsOrders.tenantId, ctx.tenantId)))
        .get();
      if (!existing) {
        throwServerError({
          trpcCode: 'NOT_FOUND',
          errorCode: 'KDS_ORDER_NOT_FOUND',
          message: 'KDS order not found',
          details: { id: input.id },
        });
      }
      if (existing.status !== 'ready') {
        throwServerError({
          trpcCode: 'BAD_REQUEST',
          errorCode: 'KDS_ORDER_NOT_READY',
          message: 'Only ready cards can be recalled to pending',
          details: { id: input.id, currentStatus: existing.status },
        });
      }

      const now = new Date().toISOString();
      const updated: KdsOrderRow = {
        ...existing,
        status: 'pending',
        readyAt: null,
        readyByUserId: null,
        updatedAt: now,
      };

      ctx.db.transaction(tx => {
        tx.update(kdsOrders)
          .set({
            status: 'pending',
            readyAt: null,
            readyByUserId: null,
            updatedAt: now,
          })
          .where(and(eq(kdsOrders.id, input.id), eq(kdsOrders.tenantId, ctx.tenantId)))
          .run();

        writeAuditLog({
          tx,
          tenantId: ctx.tenantId,
          actorId: ctx.user!.id,
          action: 'kds.order.recalled',
          resourceType: 'kds_order',
          resourceId: input.id,
          before: {
            status: existing.status,
            readyAt: existing.readyAt,
            readyByUserId: existing.readyByUserId,
          },
          after: { status: 'pending', readyAt: null, readyByUserId: null },
          metadata: {
            saleId: existing.saleId,
            saleNumber: existing.saleNumber,
            station: existing.station,
            tableId: existing.tableId,
            tableLabel: existing.tableLabel,
          },
        });
      });

      ctx.req?.server?.sse?.broadcast(
        'kds.order.recalled',
        {
          id: updated.id,
          saleId: updated.saleId,
          siteId: updated.siteId,
          station: updated.station,
        },
        ctx.tenantId
      );

      return toResponse(updated);
    }),
});
