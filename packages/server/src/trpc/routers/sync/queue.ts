/**
 * Sync router — outbox queue operations (ENG-178 split).
 *
 * `sync.listQueue` / `sync.addToQueue` / `sync.removeFromQueue` (manager/admin):
 * the operator-facing recovery surface over `sync_outbox`. System writers go
 * through `enqueueSync()`; these are the manual surfaces.
 *
 * @module trpc/routers/sync/queue
 */

import { TRPCError } from '@trpc/server';
import { eq, and, inArray, sql } from 'drizzle-orm';
import { managerOrAdminProcedure } from '../../middleware/roles.js';
import { syncOutbox } from '../../../db/schema.js';
import {
  listQueueInput,
  addToQueueInput,
  removeFromQueueInput,
} from '../../schemas/sync.js';
import { enqueueSync } from '../../../services/sync/enqueue.js';
import {
  PENDING_STATUSES,
  type PendingStatus,
  type SyncEntityType,
} from './helpers.js';

export const syncQueueProcedures = {
  /**
   * List pending operations from the sync_outbox.
   *
   * The legacy response shape mapped one-to-one to `sync_queue`
   * columns (`data`, `localVersion`). Post-cutover the projection
   * still exposes `data` + `localVersion` (aliased from `payload` +
   * `payloadVersion`) so the web admin keeps rendering without a
   * shape change.
   */
  listQueue: managerOrAdminProcedure.input(listQueueInput).query(async ({ ctx, input }) => {
    const where = and(
      eq(syncOutbox.tenantId, ctx.tenantId),
      inArray(syncOutbox.status, PENDING_STATUSES as unknown as PendingStatus[])
    );
    const [rows, countRow] = await Promise.all([
      ctx.db
        .select({
          id: syncOutbox.id,
          tenantId: syncOutbox.tenantId,
          entityType: syncOutbox.entityType,
          entityId: syncOutbox.entityId,
          operation: syncOutbox.operation,
          data: syncOutbox.payload,
          localVersion: syncOutbox.payloadVersion,
          attempts: syncOutbox.attempts,
          lastError: syncOutbox.lastError,
          createdAt: syncOutbox.createdAt,
        })
        .from(syncOutbox)
        .where(where)
        .orderBy(syncOutbox.createdAt)
        .limit(input.limit)
        .all(),
      ctx.db
        .select({ count: sql<number>`count(*)` })
        .from(syncOutbox)
        .where(where)
        .get(),
    ]);

    return { items: rows, count: countRow?.count ?? 0 };
  }),

  /**
   * Add an operation to the local sync_outbox manually. Operator
   * recovery surface — system writers go through `enqueueSync()`.
   */
  addToQueue: managerOrAdminProcedure.input(addToQueueInput).mutation(async ({ ctx, input }) => {
    const result = await enqueueSync(ctx, {
      entityType: input.entityType as SyncEntityType,
      entityId: input.entityId,
      operation: input.operation,
      data: input.data ?? {},
    });

    return {
      id: result.id,
      entityType: input.entityType,
      entityId: input.entityId,
      operation: input.operation,
      createdAt: new Date().toISOString(),
    };
  }),

  /**
   * Remove an item from the sync_outbox (after successful manual
   * recovery, or to discard a stuck row outright).
   */
  removeFromQueue: managerOrAdminProcedure.input(removeFromQueueInput).mutation(async ({ ctx, input }) => {
    const item = await ctx.db
      .select({ id: syncOutbox.id })
      .from(syncOutbox)
      .where(and(eq(syncOutbox.id, input.id), eq(syncOutbox.tenantId, ctx.tenantId)))
      .get();

    if (!item) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Sync outbox item not found' });
    }

    await ctx.db
      .delete(syncOutbox)
      .where(and(eq(syncOutbox.id, input.id), eq(syncOutbox.tenantId, ctx.tenantId)))
      .run();

    return { success: true, id: input.id };
  }),
};
