/**
 * /  — `enqueueSync` helper.
 *
 * Single entry point for every router that needs to enqueue an
 * entity change for downstream replication. Replaced the inline
 * `db.insert(...).values({ ... })` blocks that  cut over
 * across 19 routers + 4 application services + the dev seed with
 * a typed call that:
 *
 * 1. Resolves the per-entity `conflictPolicy` from the manifest
 * (`services/sync/contract.ts`). Throws when the entityType is
 * unknown — TypeScript exhaustiveness usually catches this at
 * build time; the runtime guard is defense-in-depth.
 * 2. Reads the command envelope from the procedure context when
 * present (`ctx.envelope` injected by 's middleware).
 * Populates `idempotencyKey + deviceId + operationEventId` so
 * retries can dedup at the queue layer.
 * 3. Writes one `sync_outbox` row + emits an `operation_effects`
 * row (kind=`outbox_enqueue:sync`) for the journal trail when
 * the operation event is in scope. Catalog writes that run
 * outside the envelope middleware leave the trail null, in
 * line with ADR-0002's "envelope only on critical commands"
 * rule.
 *
 * The duplicate-suppression UNIQUE index on
 * `(tenant_id, entity_type, entity_id, operation, idempotency_key)`
 * (partial: `WHERE idempotency_key IS NOT NULL`) collapses retry
 * enqueues into a single row — a network blip that retries the
 * sale-create command does not pile up duplicate sync rows.
 *
 * @module services/sync/enqueue
 */

