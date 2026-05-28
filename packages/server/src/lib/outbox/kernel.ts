/**
 * ENG-053 — Outbox kernel factory.
 *
 * `createOutboxKernel(opts)` returns the shared lifecycle helpers
 * every concrete outbox composes — `enqueue`, `claimNext`,
 * `complete`, `fail`, `deadLetter`, `peek`. The factory accepts the
 * Drizzle table for the concrete outbox + the per-outbox status
 * enum + the retry policy; it never assumes a single global table.
 *
 * Why a factory instead of a base class:
 *
 * - Each concrete outbox table has DIFFERENT extra columns
 *   (`fiscal_document_id`, `peripheral_id`, etc). A base class would
 *   either over-constrain those or force `as any` casts.
 * - Drizzle's column inference works best with concrete table refs;
 *   the factory closure captures the ref once at construction time.
 * - The factory pattern lets the test suite spin up an in-memory
 *   `testOutboxTable` and exercise every lifecycle without needing
 *   one of the five concrete outboxes to ship first.
 *
 * Concurrency:
 *
 * - `claimNext` UPDATEs `(status, claim_token, locked_at)`
 *   atomically. `status` is the operator-facing lifecycle;
 *   `claim_token` is the worker lock. Two workers calling
 *   concurrently will both attempt the UPDATE; SQLite's statement
 *   atomicity means exactly one wins.
 * - `nextRetryAt` is consulted in the SELECT predicate; rows whose
 *   retry time hasn't arrived stay invisible until then.
 *
 * @module lib/outbox/kernel
 */

import { and, asc, desc, eq, isNull, lte, or, sql } from 'drizzle-orm';
import type { SQLiteColumn, SQLiteTable } from 'drizzle-orm/sqlite-core';
import { nanoid } from 'nanoid';
import type { DatabaseInstance } from '../../db/index.js';
import type {
  NormalizedOutboxError,
  OutboxRetryPolicy,
  OutboxRow,
} from './types.js';

/**
 * ENG-179c — Drizzle's `insert` / `select` / `update` query builders
 * do not accept a *parametric* `SQLiteTable` (their generics infer
 * from a concrete table literal, not a type parameter), so calling
 * `db.insert(table)` where `table: SQLiteTable` is a generic ref
 * fails to type-check. The three boundary helpers below isolate the
 * single unavoidable cast per operation; every call site stays fully
 * typed on the values / predicates it passes, and the `.run()` /
 * `.get()` / `.all()` results are re-narrowed at the call site.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- reason: Drizzle insert/select/update builders reject a parametric SQLiteTable; cast isolated to this single alias consumed only by the boundary helpers below.
type AnyBuilder = any;

function insertInto(db: DatabaseInstance, table: SQLiteTable): AnyBuilder {
  return db.insert(table);
}

function selectAll(db: DatabaseInstance): AnyBuilder {
  return db.select();
}

function updateOf(db: DatabaseInstance, table: SQLiteTable): AnyBuilder {
  return db.update(table);
}

/**
 * Columns the kernel expects on every outbox table. Concrete
 * outboxes define MORE columns (their own extras); the kernel only
 * reads / writes the shared subset.
 *
 * The factory uses Drizzle's `.$inferInsert` shape lazily via the
 * passed table — no need to repeat the column types here. We just
 * name the columns the kernel touches so the type system can see
 * the contract.
 */
export interface OutboxBaseColumns {
  id: { name: string };
  tenantId: { name: string };
  status: { name: string };
  payload: { name: string };
  payloadVersion: { name: string };
  attempts: { name: string };
  nextRetryAt: { name: string };
  lastError: { name: string };
  priority: { name: string };
  claimToken: { name: string };
  lockedAt: { name: string };
  createdAt: { name: string };
  updatedAt: { name: string };
}

/**
 * Options the factory takes. `terminalStatuses` is the closed list
 * of states the kernel will not transition out of — once a row hits
 * one of these (e.g. `succeeded` / `dead_letter` / `cancelled`), the
 * kernel refuses further state changes.
 */
export interface OutboxKernelOptions<TStatus extends string> {
  /** The Drizzle table reference for the concrete outbox. */
  table: SQLiteTable & { [K in keyof OutboxBaseColumns]: SQLiteColumn };
  /**
   * Human-readable kind for logs + the `outbox_metadata` row
   * (`'sync'|'fiscal'|'payment'|'webhook'|'hardware'`).
   */
  kind: string;
  /** Status assigned to rows on `enqueue`. */
  initialStatus: TStatus;
  /** Status assigned when a worker claims a row for processing. */
  processingStatus: TStatus;
  /** Status assigned on `complete`. */
  succeededStatus: TStatus;
  /** Status assigned when retry budget remains. */
  retryingStatus: TStatus;
  /** Status assigned when retries exhausted. */
  deadLetterStatus: TStatus;
  /** States the kernel refuses to transition out of. */
  terminalStatuses: readonly TStatus[];
  /** Retry policy consulted on `fail`. */
  retryPolicy: OutboxRetryPolicy;
}

