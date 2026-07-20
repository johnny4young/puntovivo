/**
 * Operation journal service.
 *
 * The journal closes the loop opened by : every critical
 * mutation that flows through `commandEnvelope` produces a row in
 * `operation_events`, possibly with one or more `operation_effects`
 * (audit log emissions, sync queue pushes, fiscal outbox enqueues,
 * inventory movements) and any `operation_errors` from post-commit
 * failures that did NOT roll back the primary work.
 *
 * Lifecycle for a single click:
 *
 * 1. `commandEnvelope` middleware reserves the idempotency key.
 * 2. `recordOperationStart` writes the `operation_events` row
 * with `status='started'`. Idempotent on `(tenant_id,
 * operation_id)` — replay-cached calls reuse the existing row.
 * 3. The procedure runs inside its own DB transaction. Audit logs
 * written during this transaction reference `operation_id`
 * directly via `audit_logs.operation_id`.
 * 4. On success: services emit `recordEffect` for each meaningful
 * side effect (one row per audit log write, one per sync queue
 * emission, etc.). The middleware then calls
 * `markOperationCompleted(eventId, 'succeeded')`.
 * 5. On primary failure: the middleware catches, calls
 * `recordError` with the typed code, then
 * `markOperationCompleted(eventId, 'failed')`. The procedure
 * rolled back its transaction, so no effects exist.
 * 6. On post-commit failure (e.g. a future `fiscal_outbox` push
 * fails AFTER the sale committed): the post-commit hook calls
 * `recordError` and `markOperationCompleted(eventId,
 * 'partial')`. The original work stays intact; the operator
 * retries the missing fan-out from the Operations Center.
 *
 * Design constraints documented per ADR-0001 / ADR-0002 / ADR-0003:
 *
 * - All writes are tenant-scoped via the rows themselves; query
 * helpers require a `tenantId` argument explicitly so cross-tenant
 * lookups are physically impossible at this layer.
 * - `recordEffect` and `recordError` are best-effort POST-procedure
 * helpers — the journal MUST NEVER cause a rollback of the
 * primary work it's recording. Callers should wrap them in
 * try/catch where the catch is "log and continue".
 * - The service has zero tRPC surface — it's a backend primitive.
 * (Operations Center) exposes `getOperationTrail` via a
 * read-only procedure when the time comes.
 *
 * @module services/operation-journal
 */