import { and, eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import type { DatabaseInstance } from '../../db/index.js';
import { operationEvents, syncOutbox, type SyncOperation } from '../../db/schema.js';
import { recordEffect } from '../operation-journal/journal.js';
import { resolveConflictPolicy, resolveDefaultPriority, type SyncEntityType } from './contract.js';

/**
 * Shape of the procedure context the helper expects. Stays
 * structural so any tRPC ctx (or a unit-test fake) can pass.
 * `envelope` and `deviceId` are populated by the
 * `commandEnvelope` middleware () when the procedure runs
 * inside `criticalCommandProcedure`; otherwise they're undefined
 * (or `null` when the application services explicitly model
 * "envelope absent" as null instead of undefined).
 *
 * `idempotencyKey` is marked optional because the journal-only
 * envelope shape from `CompleteSaleContext` carries the
 * operationId without the idempotency key — the helper falls
 * back to `null` and the partial unique index simply does not
 * dedup that row.
 */
export interface EnqueueSyncContext {
  db: DatabaseInstance;
  tenantId: string;
  envelope?: {
    operationId: string;
    idempotencyKey?: string;
  } | null;
  deviceId?: string | null;
}

export interface EnqueueSyncArgs {
  entityType: SyncEntityType;
  entityId: string;
  operation: SyncOperation;
  /** Snapshot of the entity row at emit time. Stored as JSON. */
  data: Record<string, unknown>;
  /**
   * Optional override for the auto-resolved priority. Higher = drains
   * first. The manifest assigns a sensible default per entity
   * (audit_logs=10, money-bound=5, catalog=0).
   */
  priority?: number;
  /**
   * Soft FK to a different operation_events.operation_id. The
   * consumer must apply that operation BEFORE this row to avoid
   * referential integrity failures on the central server. Null when
   * this row stands alone.
   */
  dependsOnOperationId?: string | null;
}

export interface EnqueueSyncResult {
  id: string;
  /** True when an existing row was reused (idempotent retry). */
  deduped: boolean;
}

function resolveOperationEventId(ctx: EnqueueSyncContext): string | null {
  if (!ctx.envelope?.operationId) return null;

  const event = ctx.db
    .select({ id: operationEvents.id })
    .from(operationEvents)
    .where(
      and(
        eq(operationEvents.tenantId, ctx.tenantId),
        eq(operationEvents.operationId, ctx.envelope.operationId)
      )
    )
    .get();
  return event?.id ?? null;
}

/**
 * Canonical synchronous row writer shared by ordinary callers and callers
 * already inside a better-sqlite3 transaction. Keeping this layer free of
 * promises is what lets aggregate mutations commit their primary rows and
 * replication intent atomically.
 */
function writeSyncRow(
  ctx: EnqueueSyncContext,
  args: EnqueueSyncArgs,
  operationEventId: string | null
): EnqueueSyncResult {
  const conflictPolicy = resolveConflictPolicy(args.entityType);
  const priority =
    typeof args.priority === 'number' ? args.priority : resolveDefaultPriority(args.entityType);
  const idempotencyKey = ctx.envelope?.idempotencyKey ?? null;
  const deviceId = ctx.deviceId ?? null;
  const id = nanoid();
  const nowIso = new Date().toISOString();

  try {
    ctx.db
      .insert(syncOutbox)
      .values({
        id,
        tenantId: ctx.tenantId,
        status: 'queued',
        entityType: args.entityType,
        entityId: args.entityId,
        operation: args.operation,
        conflictPolicy,
        payload: args.data,
        payloadVersion: 1,
        idempotencyKey,
        deviceId,
        dependsOnOperationId: args.dependsOnOperationId ?? null,
        operationEventId,
        attempts: 0,
        priority,
        createdAt: nowIso,
        updatedAt: nowIso,
      })
      .run();
  } catch (err) {
    if (
      err instanceof Error &&
      /UNIQUE constraint failed.*sync_outbox/i.test(err.message) &&
      idempotencyKey
    ) {
      const existing = ctx.db
        .select({ id: syncOutbox.id })
        .from(syncOutbox)
        .where(
          and(
            eq(syncOutbox.tenantId, ctx.tenantId),
            eq(syncOutbox.entityType, args.entityType),
            eq(syncOutbox.entityId, args.entityId),
            eq(syncOutbox.operation, args.operation),
            eq(syncOutbox.idempotencyKey, idempotencyKey)
          )
        )
        .get();
      return { id: existing?.id ?? id, deduped: true };
    }
    throw err;
  }

  return { id, deduped: false };
}

/**
 * Enqueue an entity change for replication.
 *
 * Returns the row id and a `deduped` flag indicating whether the
 * unique index collapsed this call into an existing row (retry of
 * the same envelope). Callers MAY ignore the return; the helper
 * never throws on a duplicate — the row already exists.
 */
export async function enqueueSync(
  ctx: EnqueueSyncContext,
  args: EnqueueSyncArgs
): Promise<EnqueueSyncResult> {
  // Resolve the operation_event_id from the envelope's operationId.
  // The middleware wrote the row in `recordOperationStart` BEFORE
  // the procedure ran, so the lookup is safe here.
  const operationEventId = resolveOperationEventId(ctx);
  const result = writeSyncRow(ctx, args, operationEventId);

  // Best-effort journal effect. The sync row is the primary work;
  // a missing journal effect does not roll back the enqueue.
  if (operationEventId && !result.deduped) {
    try {
      await recordEffect(ctx.db, {
        operationEventId,
        kind: 'outbox_enqueue:sync',
        resourceType: 'sync_outbox',
        resourceId: result.id,
      });
    } catch {
      /* swallow — journal effect is best-effort */
    }
  }

  return result;
}

/**
 * Enqueue from inside an existing synchronous SQLite transaction.
 *
 * This deliberately writes only the authoritative outbox row. The operation
 * journal remains best-effort in `enqueueSync`; making that auxiliary effect
 * transaction-fatal would invert the service's documented failure policy.
 */
export function enqueueSyncInTransaction(
  ctx: EnqueueSyncContext,
  args: EnqueueSyncArgs
): EnqueueSyncResult {
  return writeSyncRow(ctx, args, resolveOperationEventId(ctx));
}
