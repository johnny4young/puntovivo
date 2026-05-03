/**
 * ENG-052 — Idempotency key persistence + atomic reservation logic.
 *
 * Critical commands must reserve `(tenantId, deviceId, idempotencyKey,
 * operationKind)` before the procedure body runs. The composite unique
 * index makes that reservation atomic: concurrent same-key retries cannot
 * both pass the guard and execute the command.
 *
 * Rules (per ADR-0002):
 *
 * 1. **Reserve**: first caller inserts `status='processing'`.
 * 2. **Replay while processing** with matching `request_hash` →
 *    caller raises `COMMAND_IN_PROGRESS`; the procedure is NOT invoked.
 * 3. **Replay after success** with matching `request_hash` → return
 *    cached `result_ref`; the procedure is NOT invoked.
 * 4. **Replay with mismatched `request_hash`** → caller raises
 *    `IDEMPOTENCY_KEY_CONFLICT` with both hashes in `details`.
 * 5. **Expired rows** are treated as misses. **Failed rows** are
 *    retryable for the same payload and replaced lazily.
 *
 * Default TTL: 24 hours. POS retry windows are short; a cashier does
 * not retry a sale from yesterday. Tenants that need longer windows
 * configure via `tenants.settings.idempotency_ttl_hours` (out of
 * scope for ENG-052 — uses the default).
 *
 * @module services/idempotency/idempotencyService
 */

import { and, eq, lte } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import type { DatabaseInstance } from '../../db/index.js';
import { idempotencyKeys, type IdempotencyKey } from '../../db/schema.js';
import { createModuleLogger } from '../../logging/logger.js';

const log = createModuleLogger('idempotency');

/** Default TTL for idempotency entries — 24 hours. */
export const IDEMPOTENCY_DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;

export interface IdempotencyKeyLookupInput {
  tenantId: string;
  deviceId: string;
  idempotencyKey: string;
  operationKind: string;
}

export interface IdempotencyKeyReservationInput extends IdempotencyKeyLookupInput {
  requestHash: string;
  /** Override the default 24h TTL. Tests use this to assert expiry behavior. */
  ttlMs?: number;
}

export interface IdempotencyKeyCompleteInput extends IdempotencyKeyLookupInput {
  reservationId: string;
  requestHash: string;
  /** Procedure return value to cache. Stored as JSON. */
  resultRef: unknown;
  /** Optional TTL refresh when completing a reservation. */
  ttlMs?: number;
}

export interface IdempotencyKeyFailInput extends IdempotencyKeyLookupInput {
  reservationId: string;
  requestHash: string;
}

export type IdempotencyReservation =
  | { state: 'reserved'; reservationId: string; requestHash: string; expiresAt: string }
  | {
      state: 'cached';
      requestHash: string;
      resultRef: unknown;
      storedAt: string;
      completedAt: string | null;
      expiresAt: string;
    }
  | {
      state: 'processing';
      reservationId: string;
      requestHash: string;
      lockedAt: string;
      expiresAt: string;
    }
  | {
      state: 'conflict';
      storedHash: string;
      providedHash: string;
      status: IdempotencyKey['status'];
    };

function idempotencyPredicate(input: IdempotencyKeyLookupInput) {
  return and(
    eq(idempotencyKeys.tenantId, input.tenantId),
    eq(idempotencyKeys.deviceId, input.deviceId),
    eq(idempotencyKeys.idempotencyKey, input.idempotencyKey),
    eq(idempotencyKeys.operationKind, input.operationKind)
  );
}

function isExpired(row: Pick<IdempotencyKey, 'expiresAt'>, now: Date): boolean {
  return row.expiresAt <= now.toISOString();
}

function isUniqueConstraintError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const code = 'code' in error ? (error as { code?: unknown }).code : undefined;
  const message = error instanceof Error ? error.message : '';
  return (
    code === 'SQLITE_CONSTRAINT' ||
    code === 'SQLITE_CONSTRAINT_UNIQUE' ||
    message.includes('UNIQUE constraint failed')
  );
}

async function findRow(
  db: DatabaseInstance,
  input: IdempotencyKeyLookupInput
): Promise<IdempotencyKey | undefined> {
  return db
    .select()
    .from(idempotencyKeys)
    .where(idempotencyPredicate(input))
    .get();
}

async function insertProcessing(
  db: DatabaseInstance,
  input: IdempotencyKeyReservationInput,
  now: Date
): Promise<{ reservationId: string; requestHash: string; expiresAt: string }> {
  const ttlMs = input.ttlMs ?? IDEMPOTENCY_DEFAULT_TTL_MS;
  const lockedAt = now.toISOString();
  const expiresAt = new Date(now.getTime() + ttlMs).toISOString();
  const reservationId = nanoid();

  await db.insert(idempotencyKeys).values({
    id: reservationId,
    tenantId: input.tenantId,
    deviceId: input.deviceId,
    idempotencyKey: input.idempotencyKey,
    operationKind: input.operationKind,
    requestHash: input.requestHash,
    status: 'processing',
    resultRef: null,
    lockedAt,
    completedAt: null,
    createdAt: lockedAt,
    expiresAt,
  });

  return { reservationId, requestHash: input.requestHash, expiresAt };
}

