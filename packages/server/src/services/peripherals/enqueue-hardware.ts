/**
 * ENG-067b — `enqueueHardware` helper.
 *
 * Single entry point for every router that enqueues a hardware
 * dispatch (print job, drawer kick) into `hardware_outbox`. Replaces
 * the inline `db.insert(hardwareOutbox).values({...})` pattern that
 * `peripherals.printReceipt` + `peripherals.kickCashDrawer` used
 * before this ticket.
 *
 * The helper closes the dedup gap that ENG-067's chaos suite
 * documented: a tRPC retry after a network blip, an offline-buffered
 * replay, or a worker reboot via stale-claim sweep used to land TWO
 * rows in the outbox with the same logical envelope, and the worker
 * dispatched both — receipt prints twice, drawer kicks twice.
 *
 * Behavior mirrors `services/sync/enqueue.ts::enqueueSync`:
 *
 *   1. Try insert. The partial unique idx
 *      `(tenant_id, kind, idempotency_key) WHERE idempotency_key IS NOT NULL`
 *      from migration 0018 collapses idempotent retries.
 *   2. SQLite reports the conflict with a UNIQUE constraint failure.
 *      Catch + look up the existing row by
 *      `(tenantId, kind, idempotencyKey)` and return
 *      `{id, deduped: true}`. Other errors rethrow.
 *   3. Callers without an envelope key omit `idempotencyKey` (or
 *      pass `null`) — the partial idx ignores those rows so the
 *      legacy "user pressed Print twice → two prints" path stays.
 *
 * The procedure decorator on the call sites stays
 * `tenantProcedure` / `managerOrAdminProcedure` — the key is opt-in
 * via the input schema, NOT an envelope-middleware upgrade. A future
 * ticket can promote the procedures to `criticalCommandProcedure`
 * when the UI wave catches up.
 *
 * @module services/peripherals/enqueue-hardware
 */

import { and, eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import type { DatabaseInstance } from '../../db/index.js';
import {
  hardwareOutbox,
  type HardwareOutboxKind,
  type HardwareOutboxStatus,
} from '../../db/schema.js';

/**
 * Shape of the procedure context the helper expects. Stays
 * structural so any tRPC ctx (or a unit-test fake) can pass.
 */
export interface EnqueueHardwareContext {
  db: DatabaseInstance;
  tenantId: string;
}

/**
 * Best-effort normalization of a transport-level error captured at
 * enqueue time. Stored as JSON in `last_error`.
 */
export interface NormalizedHardwareErrorInput {
  errorCode?: string;
  providerMessage?: string;
  recoverable?: boolean;
}

export interface EnqueueHardwareArgs {
  kind: HardwareOutboxKind;
  /**
   * The peripheral row this dispatch targets. Nullable to mirror the
   * column's `set null` cascade — the worker treats null as
   * "peripheral was unregistered" and dead-letters.
   */
  peripheralId: string | null;
  /** Snapshot of the print job + transport opts so the worker can retry. */
  payload: Record<string, unknown>;
  payloadVersion?: number;
  /**
   * Initial transition state. Most callers pass `'queued'`; the
   * existing fallback paths in `routers/peripherals.ts` pass
   * `'retrying'` with `attempts=1` + a populated `lastError`.
   */
  status?: HardwareOutboxStatus;
  attempts?: number;
  nextRetryAt?: string | null;
  lastError?: NormalizedHardwareErrorInput | null;
  priority?: number;
  /**
   * Envelope-derived idempotency key. When provided AND the partial
   * unique idx collides, returns the existing row id with
   * `{deduped: true}`. Null / undefined / empty string → no dedup,
   * fresh row.
   */
  idempotencyKey?: string | null;
}

export interface EnqueueHardwareResult {
  id: string;
  /** True when an existing row was reused (idempotent retry). */
  deduped: boolean;
}

/**
 * Enqueue a hardware dispatch for the worker to drain.
 *
 * Returns the row id and a `deduped` flag indicating whether the
 * unique index collapsed this call into an existing row. Callers MAY
 * ignore the return; the helper never throws on an idempotent
 * duplicate — the row already exists.
 */
export async function enqueueHardware(
  ctx: EnqueueHardwareContext,
  args: EnqueueHardwareArgs
): Promise<EnqueueHardwareResult> {
  // Treat empty string + undefined the same as null — the partial
  // unique idx clause is `WHERE idempotency_key IS NOT NULL`, so we
  // normalize anything falsy to null to keep the contract clean.
  const idempotencyKey =
    args.idempotencyKey && args.idempotencyKey.length > 0
      ? args.idempotencyKey
      : null;

  const id = nanoid();
  const nowIso = new Date().toISOString();

  try {
    await ctx.db.insert(hardwareOutbox).values({
      id,
      tenantId: ctx.tenantId,
      status: args.status ?? 'queued',
      kind: args.kind,
      peripheralId: args.peripheralId,
      payload: args.payload,
      payloadVersion: args.payloadVersion ?? 1,
      attempts: args.attempts ?? 0,
      nextRetryAt: args.nextRetryAt ?? null,
      lastError: args.lastError
        ? (args.lastError as Record<string, unknown>)
        : null,
      priority: args.priority ?? 0,
      idempotencyKey,
      createdAt: nowIso,
      updatedAt: nowIso,
    });
  } catch (err) {
    if (
      err instanceof Error &&
      /UNIQUE constraint failed.*hardware_outbox/i.test(err.message) &&
      idempotencyKey
    ) {
      const existing = await ctx.db
        .select({ id: hardwareOutbox.id })
        .from(hardwareOutbox)
        .where(
          and(
            eq(hardwareOutbox.tenantId, ctx.tenantId),
            eq(hardwareOutbox.kind, args.kind),
            eq(hardwareOutbox.idempotencyKey, idempotencyKey)
          )
        )
        .get();
      return { id: existing?.id ?? id, deduped: true };
    }
    throw err;
  }

  return { id, deduped: false };
}
