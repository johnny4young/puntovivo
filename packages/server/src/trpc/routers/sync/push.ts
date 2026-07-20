/**
 * Sync router — outbox push processing ( split).
 *
 * `sync.push` (tenant): process pending `sync_outbox` rows, mark them synced
 * locally, or open a conflict / bump to retrying when the local record is
 * missing or unsupported. Operator-driven; the periodic worker daemon lands in
 * .
 *
 * @module trpc/routers/sync/push
 */

import { eq, and, desc, inArray } from 'drizzle-orm';
import { tenantProcedure } from '../../middleware/tenant.js';
import { syncOutbox } from '../../../db/schema.js';
import { pushSyncInput } from '../../schemas/sync.js';
import {
  ensureSyncConflict,
  findEntity,
  getSyncEntityConfiguration,
  getSyncOverview,
  hasPendingConflict,
  markEntityAsSynced,
  markOutboxFailure,
  saveLastSyncAt,
} from './helpers.js';

export const syncPushProcedures = {
  /**
   * Process pending sync_outbox rows and mark them as synced
   * locally. Operator-driven; the periodic worker daemon lands in
   * .
   */
  push: tenantProcedure.input(pushSyncInput).mutation(async ({ ctx, input }) => {
    const items = await ctx.db
      .select({
        id: syncOutbox.id,
        entityType: syncOutbox.entityType,
        entityId: syncOutbox.entityId,
        operation: syncOutbox.operation,
        payload: syncOutbox.payload,
        attempts: syncOutbox.attempts,
        priority: syncOutbox.priority,
      })
      .from(syncOutbox)
      .where(
        and(
          eq(syncOutbox.tenantId, ctx.tenantId),
          inArray(syncOutbox.status, ['queued', 'retrying'])
        )
      )
      .orderBy(desc(syncOutbox.priority), syncOutbox.createdAt)
      .limit(input.limit)
      .all();

    const processedIds: string[] = [];
    const conflictIds: string[] = [];
    const errors: string[] = [];
    const now = new Date().toISOString();

    for (const item of items) {
      const existingConflictId = await hasPendingConflict(
        ctx.db,
        ctx.tenantId,
        item.entityType,
        item.entityId
      );

      if (existingConflictId) {
        const message = `Pending conflict blocks ${item.entityType}:${item.entityId}`;
        await markOutboxFailure(ctx.db, ctx.tenantId, item.id, message);
        conflictIds.push(existingConflictId);
        errors.push(message);
        continue;
      }

      const config = getSyncEntityConfiguration(item.entityType);
      if (!config) {
        const message = `Unsupported sync entity type: ${item.entityType}`;
        await markOutboxFailure(ctx.db, ctx.tenantId, item.id, message);
        errors.push(message);
        continue;
      }

      if (item.operation !== 'delete') {
        const entity = findEntity(ctx.db, config, ctx.tenantId, item.entityId);
        if (!entity) {
          const message = `Unable to sync ${item.entityType}:${item.entityId} because the local record is missing`;
          const conflictId = await ensureSyncConflict(ctx.db, {
            tenantId: ctx.tenantId,
            entityType: item.entityType,
            entityId: item.entityId,
            localData: (item.payload ?? {}) as Record<string, unknown>,
            remoteData: {},
          });
          await markOutboxFailure(ctx.db, ctx.tenantId, item.id, message);
          conflictIds.push(conflictId);
          errors.push(message);
          continue;
        }

        markEntityAsSynced(ctx.db, config, ctx.tenantId, item.entityId, now);
      }

      await ctx.db
        .update(syncOutbox)
        .set({
          status: 'synced',
          lastError: null,
          updatedAt: now,
        })
        .where(and(eq(syncOutbox.id, item.id), eq(syncOutbox.tenantId, ctx.tenantId)))
        .run();
      processedIds.push(item.id);
    }

    if (processedIds.length > 0) {
      await saveLastSyncAt(ctx.db, ctx.tenantId, now);
    }

    const overview = await getSyncOverview(ctx.db, ctx.tenantId);

    return {
      success: errors.length === 0,
      synced: processedIds.length,
      processedIds,
      conflictIds,
      errors,
      ...overview,
    };
  }),
};