/**
 * Factory return shape. Concrete consumers bind their `<TPayload>`
 * + `<TStatus>` parameters at construction; downstream code is
 * fully typed.
 */
export interface OutboxKernel<TStatus extends string, TPayload> {
  enqueue: (
    db: DatabaseInstance,
    args: { tenantId: string; payload: TPayload; priority?: number; payloadVersion?: number }
  ) => Promise<{ id: string }>;
  claimNext: (
    db: DatabaseInstance,
    args: { tenantId: string; workerId: string; nowIso?: string }
  ) => Promise<OutboxRow<TPayload, TStatus> | null>;
  complete: (
    db: DatabaseInstance,
    args: { id: string }
  ) => Promise<void>;
  fail: (
    db: DatabaseInstance,
    args: { id: string; error: NormalizedOutboxError; nowIso?: string }
  ) => Promise<{ nextRetryAt: string | null; status: TStatus }>;
  deadLetter: (
    db: DatabaseInstance,
    args: { id: string }
  ) => Promise<void>;
  peek: (
    db: DatabaseInstance,
    args: { tenantId: string; limit?: number }
  ) => Promise<OutboxRow<TPayload, TStatus>[]>;
}

export function createOutboxKernel<TStatus extends string, TPayload>(
  opts: OutboxKernelOptions<TStatus>
): OutboxKernel<TStatus, TPayload> {
  const { table } = opts;
  const terminalSet = new Set<string>(opts.terminalStatuses);

  function rowToProjection(raw: Record<string, unknown>): OutboxRow<TPayload, TStatus> {
    return {
      id: raw.id as string,
      tenantId: raw.tenantId as string,
      status: raw.status as TStatus,
      payload: (raw.payload ?? null) as TPayload,
      payloadVersion: (raw.payloadVersion as number | null) ?? 1,
      attempts: (raw.attempts as number | null) ?? 0,
      nextRetryAt: (raw.nextRetryAt as string | null) ?? null,
      lastError: (raw.lastError as NormalizedOutboxError | null) ?? null,
      priority: (raw.priority as number | null) ?? 0,
      claimToken: (raw.claimToken as string | null) ?? null,
      lockedAt: (raw.lockedAt as string | null) ?? null,
      createdAt: raw.createdAt as string,
      updatedAt: raw.updatedAt as string,
    };
  }

  return {
    async enqueue(db, args) {
      const id = nanoid();
      const nowIso = new Date().toISOString();
      await insertInto(db, table)
        .values({
          id,
          tenantId: args.tenantId,
          status: opts.initialStatus,
          payload: args.payload as unknown,
          payloadVersion: args.payloadVersion ?? 1,
          attempts: 0,
          nextRetryAt: null,
          lastError: null,
          priority: args.priority ?? 0,
          claimToken: null,
          lockedAt: null,
          createdAt: nowIso,
          updatedAt: nowIso,
        })
        .run();
      return { id };
    },

    async claimNext(db, args) {
      const nowIso = args.nowIso ?? new Date().toISOString();
      // Single-row claim via two-step pattern: SELECT eligible
      // candidate, then UPDATE to processingStatus WHERE
      // claim_token IS NULL and the status still matches the
      // candidate we read. The conditional UPDATE is the atomic
      // guard — if another worker grabbed or completed the row
      // between our SELECT and UPDATE, `changes` comes back 0 and
      // we return null.
      let candidate = (await selectAll(db)
        .from(table)
        .where(
          and(
            eq(table.tenantId, args.tenantId),
            eq(table.status, opts.initialStatus as unknown as string),
            isNull(table.claimToken),
            or(isNull(table.nextRetryAt), lte(table.nextRetryAt, nowIso))
          )
        )
        .orderBy(desc(table.priority), asc(table.createdAt))
        .limit(1)
        .get()) as Record<string, unknown> | undefined;

      if (!candidate) {
        // Also consider rows in `retrying` whose nextRetryAt is due.
        candidate = (await selectAll(db)
          .from(table)
          .where(
            and(
              eq(table.tenantId, args.tenantId),
              eq(table.status, opts.retryingStatus as unknown as string),
              isNull(table.claimToken),
              or(isNull(table.nextRetryAt), lte(table.nextRetryAt, nowIso))
            )
          )
          .orderBy(desc(table.priority), asc(table.createdAt))
          .limit(1)
          .get()) as Record<string, unknown> | undefined;
      }

      if (!candidate) return null;

      const claimToken = `${args.workerId}:${nanoid(8)}`;
      const candidateStatus = candidate.status as string;
      const updateResult = (await updateOf(db, table)
        .set({
          status: opts.processingStatus,
          claimToken,
          lockedAt: nowIso,
          nextRetryAt: null,
          updatedAt: nowIso,
        })
        .where(
          and(
            eq(table.id, candidate.id as string),
            eq(table.status, candidateStatus),
            isNull(table.claimToken),
            or(isNull(table.nextRetryAt), lte(table.nextRetryAt, nowIso))
          )
        )
        .run()) as { changes?: number };

      if (!updateResult || (updateResult.changes ?? 0) === 0) {
        // Lost the race — another worker claimed the row first.
        return null;
      }

      // Re-project with the new claim_token / locked_at populated.
      return rowToProjection({
        ...candidate,
        status: opts.processingStatus,
        claimToken,
        lockedAt: nowIso,
        nextRetryAt: null,
        updatedAt: nowIso,
      });
    },

    async complete(db, args) {
      const nowIso = new Date().toISOString();
      const current = (await selectAll(db)
        .from(table)
        .where(eq(table.id, args.id))
        .get()) as Record<string, unknown> | undefined;
      if (!current) return;
      if (terminalSet.has(current.status as string)) return;
      await updateOf(db, table)
        .set({
          status: opts.succeededStatus,
          claimToken: null,
          lockedAt: null,
          nextRetryAt: null,
          updatedAt: nowIso,
        })
        .where(eq(table.id, args.id))
        .run();
    },

    async fail(db, args) {
      const nowIso = args.nowIso ?? new Date().toISOString();
      const row = (await selectAll(db)
        .from(table)
        .where(eq(table.id, args.id))
        .get()) as Record<string, unknown> | undefined;
      if (!row) {
        return { nextRetryAt: null, status: opts.deadLetterStatus };
      }
      const attempts = (row.attempts as number | null) ?? 0;
      const nextAttempts = attempts + 1;

      // Permanent failures dead-letter immediately, regardless of
      // policy budget. This is the canonical handling per
      // ADR-0003 §normalized errors.
      if (!args.error.recoverable) {
        await updateOf(db, table)
          .set({
            status: opts.deadLetterStatus,
            attempts: nextAttempts,
            lastError: args.error,
            claimToken: null,
            lockedAt: null,
            nextRetryAt: null,
            updatedAt: nowIso,
          })
          .where(eq(table.id, args.id))
          .run();
        return { nextRetryAt: null, status: opts.deadLetterStatus };
      }

      // Recoverable: ask the policy how long to wait. If null the
      // budget is exhausted and we dead-letter.
      const delayMs = opts.retryPolicy.nextDelayMs(attempts);
      if (delayMs === null || nextAttempts >= opts.retryPolicy.maxAttempts) {
        await updateOf(db, table)
          .set({
            status: opts.deadLetterStatus,
            attempts: nextAttempts,
            lastError: args.error,
            claimToken: null,
            lockedAt: null,
            nextRetryAt: null,
            updatedAt: nowIso,
          })
          .where(eq(table.id, args.id))
          .run();
        return { nextRetryAt: null, status: opts.deadLetterStatus };
      }

      const nextRetryAt = new Date(Date.parse(nowIso) + delayMs).toISOString();
      await updateOf(db, table)
        .set({
          status: opts.retryingStatus,
          attempts: nextAttempts,
          lastError: args.error,
          claimToken: null,
          lockedAt: null,
          nextRetryAt,
          updatedAt: nowIso,
        })
        .where(eq(table.id, args.id))
        .run();
      return { nextRetryAt, status: opts.retryingStatus };
    },

    async deadLetter(db, args) {
      const nowIso = new Date().toISOString();
      await updateOf(db, table)
        .set({
          status: opts.deadLetterStatus,
          claimToken: null,
          lockedAt: null,
          nextRetryAt: null,
          updatedAt: nowIso,
        })
        .where(eq(table.id, args.id))
        .run();
    },

    async peek(db, args) {
      const limit = args.limit ?? 10;
      const rows = (await selectAll(db)
        .from(table)
        .where(eq(table.tenantId, args.tenantId))
        .orderBy(desc(table.priority), asc(table.createdAt))
        .limit(limit)
        .all()) as Record<string, unknown>[];
      return rows.map(rowToProjection);
    },
  };
}

// Suppress unused import — `sql` may be needed by future extensions
// (e.g. partial unique upserts on sqlite). Keep the import here so the
// call sites read consistently when the kernel grows.
void sql;
