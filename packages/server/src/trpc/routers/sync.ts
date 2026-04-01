/**
 * Sync tRPC Router
 *
 * Local sync queue management and sync status.
 *
 * Procedures (implemented):
 * - sync.status          (tenant) - Get current sync status
 * - sync.listQueue       (tenant) - List pending sync queue items
 * - sync.addToQueue      (tenant) - Add an operation to the sync queue
 * - sync.removeFromQueue (tenant) - Remove an item from the sync queue
 * - sync.listConflicts   (tenant) - List unresolved sync conflicts
 *
 * Procedures (Phase 2 stubs — throw NOT_IMPLEMENTED):
 * - sync.push    - Push local changes to remote server
 * - sync.pull    - Pull remote changes
 * - sync.resolve - Resolve a sync conflict
 *
 * @module trpc/routers/sync
 */

import { TRPCError } from '@trpc/server';
import { eq, and, desc } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { router } from '../init.js';
import { tenantProcedure } from '../middleware/tenant.js';
import { syncQueue, syncConflicts } from '../../db/schema.js';
import {
  listQueueInput,
  addToQueueInput,
  removeFromQueueInput,
  listConflictsInput,
} from '../schemas/sync.js';

export const syncRouter = router({
  /**
   * Get the current sync status (pending count, conflicts count, last sync time)
   */
  status: tenantProcedure.query(async ({ ctx }) => {
    const [queueItems, conflicts] = await Promise.all([
      ctx.db.select().from(syncQueue).where(eq(syncQueue.tenantId, ctx.tenantId)).all(),
      ctx.db
        .select()
        .from(syncConflicts)
        .where(and(eq(syncConflicts.tenantId, ctx.tenantId), eq(syncConflicts.status, 'pending')))
        .all(),
    ]);

    return {
      pendingCount: queueItems.length,
      conflictsCount: conflicts.length,
      externalSyncEnabled: false, // Phase 2
      lastSyncAt: null, // Phase 2
      status: queueItems.length === 0 ? 'synced' : 'pending',
    };
  }),

  /**
   * List pending operations from the sync queue
   */
  listQueue: tenantProcedure.input(listQueueInput).query(async ({ ctx, input }) => {
    const items = await ctx.db
      .select()
      .from(syncQueue)
      .where(eq(syncQueue.tenantId, ctx.tenantId))
      .orderBy(syncQueue.createdAt)
      .limit(input.limit)
      .all();

    return { items, count: items.length };
  }),

  /**
   * Add an operation to the local sync queue
   */
  addToQueue: tenantProcedure.input(addToQueueInput).mutation(async ({ ctx, input }) => {
    const now = new Date().toISOString();
    const id = nanoid();

    await ctx.db.insert(syncQueue).values({
      id,
      tenantId: ctx.tenantId,
      entityType: input.entityType,
      entityId: input.entityId,
      operation: input.operation,
      data: input.data ?? {},
      localVersion: 1,
      attempts: 0,
      createdAt: now,
    });

    return {
      id,
      entityType: input.entityType,
      entityId: input.entityId,
      operation: input.operation,
      createdAt: now,
    };
  }),

  /**
   * Remove an item from the sync queue (after successful sync)
   */
  removeFromQueue: tenantProcedure.input(removeFromQueueInput).mutation(async ({ ctx, input }) => {
    const item = await ctx.db
      .select()
      .from(syncQueue)
      .where(and(eq(syncQueue.id, input.id), eq(syncQueue.tenantId, ctx.tenantId)))
      .get();

    if (!item) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Sync queue item not found' });
    }

    await ctx.db.delete(syncQueue).where(eq(syncQueue.id, input.id));

    return { success: true, id: input.id };
  }),

  /**
   * List unresolved sync conflicts
   */
  listConflicts: tenantProcedure.input(listConflictsInput).query(async ({ ctx, input }) => {
    const items = await ctx.db
      .select()
      .from(syncConflicts)
      .where(and(eq(syncConflicts.tenantId, ctx.tenantId), eq(syncConflicts.status, 'pending')))
      .orderBy(desc(syncConflicts.createdAt))
      .limit(input.limit)
      .all();

    return { items, count: items.length };
  }),

  // ==========================================================================
  // Phase 2 stubs
  // ==========================================================================

  /**
   * Push local changes to remote server (Phase 2)
   */
  push: tenantProcedure.mutation(() => {
    throw new TRPCError({
      code: 'METHOD_NOT_SUPPORTED',
      message: 'External sync push will be available in Phase 2',
    });
  }),

  /**
   * Pull remote changes (Phase 2)
   */
  pull: tenantProcedure.query(() => {
    throw new TRPCError({
      code: 'METHOD_NOT_SUPPORTED',
      message: 'External sync pull will be available in Phase 2',
    });
  }),

  /**
   * Resolve a sync conflict (Phase 2)
   */
  resolve: tenantProcedure.mutation(() => {
    throw new TRPCError({
      code: 'METHOD_NOT_SUPPORTED',
      message: 'Conflict resolution will be available in Phase 2',
    });
  }),
});
