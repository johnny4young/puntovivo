/**
 * Sync router — ENG-064 contract v1 surface (ENG-178 split).
 *
 * `sync.getContract` / `sync.peekOutbox` (manager/admin) + `sync.retry`
 * (admin): the manifest negotiation, the Operations Center tail (ENG-065),
 * and the operator-driven retry of stuck `sync_outbox` rows. All operate on
 * `sync_outbox` (migration 0016). ENG-064b migrated the legacy queue /
 * conflict / status procedures (now in queue.ts / conflicts.ts / status.ts)
 * onto the same `sync_outbox` table and dropped `sync_queue` in migration
 * 0017, so the entire sync surface shares one table.
 *
 * @module trpc/routers/sync/contract
 */

import { eq, and, desc } from 'drizzle-orm';
import { adminProcedure, managerOrAdminProcedure } from '../../middleware/roles.js';
import { throwServerError } from '../../../lib/errorCodes.js';
import { syncOutbox } from '../../../db/schema.js';
import { peekOutboxInput, retryOutboxInput } from '../../schemas/sync.js';
import { buildSyncContractManifest } from '../../../services/sync/index.js';

export const syncContractProcedures = {
  /**
   * Returns the sync payload contract manifest. ENG-068+ multi-store
   * sync uses this to negotiate the per-entity policy + version
   * before exchanging payloads.
   */
  getContract: managerOrAdminProcedure.query(() => buildSyncContractManifest()),

  /**
   * Operator-facing peek into the sync_outbox tail. Manager+admin
   * gated. Consumed by ENG-065's Operations Center.
   */
  peekOutbox: managerOrAdminProcedure
    .input(peekOutboxInput)
    .query(async ({ ctx, input }) => {
      const rows = await ctx.db
        .select({
          id: syncOutbox.id,
          status: syncOutbox.status,
          entityType: syncOutbox.entityType,
          entityId: syncOutbox.entityId,
          operation: syncOutbox.operation,
          conflictPolicy: syncOutbox.conflictPolicy,
          payloadVersion: syncOutbox.payloadVersion,
          idempotencyKey: syncOutbox.idempotencyKey,
          deviceId: syncOutbox.deviceId,
          dependsOnOperationId: syncOutbox.dependsOnOperationId,
          operationEventId: syncOutbox.operationEventId,
          attempts: syncOutbox.attempts,
          nextRetryAt: syncOutbox.nextRetryAt,
          lastError: syncOutbox.lastError,
          priority: syncOutbox.priority,
          createdAt: syncOutbox.createdAt,
          updatedAt: syncOutbox.updatedAt,
        })
        .from(syncOutbox)
        .where(eq(syncOutbox.tenantId, ctx.tenantId))
        .orderBy(desc(syncOutbox.priority), syncOutbox.createdAt)
        .limit(input.limit)
        .all();
      return rows;
    }),

  /**
   * Reset a `sync_outbox` row so the next push attempt picks it up
   * fresh. Operator path for "this row got stuck on a transient
   * error; force a retry now". Retryable rows (`retrying` /
   * `dead_letter`) reset `attempts=0`, clear `lastError`, move
   * status back to `queued`, and set `nextRetryAt=null`.
   * `queued` / `submitting` / `synced` / `conflict` are no-ops so
   * an accepted row cannot be accidentally replayed.
   * Admin-only.
   */
  retry: adminProcedure.input(retryOutboxInput).mutation(async ({ ctx, input }) => {
    const existing = await ctx.db
      .select({ id: syncOutbox.id, status: syncOutbox.status })
      .from(syncOutbox)
      .where(
        and(
          eq(syncOutbox.id, input.id),
          eq(syncOutbox.tenantId, ctx.tenantId)
        )
      )
      .get();
    if (!existing) {
      throwServerError({
        trpcCode: 'NOT_FOUND',
        errorCode: 'SYNC_OUTBOX_NOT_FOUND',
        message: 'sync_outbox row not found',
      });
    }
    if (existing.status !== 'retrying' && existing.status !== 'dead_letter') {
      return { ok: true as const, id: input.id };
    }
    const now = new Date().toISOString();
    await ctx.db
      .update(syncOutbox)
      .set({
        status: 'queued',
        attempts: 0,
        nextRetryAt: null,
        lastError: null,
        claimToken: null,
        lockedAt: null,
        updatedAt: now,
      })
      .where(
        and(
          eq(syncOutbox.id, input.id),
          eq(syncOutbox.tenantId, ctx.tenantId)
        )
      );
    return { ok: true as const, id: input.id };
  }),
};
