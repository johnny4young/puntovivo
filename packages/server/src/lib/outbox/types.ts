/**
 * ENG-053 — Shared types for the outbox kernel.
 *
 * These types describe the GENERIC shape every concrete outbox
 * (sync / fiscal / payment / webhook / hardware) must conform to. The
 * five outboxes live in their own physical tables (ADR-0003) — the
 * kernel never multiplexes them through one row store. What's shared
 * is the lifecycle vocabulary, the retry-policy contract, and the
 * `OutboxRow<TPayload>` projection the worker base class expects.
 *
 * `TStatus extends string` is intentionally generic: every concrete
 * outbox owns its own enum. `payment_outbox` ships
 * `queued|submitted|approved|declined|timeout|retrying|settled`,
 * `fiscal_outbox` ships
 * `queued|submitting|accepted|rejected|contingency|retrying|dead_letter`,
 * etc. The kernel never tries to enforce a single super-enum — that
 * would either over-constrain (rejecting per-outbox state) or
 * under-specify (missing the contingency / settled states unique to
 * the fiscal / payment outboxes).
 *
 * @module lib/outbox/types
 */

import type { OutboxKind } from '../../db/schema.js';

/**
 * Normalized error shape that every concrete outbox surfaces in
 * `lastError`. Workers map provider-specific codes (Bold, Wompi,
 * DIAN, SAT, SII) into this taxonomy so the Operations Center
 * (ENG-065) renders consistent messages.
 */
export interface NormalizedOutboxError {
  /** Stable code the UI maps to a translation. */
  errorCode: string;
  /** Human-readable provider message kept verbatim for forensics. */
  providerMessage: string;
  /**
   * Whether this error is worth retrying. Network timeouts +
   * provider 5xx = `true`. Validation rejections, malformed
   * payloads, expired credentials = `false` so the kernel
   * dead-letters immediately instead of burning the retry budget.
   */
  recoverable: boolean;
  /** Free-form bag for forensics (raw provider response, etc.). */
  details?: Record<string, unknown> | null;
}

/**
 * Retry policy contract. The kernel calls `nextDelayMs(attempts)`
 * after a `recoverable` failure to compute when the row's
 * `nextRetryAt` should be. Returns `null` when the budget is
 * exhausted — the kernel then transitions the row to dead-letter.
 *
 * Concrete outboxes ship their own policy: fiscal uses bounded
 * exponential `1m→5m→15m→1h→6h→24h`, payment uses tighter retries,
 * hardware uses no-backoff (a stuck printer either works on the
 * next tick or gets cancelled).
 */
export interface OutboxRetryPolicy {
  /** Maximum number of retries before dead-letter. */
  maxAttempts: number;
  /** Compute the delay in milliseconds before the next attempt. */
  nextDelayMs(attempts: number): number | null;
}

/**
 * The projection of a generic outbox row that the kernel + worker
 * read. Each concrete outbox table will declare its own row type
 * with the same SHAPE plus per-outbox columns (e.g.
 * `fiscal_document_id` on `fiscal_outbox`, `peripheral_id` on
 * `hardware_outbox`).
 */
export interface OutboxRow<TPayload, TStatus extends string = string> {
  id: string;
  tenantId: string;
  status: TStatus;
  payload: TPayload;
  payloadVersion: number;
  attempts: number;
  nextRetryAt: string | null;
  lastError: NormalizedOutboxError | null;
  priority: number;
  claimToken: string | null;
  lockedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * Re-export the canonical `OutboxKind` enum (from
 * `db/schema.ts.outboxKindEnum`) so consumers of the kernel only
 * need to import from one place.
 */
export type { OutboxKind };

/**
 * Bounded exponential backoff used by the fiscal + sync outboxes.
 * Stages: `1m → 5m → 15m → 1h → 6h → 24h`. Caps at 6 attempts —
 * after that the row dead-letters and the operator must intervene
 * from the Operations Center.
 *
 * Exposed as a default for concrete outboxes that want the
 * stability of the canonical schedule. Hardware + webhook outboxes
 * pick faster / slower variants.
 */
export const BOUNDED_EXPONENTIAL_BACKOFF: OutboxRetryPolicy = {
  maxAttempts: 6,
  nextDelayMs(attempts: number): number | null {
    const stages = [
      60_000, // 1m
      5 * 60_000, // 5m
      15 * 60_000, // 15m
      60 * 60_000, // 1h
      6 * 60 * 60_000, // 6h
      24 * 60 * 60_000, // 24h
    ];
    if (attempts >= stages.length) return null;
    return stages[attempts] ?? null;
  },
};
