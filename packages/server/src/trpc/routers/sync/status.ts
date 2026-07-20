/**
 * Sync router — read-side aggregations ( split).
 *
 * `sync.status` (tenant) + `sync.pull` (manager/admin): the overview snapshot
 * and the read-only mirror with the actual queue + conflict payloads.
 *
 * @module trpc/routers/sync/status
 */

import { eq, and, desc, inArray } from 'drizzle-orm';
import { managerOrAdminProcedure } from '../../middleware/roles.js';
import { tenantProcedure } from '../../middleware/tenant.js';
import { syncConflicts, syncOutbox } from '../../../db/schema.js';
import { pullSyncInput } from '../../schemas/sync.js';
import {
  PENDING_STATUSES,
  getConflictLocalRecordExists,
  getSyncOverview,
  type PendingStatus,
} from './helpers.js';

export const syncStatusProcedures = {
  /**
   * Get the current sync status (pending count, conflicts count, last sync time)
   */
  status: tenantProcedure.query(async ({ ctx }) => {
    return getSyncOverview(ctx.db, ctx.tenantId);
  }),

  /**
   * Return a sync snapshot with pending sync_outbox rows and
   * conflicts. Read-only mirror of `sync.status` plus the actual row
   * payloads.
   */
  pull: managerOrAdminProcedure.input(pullSyncInput).query(async ({ ctx, input }) => {
    const [overview, queue, conflicts] = await Promise.all([
      getSyncOverview(ctx.db, ctx.tenantId),
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
        .where(
          and(
            eq(syncOutbox.tenantId, ctx.tenantId),
            inArray(syncOutbox.status, PENDING_STATUSES as unknown as PendingStatus[])
          )
        )
        .orderBy(syncOutbox.createdAt)
        .limit(input.queueLimit)
        .all(),
      ctx.db
        .select()
        .from(syncConflicts)
        .where(and(eq(syncConflicts.tenantId, ctx.tenantId), eq(syncConflicts.status, 'pending')))
        .orderBy(desc(syncConflicts.createdAt))
        .limit(input.conflictLimit)
        .all(),
    ]);

    return {
      ...overview,
      queue,
      conflicts: conflicts.map(conflict => ({
        ...conflict,
        localRecordExists: getConflictLocalRecordExists(ctx.db, ctx.tenantId, conflict),
      })),
    };
  }),
};