import { and, asc, eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import type { DatabaseInstance } from '../../db/index.js';
import {
  operationEffects,
  operationErrors,
  operationEvents,
  tenants,
  type OperationEventStatus,
} from '../../db/schema.js';
import { createModuleLogger } from '../../logging/logger.js';
import { enqueueWebhook } from '../events/enqueue-webhook.js';
import { projectOperationEvent } from '../events/projector.js';
import { isModuleActiveInSettings } from '../modules/manifest.js';

const log = createModuleLogger('operation-journal');

/** Resolved row type from the events table. */
export type OperationEvent = typeof operationEvents.$inferSelect;
/** Resolved row type from the effects table. */
export type OperationEffect = typeof operationEffects.$inferSelect;
/** Resolved row type from the errors table. */
export type OperationError = typeof operationErrors.$inferSelect;

export interface RecordStartArgs {
  tenantId: string;
  operationId: string;
  operationKind: string;
  deviceId: string;
  userId: string;
  requestHash: string;
  /** Free-form bag for forensics (sale id, total, etc.). */
  summary?: Record<string, unknown> | null;
}

export interface RecordEffectArgs {
  operationEventId: string;
  /**
   * What kind of effect this row records. Stable string vocabulary:
   * `audit_log`, `outbox_enqueue:{kind}` (e.g. `outbox_enqueue:sync`),
   * `fiscal_emit`, `inventory_movement`, `cash_movement`, `sale_row`,
   * `payment_row`, `transfer_row`, etc. The Operations Center
   * renders effects grouped by `kind`.
   */
  kind: string;
  /** Drizzle table name of the affected row. */
  resourceType: string;
  /** Primary key of the affected row. */
  resourceId: string;
  /** Optional free-form payload for forensics / debugging. */
  effectData?: Record<string, unknown> | null;
}

export interface RecordErrorArgs {
  operationEventId: string;
  /** Stable error code (matches `KNOWN_SERVER_ERROR_CODES` when applicable). */
  errorCode: string;
  /** Operator-facing message. */
  message: string;
  /**
   * `true` if the error is worth retrying (provider 5xx, network
   * timeout). `false` for permanent rejections.
   */
  recoverable: boolean;
  /** Free-form forensics blob (raw provider response, etc.). */
  errorData?: Record<string, unknown> | null;
}

/**
 * Insert (or no-op on conflict) the operation start row.
 *
 * The composite UNIQUE on `(tenant_id, operation_id)` makes the
 * insert idempotent — a replay-cached call from `commandEnvelope`
 * reuses the existing row instead of creating a second one.
 *
 * Returns `isNew: true` when this call actually inserted; `false`
 * when an existing row was reused. Callers can use this to decide
 * whether to emit a duplicate-event log line.
 */
export async function recordOperationStart(
  db: DatabaseInstance,
  args: RecordStartArgs
): Promise<{ eventId: string; isNew: boolean }> {
  const existing = await db
    .select({ id: operationEvents.id })
    .from(operationEvents)
    .where(
      and(
        eq(operationEvents.tenantId, args.tenantId),
        eq(operationEvents.operationId, args.operationId)
      )
    )
    .get();

  if (existing) {
    return { eventId: existing.id, isNew: false };
  }

  const id = nanoid();
  const nowIso = new Date().toISOString();
  await db
    .insert(operationEvents)
    .values({
      id,
      tenantId: args.tenantId,
      operationId: args.operationId,
      operationKind: args.operationKind,
      deviceId: args.deviceId,
      userId: args.userId,
      status: 'started',
      requestHash: args.requestHash,
      summary: args.summary ?? null,
      startedAt: nowIso,
      completedAt: null,
      createdAt: nowIso,
    })
    .run();
  return { eventId: id, isNew: true };
}

/**
 * Attach or replace the operation summary before the middleware marks
 * the operation as succeeded. Critical command middleware creates the
 * row before the procedure body runs, so use-case services fill this
 * once they know the persisted resource ids and totals needed by
 * downstream projectors.
 */
export async function updateOperationSummary(
  db: DatabaseInstance,
  operationEventId: string,
  summary: Record<string, unknown>
): Promise<void> {
  await db
    .update(operationEvents)
    .set({ summary })
    .where(eq(operationEvents.id, operationEventId))
    .run();
}

/**
 * Record a single effect produced by an operation. Safe to call
 * multiple times per operation. The FK to `operation_events` is
 * enforced at the schema level — passing an unknown
 * `operationEventId` raises an error the caller should log and
 * swallow (the primary work is already done; the journal effect is
 * best-effort).
 */
export async function recordEffect(
  db: DatabaseInstance,
  args: RecordEffectArgs
): Promise<{ effectId: string }> {
  const id = nanoid();
  const nowIso = new Date().toISOString();
  await db
    .insert(operationEffects)
    .values({
      id,
      operationEventId: args.operationEventId,
      kind: args.kind,
      resourceType: args.resourceType,
      resourceId: args.resourceId,
      effectData: args.effectData ?? null,
      createdAt: nowIso,
    })
    .run();
  return { effectId: id };
}

/**
 * Record a failure attributable to an operation. Used in two
 * places:
 *
 * - From `commandEnvelope` middleware when the procedure throws
 * (primary failure, with rollback).
 * - From a post-commit fan-out helper when a downstream step fails
 * AFTER the primary committed (partial completion, no rollback).
 *
 * The caller distinguishes the two by also calling
 * `markOperationCompleted` with `'failed'` (primary failure) vs
 * `'partial'` (post-commit failure with surviving primary work).
 */
export async function recordError(
  db: DatabaseInstance,
  args: RecordErrorArgs
): Promise<{ errorId: string }> {
  const id = nanoid();
  const nowIso = new Date().toISOString();
  await db
    .insert(operationErrors)
    .values({
      id,
      operationEventId: args.operationEventId,
      errorCode: args.errorCode,
      message: args.message,
      recoverable: args.recoverable,
      errorData: args.errorData ?? null,
      createdAt: nowIso,
    })
    .run();
  return { errorId: id };
}

/**
 * Transition the event row to a terminal status. Idempotent: if the
 * row is already in `status` the function is a no-op. Refuses to
 * transition out of a terminal state to a different terminal state
 * (e.g. `succeeded` → `failed` is rejected silently with a warn
 * log) — that would imply the call site is racing.
 */
export async function markOperationCompleted(
  db: DatabaseInstance,
  eventId: string,
  status: Exclude<OperationEventStatus, 'started'>
): Promise<void> {
  const current = await db
    .select({ status: operationEvents.status })
    .from(operationEvents)
    .where(eq(operationEvents.id, eventId))
    .get();
  if (!current) {
    log.warn({ eventId, status }, 'markOperationCompleted called on missing event');
    return;
  }
  if (current.status !== 'started') {
    if (current.status !== status) {
      log.warn(
        { eventId, currentStatus: current.status, attemptedStatus: status },
        'refusing to transition operation_events out of terminal state'
      );
    }
    return;
  }

  const nowIso = new Date().toISOString();
  await db
    .update(operationEvents)
    .set({ status, completedAt: nowIso })
    .where(eq(operationEvents.id, eventId))
    .run();

  // Public events projection. Best-effort hook: only fires
  // on succeeded transitions, only when the tenant has the
  // `events-api` module ON, only enqueues when the projector returns
  // a valid event. Never throws past the hook — a webhook projection
  // failure must NEVER fail the original commit.
  if (status === 'succeeded') {
    try {
      await projectAndEnqueueWebhook(db, eventId);
    } catch (err) {
      log.warn({ err, eventId }, 'webhook projection hook failed (non-blocking)');
    }
  }
}

/**
 * Internal helper: read the freshly-completed
 * operation_events row, project it to a public event, and enqueue
 * into webhook_outbox if the tenant has events-api active.
 *
 * Pure best-effort: every short-circuit returns silently so the
 * caller's commit is never blocked. The function lives in the
 * journal module so the import cycle stays shallow (events imports
 * journal types; journal imports events helpers).
 */
async function projectAndEnqueueWebhook(db: DatabaseInstance, eventId: string): Promise<void> {
  const op = await db.select().from(operationEvents).where(eq(operationEvents.id, eventId)).get();
  if (!op) {
    return;
  }

  const projected = projectOperationEvent({ op });
  if (!projected) {
    return;
  }

  // Read the tenant's settings to decide whether events-api is on.
  // Single indexed read on the tenants PK; sub-millisecond.
  const tenant = await db
    .select({ settings: tenants.settings })
    .from(tenants)
    .where(eq(tenants.id, op.tenantId))
    .get();
  if (!tenant) {
    return;
  }
  if (!isModuleActiveInSettings(tenant.settings, 'events-api')) {
    return;
  }

  // Synchronous enqueue inside a fresh tx. The partial unique idx
  // collapses duplicate envelope replays (same operationId → same
  // idempotency key → same row).
  db.transaction(tx => {
    enqueueWebhook(tx, {
      tenantId: op.tenantId,
      event: projected,
      idempotencyKey: op.operationId,
    });
  });
}

/**
 * Read the full trail for a single operation: event row + ordered
 * effects + ordered errors. Returns `null` when no event row
 * exists for `(tenantId, operationId)`. Used for forensics and by
 * the future Operations Center detail view.
 */
export async function getOperationTrail(
  db: DatabaseInstance,
  args: { tenantId: string; operationId: string }
): Promise<{
  event: OperationEvent;
  effects: OperationEffect[];
  errors: OperationError[];
} | null> {
  const event = await db
    .select()
    .from(operationEvents)
    .where(
      and(
        eq(operationEvents.tenantId, args.tenantId),
        eq(operationEvents.operationId, args.operationId)
      )
    )
    .get();
  if (!event) return null;

  const effects = await db
    .select()
    .from(operationEffects)
    .where(eq(operationEffects.operationEventId, event.id))
    .orderBy(asc(operationEffects.createdAt))
    .all();

  const errors = await db
    .select()
    .from(operationErrors)
    .where(eq(operationErrors.operationEventId, event.id))
    .orderBy(asc(operationErrors.createdAt))
    .all();

  return { event, effects, errors };
}