async function replaceRetryableRow(
  db: DatabaseInstance,
  input: IdempotencyKeyReservationInput,
  now: Date,
  rowId: string
): Promise<IdempotencyReservation> {
  await db
    .delete(idempotencyKeys)
    .where(and(idempotencyPredicate(input), eq(idempotencyKeys.id, rowId)));
  try {
    const inserted = await insertProcessing(db, input, now);
    return { state: 'reserved', ...inserted };
  } catch (error) {
    if (!isUniqueConstraintError(error)) throw error;
    const row = await findRow(db, input);
    if (!row) throw error;
    return classifyExistingRow(row, input, now);
  }
}

function classifyExistingRow(
  row: IdempotencyKey,
  input: IdempotencyKeyReservationInput,
  now: Date
): IdempotencyReservation {
  if (row.requestHash !== input.requestHash) {
    return {
      state: 'conflict',
      storedHash: row.requestHash,
      providedHash: input.requestHash,
      status: row.status,
    };
  }

  if (row.status === 'succeeded') {
    return {
      state: 'cached',
      requestHash: row.requestHash,
      resultRef: row.resultRef,
      storedAt: row.createdAt,
      completedAt: row.completedAt,
      expiresAt: row.expiresAt,
    };
  }

  if (!isExpired(row, now) && row.status === 'processing') {
    return {
      state: 'processing',
      reservationId: row.id,
      requestHash: row.requestHash,
      lockedAt: row.lockedAt,
      expiresAt: row.expiresAt,
    };
  }

  // Failed rows that race with a replacement stay non-terminal for the
  // caller. The idempotency table is not the audit trail; ENG-053 will
  // persist richer operation failures in the journal.
  return {
    state: 'processing',
    reservationId: row.id,
    requestHash: row.requestHash,
    lockedAt: row.lockedAt,
    expiresAt: row.expiresAt,
  };
}

/**
 * Atomically reserve an idempotency key. The first caller gets
 * `state='reserved'`; concurrent same-key callers get `state='processing'`
 * until the first caller completes the key.
 */
export async function reserveKey(
  db: DatabaseInstance,
  input: IdempotencyKeyReservationInput,
  now: Date = new Date()
): Promise<IdempotencyReservation> {
  try {
    const inserted = await insertProcessing(db, input, now);
    return { state: 'reserved', ...inserted };
  } catch (error) {
    if (!isUniqueConstraintError(error)) throw error;
  }

  const row = await findRow(db, input);
  if (!row) {
    // A competing cleanup may have removed the row after the unique
    // conflict. Retry once on the normal insert path.
    const inserted = await insertProcessing(db, input, now);
    return { state: 'reserved', ...inserted };
  }

  if (isExpired(row, now)) {
    return replaceRetryableRow(db, input, now, row.id);
  }

  if (row.status === 'failed' && row.requestHash === input.requestHash) {
    return replaceRetryableRow(db, input, now, row.id);
  }

  return classifyExistingRow(row, input, now);
}

/**
 * Mark a reserved key as successful and attach the canonical procedure
 * result. Returns false if the reservation no longer matches the caller.
 */
export async function completeKey(
  db: DatabaseInstance,
  input: IdempotencyKeyCompleteInput,
  now: Date = new Date()
): Promise<boolean> {
  const ttlMs = input.ttlMs ?? IDEMPOTENCY_DEFAULT_TTL_MS;
  const completedAt = now.toISOString();
  const expiresAt = new Date(now.getTime() + ttlMs).toISOString();
  const current = await findRow(db, input);
  if (
    !current ||
    current.id !== input.reservationId ||
    current.requestHash !== input.requestHash ||
    current.status !== 'processing'
  ) {
    return false;
  }

  await db
    .update(idempotencyKeys)
    .set({
      status: 'succeeded',
      resultRef: input.resultRef,
      completedAt,
      expiresAt,
    })
    .where(
      and(
        idempotencyPredicate(input),
        eq(idempotencyKeys.id, input.reservationId)
      )
    );
  return true;
}

/**
 * Mark a reserved key as failed. A later retry with the same payload can
 * replace this row with a new processing reservation.
 */
export async function failKey(
  db: DatabaseInstance,
  input: IdempotencyKeyFailInput,
  now: Date = new Date()
): Promise<void> {
  await db
    .update(idempotencyKeys)
    .set({
      status: 'failed',
      completedAt: now.toISOString(),
    })
    .where(
      and(
        idempotencyPredicate(input),
        eq(idempotencyKeys.id, input.reservationId),
        eq(idempotencyKeys.requestHash, input.requestHash),
        eq(idempotencyKeys.status, 'processing')
      )
    );
}

/**
 * Background sweep that deletes rows past `expires_at`. Returns the
 * count of removed rows so the caller can log it.
 */
export async function cleanupExpired(
  db: DatabaseInstance,
  now: Date = new Date()
): Promise<number> {
  const cutoff = now.toISOString();
  const before = await db
    .select({ id: idempotencyKeys.id })
    .from(idempotencyKeys)
    .where(lte(idempotencyKeys.expiresAt, cutoff))
    .all();
  if (before.length === 0) return 0;

  await db.delete(idempotencyKeys).where(lte(idempotencyKeys.expiresAt, cutoff));
  log.debug({ removed: before.length }, 'idempotency cleanup swept expired rows');
  return before.length;
}
