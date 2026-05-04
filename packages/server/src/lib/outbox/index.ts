/**
 * ENG-053 — Outbox kernel barrel.
 *
 * Re-exports the public surface of the outbox kernel so concrete
 * outboxes (sync, fiscal, payment, webhook, hardware) only need a
 * single import path.
 *
 * @module lib/outbox
 */

export {
  BOUNDED_EXPONENTIAL_BACKOFF,
  type NormalizedOutboxError,
  type OutboxKind,
  type OutboxRetryPolicy,
  type OutboxRow,
} from './types.js';
export {
  createOutboxKernel,
  type OutboxBaseColumns,
  type OutboxKernel,
  type OutboxKernelOptions,
} from './kernel.js';
export {
  tickOutbox,
  type OutboxProcessor,
  type OutboxProcessorContext,
  type OutboxWorkerOptions,
} from './worker.js';
export {
  listMetadata,
  readMetadata,
  recordFailure,
  recordSuccess,
  refreshPendingCount,
} from './metadata.js';
