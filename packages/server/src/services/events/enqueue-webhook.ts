/**
 * ENG-070 — `enqueueWebhook`: write a public event to webhook_outbox
 * with envelope-keyed idempotency.
 *
 * Mirror of `services/sync/enqueue.ts::enqueueSync` (ENG-064) and
 * `services/peripherals/enqueue-hardware.ts::enqueueHardware`
 * (ENG-067b). Captures the partial-unique-idx UNIQUE conflict and
 * returns `{deduped: true, id}` instead of throwing — a duplicate
 * envelope replay collapses to one row.
 *
 * Usage shape:
 *
 *   ```ts
 *   const result = enqueueWebhook(tx, {
 *     tenantId,
 *     event: projectedPublicEvent,
 *     idempotencyKey: ctx.envelope?.operationId ?? null,
 *   });
 *   ```
 *
 * The function is INTENTIONALLY synchronous to compose inside the
 * orchestrator's `db.transaction(writeTx => ...)` callback (sync
 * contract). The only outside-of-tx work is `nanoid()` which is
 * deterministic CPU.
 *
 * @module services/events/enqueue-webhook
 */

import { and, eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { webhookOutbox } from '../../db/schema.js';
import type { DatabaseInstance } from '../../db/index.js';
import type { PublicEvent } from './manifest.js';

export interface EnqueueWebhookArgs {
  tenantId: string;
  event: PublicEvent;
  /**
   * Envelope-keyed idempotency. Pass `ctx.envelope?.operationId`
   * (the command envelope's operationId) for command-driven events;
   * for the fiscal worker pass the `fiscal_documents.id` so two
   * worker passes against the same accepted document collapse to one
   * webhook row. Pass `null` to opt OUT of the partial unique idx
   * (admin-triggered replays).
   */
  idempotencyKey: string | null;
}

export interface EnqueueWebhookResult {
  /** Row id of the persisted (or pre-existing) webhook_outbox row. */
  id: string;
  /**
   * `true` when the partial unique idx caught an existing row with
   * the same `(tenant_id, event_type, idempotency_key)` tuple. The
   * caller can use this to decide whether to log a duplicate
   * (informational, not an error).
   */
  deduped: boolean;
}

/**
 * Enqueue a public event into webhook_outbox. Runs synchronously
 * inside the caller's db transaction.
 */
export function enqueueWebhook(
  tx: DatabaseInstance,
  args: EnqueueWebhookArgs
): EnqueueWebhookResult {
  const { tenantId, event, idempotencyKey } = args;
  const normalizedKey =
    typeof idempotencyKey === 'string' && idempotencyKey.length > 0
      ? idempotencyKey
      : null;

  const id = nanoid();
  const nowIso = new Date().toISOString();

  try {
    tx.insert(webhookOutbox)
      .values({
        id,
        tenantId,
        eventType: event.type,
        eventVersion: event.version,
        operationEventId: event.operationEventId,
        payload: event.payload,
        payloadVersion: 1,
        status: 'queued',
        attempts: 0,
        nextRetryAt: null,
        lastError: null,
        priority: 0,
        claimToken: null,
        lockedAt: null,
        idempotencyKey: normalizedKey,
        createdAt: nowIso,
        updatedAt: nowIso,
      })
      .run();
    return { id, deduped: false };
  } catch (err) {
    // Partial unique idx caught the duplicate. Look up the existing
    // row id so the caller can correlate.
    if (isUniqueViolation(err) && normalizedKey !== null) {
      const existing = lookupExisting(tx, tenantId, event.type, normalizedKey);
      if (existing) {
        return { id: existing, deduped: true };
      }
    }
    // Anything else (FK violation, unrelated constraint) re-throws so
    // the caller's tx rolls back cleanly.
    throw err;
  }
}

function isUniqueViolation(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) return false;
  const code = (err as { code?: string }).code;
  if (code === 'SQLITE_CONSTRAINT_UNIQUE' || code === 'SQLITE_CONSTRAINT') {
    return true;
  }
  const msg = (err as { message?: string }).message ?? '';
  return /UNIQUE constraint failed.*webhook_outbox/i.test(msg);
}

function lookupExisting(
  tx: DatabaseInstance,
  tenantId: string,
  eventType: string,
  idempotencyKey: string
): string | null {
  // Direct SQL lookup matching the partial idx tuple. Synchronous
  // better-sqlite3 select; safe inside the tx callback.
  const row = tx
    .select({ id: webhookOutbox.id })
    .from(webhookOutbox)
    .where(
      and(
        eq(webhookOutbox.tenantId, tenantId),
        eq(webhookOutbox.eventType, eventType),
        eq(webhookOutbox.idempotencyKey, idempotencyKey)
      )
    )
    .get();
  return row?.id ?? null;
}
