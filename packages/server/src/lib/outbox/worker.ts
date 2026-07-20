/**
 * Outbox worker base class.
 *
 * Concrete outboxes wire their kernel + processor function via this
 * base class. The `tick()` method runs one claim → process →
 * complete | fail cycle. Long-running daemons call `tick()` in a
 * loop (every N seconds); on-demand processors call it once after
 * an enqueue.
 *
 * The class is intentionally agnostic of the wall-clock loop. The
 * decision to use setInterval, a Bull-style scheduler, or a Fastify
 * job hook lives in the consumer's wiring (e.g.  will run
 * the fiscal worker on a 30s interval;  will run the payment
 * worker synchronously after each charge).
 *
 * @module lib/outbox/worker
 */

import type { DatabaseInstance } from '../../db/index.js';
import { createModuleLogger } from '../../logging/logger.js';
import type { OutboxKernel } from './kernel.js';
import type { NormalizedOutboxError, OutboxRow } from './types.js';

export interface OutboxProcessorContext<TPayload, TStatus extends string> {
  row: OutboxRow<TPayload, TStatus>;
  workerId: string;
}

export type OutboxProcessor<TPayload, TStatus extends string> = (
  ctx: OutboxProcessorContext<TPayload, TStatus>
) => Promise<{ ok: true } | { ok: false; error: NormalizedOutboxError }>;

export interface OutboxWorkerOptions<TPayload, TStatus extends string> {
  kernel: OutboxKernel<TStatus, TPayload>;
  /**
   * Stable id for this worker instance. Composed into `claim_token`
   * so multi-worker contention is debuggable from the row.
   */
  workerId: string;
  /**
   * The async function that processes the row. Returns `{ok: true}`
   * on success; `{ok: false, error}` on a recoverable / permanent
   * failure. Throwing is allowed — the worker catches and treats it
   * as a recoverable failure with the exception message.
   */
  process: OutboxProcessor<TPayload, TStatus>;
  /**
   * Module logger label so audit lines from this worker are easy
   * to grep.
   */
  loggerLabel?: string;
}

/**
 * Run one claim → process → complete | fail cycle for the kernel
 * scoped to `tenantId`. Returns `null` when there's nothing to do.
 *
 * Multi-tenant note: workers are tenant-scoped by design — a single
 * worker process drives one tenant at a time. The orchestrator
 * () decides which tenants get cycled when.
 */
export async function tickOutbox<TPayload, TStatus extends string>(
  db: DatabaseInstance,
  tenantId: string,
  opts: OutboxWorkerOptions<TPayload, TStatus>
): Promise<
  | { processed: false; reason: 'idle' }
  | { processed: true; rowId: string; outcome: 'completed' | 'retrying' | 'dead_letter' }
> {
  const log = createModuleLogger(opts.loggerLabel ?? 'outbox-worker');

  const claimed = await opts.kernel.claimNext(db, {
    tenantId,
    workerId: opts.workerId,
  });
  if (!claimed) {
    return { processed: false, reason: 'idle' };
  }

  log.info(
    { tenantId, rowId: claimed.id, workerId: opts.workerId, attempts: claimed.attempts },
    'outbox row claimed'
  );

  let result: { ok: true } | { ok: false; error: NormalizedOutboxError };
  try {
    result = await opts.process({ row: claimed, workerId: opts.workerId });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    result = {
      ok: false,
      error: {
        errorCode: 'OUTBOX_PROCESSOR_THREW',
        providerMessage: message,
        recoverable: true,
        details: { stack: err instanceof Error ? err.stack : null },
      },
    };
  }

  if (result.ok) {
    await opts.kernel.complete(db, { id: claimed.id });
    log.info({ tenantId, rowId: claimed.id }, 'outbox row completed');
    return { processed: true, rowId: claimed.id, outcome: 'completed' };
  }

  const failResult = await opts.kernel.fail(db, {
    id: claimed.id,
    error: result.error,
  });
  log.warn(
    { tenantId, rowId: claimed.id, status: failResult.status, error: result.error },
    'outbox row failed'
  );
  return {
    processed: true,
    rowId: claimed.id,
    outcome: failResult.status === 'dead_letter' ? 'dead_letter' : 'retrying',
  };
}
