import { assertOperatorSyncPayload } from '../../../services/sync/operator-policy.js';
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
import { enqueueSyncInTransaction } from '../../../services/sync/enqueue.js';
import { isRemoteSyncApplyBlocked } from '../../../services/sync/contract.js';
import {
  iterateSyncEntityPayloads,
  findEntity,
  getConflictResolutionAvailability,
  getConflictLocalRecordExists,
  getSyncEntityConfiguration,
  getSyncOverview,
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
      items: items.map(item => {
        const exists = getConflictLocalRecordExists(ctx.db, ctx.tenantId, item);
        return {
          ...item,
          localRecordExists: exists,
          resolutionAvailability: getConflictResolutionAvailability(
            ctx.db,
            ctx.tenantId,
            item,
            exists
          ),
        };
      }),
      count: countRow?.count ?? 0,
    };
  }),

  /**
   * Resolve a pending sync conflict and optionally requeue a local
   * update on the sync_outbox.
   */
  resolve: adminProcedure.input(resolveSyncConflictInput).mutation(async ({ ctx, input }) => {
    const conflictId = ctx.db.transaction(
      tx => {
        const conflict = tx
          .select()
          .from(syncConflicts)
          .where(and(eq(syncConflicts.id, input.id), eq(syncConflicts.tenantId, ctx.tenantId)))
          .get();
        if (!conflict)
          throw new TRPCError({ code: 'NOT_FOUND', message: 'Sync conflict not found' });
        if (conflict.status !== 'pending')
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'Sync conflict has already been resolved',
          });
        if (isRemoteSyncApplyBlocked(conflict.entityType) && input.resolution !== 'local_wins') {
          throwServerError({
            trpcCode: 'BAD_REQUEST',
            errorCode: 'SYNC_REMOTE_APPLY_BLOCKED',
            message: 'This entity requires a verified atomic remote codec before apply',
            details: { entityType: conflict.entityType, resolution: input.resolution },
          });
        }
        const nextData =
          input.resolution === 'merged'
            ? input.mergedData!
            : input.resolution === 'local_wins'
              ? (conflict.localData ?? {})
              : null;
        if (nextData) {
          const entityConfig = getSyncEntityConfiguration(conflict.entityType);
          if (!entityConfig)
            throw new TRPCError({
              code: 'BAD_REQUEST',
              message: `Unsupported sync entity type: ${conflict.entityType}`,
            });
          // Raw SQLite helper needs the root handle; it shares this active writer transaction.
          if (!findEntity(ctx.db, entityConfig, ctx.tenantId, conflict.entityId)) {
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
        const scope = {
          tenantId: ctx.tenantId,
          entityId: conflict.entityId,
          entityType: conflict.entityType,
        };
        // A metadata-only merge must not discard a pending valuation-bearing local change.
        assertOperatorSyncPayload({ ...scope, data: conflict.localData });
        if (input.resolution !== 'local_wins')
          assertOperatorSyncPayload({ ...scope, data: conflict.remoteData });
        if (nextData) assertOperatorSyncPayload({ ...scope, data: nextData });
        for (const data of iterateSyncEntityPayloads(
          ctx.db,
          ctx.tenantId,
          conflict.entityType,
          conflict.entityId
        )) {
          assertOperatorSyncPayload({ ...scope, data });
        }
        const now = new Date().toISOString();
        tx.update(syncConflicts)
          .set({ status: 'resolved', resolution: input.resolution, resolvedAt: now })
          .where(
            and(
              eq(syncConflicts.id, conflict.id),
              eq(syncConflicts.tenantId, ctx.tenantId),
              eq(syncConflicts.status, 'pending')
            )
          )
          .run();
        tx.delete(syncOutbox)
          .where(
            and(
              eq(syncOutbox.tenantId, ctx.tenantId),
              eq(syncOutbox.entityType, conflict.entityType),
              eq(syncOutbox.entityId, conflict.entityId)
            )
          )
          .run();
        if (nextData)
          enqueueSyncInTransaction(
            { ...ctx, db: tx },
            {
              entityType: conflict.entityType as SyncEntityType,
              entityId: conflict.entityId,
              operation: 'update',
              data: nextData,
            }
          );
        return conflict.id;
      },
      { behavior: 'immediate' }
    );

    const overview = await getSyncOverview(ctx.db, ctx.tenantId);

    return {
      success: true,
      id: conflictId,
      resolution: input.resolution,
      ...overview,
    };
  }),
};
