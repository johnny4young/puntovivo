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
import type { ClaimedOutboxRow, NormalizedOutboxError, OutboxMutation } from './types.js';

export interface OutboxProcessorContext<TPayload, TStatus extends string> {
  row: ClaimedOutboxRow<TPayload, TStatus>;
  /** Persist intermediate progress only while this attempt still owns the lease. */
  mutateIfOwned: (mutate: OutboxMutation) => boolean;
  workerId: string;
}

/** Final local effects are persisted atomically with the winning acknowledgment. */
export type OutboxProcessResult = ({ ok: true } | { ok: false; error: NormalizedOutboxError }) & {
  persist?: OutboxMutation;
};

/** Lost ownership is not a provider failure and must never consume another retry. */
export type OutboxSettledOutcome = 'completed' | 'retrying' | 'dead_letter';

export type OutboxProcessor<TPayload, TStatus extends string> = (
  ctx: OutboxProcessorContext<TPayload, TStatus>
) => Promise<OutboxProcessResult>;

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
  /** Optional synchronous metadata effects in the same winning transaction. */
  onSettled?: (tx: DatabaseInstance, outcome: OutboxSettledOutcome) => undefined;
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
  | { processed: true; rowId: string; outcome: OutboxSettledOutcome | 'lost_claim' }
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

  let result: OutboxProcessResult;
  try {
    result = await opts.process({
      row: claimed,
      workerId: opts.workerId,
      mutateIfOwned: mutate => opts.kernel.mutateIfOwned(db, claimed, mutate),
    });
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

  // No await between the owner CAS, final local effects and metadata. A crash
  // or a failed persistence callback rolls back the entire acknowledgment.
  const outcome = db.transaction(
    tx => {
      let settled: OutboxSettledOutcome;
      if (result.ok) {
        if (!opts.kernel.complete(tx, claimed)) return 'lost_claim' as const;
        settled = 'completed';
      } else {
        const failed = opts.kernel.fail(tx, { ...claimed, error: result.error });
        if (!failed.applied) return 'lost_claim' as const;
        settled = failed.status === 'dead_letter' ? 'dead_letter' : 'retrying';
      }
      result.persist?.(tx);
      opts.onSettled?.(tx, settled);
      return settled;
    },
    { behavior: 'immediate' }
  );

  if (outcome === 'lost_claim') {
    log.info({ tenantId, rowId: claimed.id }, 'outbox response ignored after lease loss');
  } else if (result.ok) {
    log.info({ tenantId, rowId: claimed.id }, 'outbox row completed');
  } else {
    log.warn(
      { tenantId, rowId: claimed.id, status: outcome, error: result.error },
      'outbox row failed'
    );
  }
  return { processed: true, rowId: claimed.id, outcome };
}
