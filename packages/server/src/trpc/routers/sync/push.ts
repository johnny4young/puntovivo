/**
 * Sync router — local outbox push processing.
 *
 * `sync.push` (tenant): process pending `sync_outbox` rows, mark them synced
 * locally, or open a conflict / bump to retrying when the local record is
 * missing or unsupported. This is local bookkeeping, not delivery to a remote peer.
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
   * locally; this does not deliver to a remote peer.
   */
  push: tenantProcedure.input(pushSyncInput).mutation(async ({ ctx, input }) => {
    const items = await ctx.db
      .select({
        id: syncOutbox.id,
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
    for (const item of items) {
      // Processing is local SQLite work. An IMMEDIATE writer transaction lets us
      // recheck the selected row and commit every resulting effect atomically,
      // without introducing a durable `submitting` claim that needs crash replay.
      const outcome = ctx.db.transaction(
        () => {
          const current = ctx.db
            .select({
              status: syncOutbox.status,
              entityType: syncOutbox.entityType,
              entityId: syncOutbox.entityId,
              operation: syncOutbox.operation,
              payload: syncOutbox.payload,
            })
            .from(syncOutbox)
            .where(and(eq(syncOutbox.id, item.id), eq(syncOutbox.tenantId, ctx.tenantId)))
            .get();
          if (!current || (current.status !== 'queued' && current.status !== 'retrying')) {
            return { kind: 'skipped' } as const;
          }
          const now = new Date().toISOString();

          const existingConflictId = hasPendingConflict(
            ctx.db,
            ctx.tenantId,
            current.entityType,
            current.entityId
          );
          if (existingConflictId) {
            const message = `Pending conflict blocks ${current.entityType}:${current.entityId}`;
            markOutboxFailure(ctx.db, ctx.tenantId, item.id, message, now);
            return { kind: 'failure', message, conflictId: existingConflictId } as const;
          }

          const config = getSyncEntityConfiguration(current.entityType);
          if (!config) {
            const message = `Unsupported sync entity type: ${current.entityType}`;
            markOutboxFailure(ctx.db, ctx.tenantId, item.id, message, now);
            return { kind: 'failure', message } as const;
          }

          if (current.operation !== 'delete') {
            const entity = findEntity(ctx.db, config, ctx.tenantId, current.entityId);
            if (!entity) {
              const message = `Unable to sync ${current.entityType}:${current.entityId} because the local record is missing`;
              const conflictId = ensureSyncConflict(ctx.db, {
                tenantId: ctx.tenantId,
                entityType: current.entityType,
                entityId: current.entityId,
                localData: (current.payload ?? {}) as Record<string, unknown>,
                remoteData: {},
              });
              markOutboxFailure(ctx.db, ctx.tenantId, item.id, message, now);
              return { kind: 'failure', message, conflictId } as const;
            }

            // Raw entity helpers use the root SQLite handle, which shares this
            // connection's active writer transaction (see sync.resolve).
            markEntityAsSynced(ctx.db, config, ctx.tenantId, current.entityId, now);
          }

          ctx.db
            .update(syncOutbox)
            .set({ status: 'synced', lastError: null, updatedAt: now })
            .where(and(eq(syncOutbox.id, item.id), eq(syncOutbox.tenantId, ctx.tenantId)))
            .run();
          saveLastSyncAt(ctx.db, ctx.tenantId, now);
          return { kind: 'processed' } as const;
        },
        { behavior: 'immediate' }
      );

      if (outcome.kind === 'processed') {
        processedIds.push(item.id);
      } else if (outcome.kind === 'failure') {
        errors.push(outcome.message);
        if ('conflictId' in outcome) conflictIds.push(outcome.conflictId);
      }
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
