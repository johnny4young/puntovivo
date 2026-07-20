/**
 * Sync router — conflict surface ( split).
 *
 * `sync.listConflicts` (manager/admin) + `sync.resolve` (admin). `resolve`
 * carries the  transaction-guarded `findEntity` check so a concurrent
 * delete between the outer unsupported-entityType guard and the keepLocal /
 * merged write cannot leave the path resolving against stale data.
 *
 * @module trpc/routers/sync/conflicts
 */

import { TRPCError } from '@trpc/server';
import { eq, and, desc, sql } from 'drizzle-orm';
import { adminProcedure, managerOrAdminProcedure } from '../../middleware/roles.js';
import { throwServerError } from '../../../lib/errorCodes.js';
import { syncConflicts, syncOutbox } from '../../../db/schema.js';
import { listConflictsInput, resolveSyncConflictInput } from '../../schemas/sync.js';
import { enqueueSync } from '../../../services/sync/enqueue.js';
import {
  findEntity,
  getConflictLocalRecordExists,
  getSyncEntityConfiguration,
  getSyncOverview,
  syncEntityConfig,
  type SyncEntityType,
} from './helpers.js';

export const syncConflictsProcedures = {
  /**
   * List unresolved sync conflicts
   */
  listConflicts: managerOrAdminProcedure.input(listConflictsInput).query(async ({ ctx, input }) => {
    const where = and(
      eq(syncConflicts.tenantId, ctx.tenantId),
      eq(syncConflicts.status, 'pending')
    );
    const [items, countRow] = await Promise.all([
      ctx.db
        .select()
        .from(syncConflicts)
        .where(where)
        .orderBy(desc(syncConflicts.createdAt))
        .limit(input.limit)
        .all(),
      ctx.db
        .select({ count: sql<number>`count(*)` })
        .from(syncConflicts)
        .where(where)
        .get(),
    ]);

    return {
      items: items.map(item => ({
        ...item,
        localRecordExists: getConflictLocalRecordExists(ctx.db, ctx.tenantId, item),
      })),
      count: countRow?.count ?? 0,
    };
  }),

  /**
   * Resolve a pending sync conflict and optionally requeue a local
   * update on the sync_outbox.
   */
  resolve: adminProcedure.input(resolveSyncConflictInput).mutation(async ({ ctx, input }) => {
    const conflict = await ctx.db
      .select()
      .from(syncConflicts)
      .where(and(eq(syncConflicts.id, input.id), eq(syncConflicts.tenantId, ctx.tenantId)))
      .get();

    if (!conflict) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Sync conflict not found' });
    }

    if (conflict.status === 'resolved') {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: 'Sync conflict has already been resolved',
      });
    }

    const now = new Date().toISOString();
    const nextData =
      input.resolution === 'merged'
        ? (input.mergedData ?? {})
        : input.resolution === 'local_wins'
          ? (conflict.localData ?? {})
          : null;

    // close-out — the unsupported-entityType check stays OUTSIDE
    // the transaction: it does not require rollback because no DB writes
    // have happened yet. The findEntity guard, however, moves INSIDE the
    // transaction callback below so a concurrent delete between the
    // outer check and the keepLocal / merged write can no longer leave
    // the path resolving against stale data.
    let entityConfig: (typeof syncEntityConfig)[SyncEntityType] | null = null;
    if (nextData) {
      entityConfig = getSyncEntityConfiguration(conflict.entityType);

      if (!entityConfig) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: `Unsupported sync entity type: ${conflict.entityType}`,
        });
      }
    }

    await ctx.db.transaction(tx => {
      if (nextData && entityConfig) {
        const entity = findEntity(ctx.db, entityConfig, ctx.tenantId, conflict.entityId);
        if (!entity) {
          throwServerError({
            trpcCode: 'BAD_REQUEST',
            errorCode: 'SYNC_LOCAL_RECORD_MISSING',
            message: 'Local record missing; accept remote to discard the stale queued change',
            details: {
              entityType: conflict.entityType,
              entityId: conflict.entityId,
              resolution: input.resolution,
            },
          });
        }
      }

      tx.update(syncConflicts)
        .set({
          status: 'resolved',
          resolution: input.resolution,
          resolvedAt: now,
        })
        .where(and(eq(syncConflicts.id, conflict.id), eq(syncConflicts.tenantId, ctx.tenantId)))
        .run();

      // Discard any in-flight outbox rows for the same entity. Both
      // resolution paths (`local_wins`/`merged` requeue, `remote_wins`
      // discard) start clean.
      tx.delete(syncOutbox)
        .where(
          and(
            eq(syncOutbox.tenantId, ctx.tenantId),
            eq(syncOutbox.entityType, conflict.entityType),
            eq(syncOutbox.entityId, conflict.entityId)
          )
        )
        .run();
    });

    if (nextData) {
      await enqueueSync(ctx, {
        entityType: conflict.entityType as SyncEntityType,
        entityId: conflict.entityId,
        operation: 'update',
        data: nextData,
      });
    }

    const overview = await getSyncOverview(ctx.db, ctx.tenantId);

    return {
      success: true,
      id: conflict.id,
      resolution: input.resolution,
      ...overview,
    };
  }),
};
