/**
 * ENG-057 — Fiscal provider error normalization.
 *
 * Closed list of `NormalizedFiscalErrorKind` values that the fiscal
 * worker maps every adapter throw into. The Operations Center
 * (ENG-065) renders consistent operator-facing messages keyed off
 * the normalized kind regardless of which country pack threw.
 *
 * Adapters that want to be precise can throw `FiscalProviderError`
 * directly; the normalizer prefers the typed shape when present.
 * Adapters that throw raw `Error`s still work — `error-normalizer.ts`
 * falls back to per-provider regex on `err.message` and to a sane
 * default (`PROVIDER_5XX` recoverable for unknown errors).
 *
 * The `recoverable` flag is determined by `kind` deterministically;
 * we expose it as a separate readonly so the kernel + worker do not
 * have to import the mapping table.
 *
 * @module services/fiscal/errors
 */

import type { NormalizedOutboxError } from '../../lib/outbox/types.js';

/** Closed list of normalized fiscal error kinds. */
export type NormalizedFiscalErrorKind =
  // Recoverable: the kernel reschedules the row at the next backoff stage.
  | 'NETWORK_TIMEOUT'
  | 'PROVIDER_5XX'
  | 'RATE_LIMITED' // ENG-057 treats as PROVIDER_5XX; differentiated backoff lands ENG-058
  | 'UNKNOWN' // safety fallback when the error doesn't pattern-match
  // Non-recoverable: the kernel dead-letters immediately.
  | 'PROVIDER_4XX'
  | 'PROVIDER_REJECTED'
  | 'MALFORMED_REQUEST'
  | 'INVALID_CERT'
  | 'EXPIRED_CERT'
  | 'AUTH_FAILED';

/**
 * Static map from `kind` to recoverability. Keep this exhaustive —
 * the test suite reads it to enforce that every kind has a verdict.
 */
export const RECOVERABLE_FISCAL_ERROR_KINDS: ReadonlySet<NormalizedFiscalErrorKind> =
  new Set<NormalizedFiscalErrorKind>([
    'NETWORK_TIMEOUT',
    'PROVIDER_5XX',
    'RATE_LIMITED',
    'UNKNOWN',
  ]);

export function isFiscalErrorRecoverable(kind: NormalizedFiscalErrorKind): boolean {
  return RECOVERABLE_FISCAL_ERROR_KINDS.has(kind);
}

/**
 * Normalized provider error written to `fiscal_outbox.last_error`
 * and surfaced to the operator. The shape mirrors ADR-0003 §Fiscal
 * outbox §Errores normalizados.
 */
export interface NormalizedFiscalError {
  normalizedKind: NormalizedFiscalErrorKind;
  /** Raw provider code (e.g. `AAB10` from DIAN, `CFDI40103` from SAT). Null when unknown. */
  providerCode: string | null;
  /** Verbatim provider message kept for forensics. */
  providerMessage: string;
  /** Derived from `normalizedKind`; stored alongside for the kernel. */
  recoverable: boolean;
  /** Free-form bag (raw response, stack trace). */
  details?: Record<string, unknown> | null;
}

/**
 * Typed error thrown by adapters that want to be precise about
 * which `NormalizedFiscalErrorKind` they hit. The normalizer prefers
 * this shape when present; raw `Error` instances fall through to
 * pattern-matching by provider id.
 */
export class FiscalProviderError extends Error {
  readonly normalizedKind: NormalizedFiscalErrorKind;
  readonly providerCode: string | null;
  readonly details: Record<string, unknown> | null;

  constructor(
    normalizedKind: NormalizedFiscalErrorKind,
    args: {
      message: string;
      providerCode?: string | null;
      details?: Record<string, unknown> | null;
    }
  ) {
    super(args.message);
    this.name = 'FiscalProviderError';
    this.normalizedKind = normalizedKind;
    this.providerCode = args.providerCode ?? null;
    this.details = args.details ?? null;
  }
}

/**
 * Map a `NormalizedFiscalError` into the wider `NormalizedOutboxError`
 * the kernel writes to `last_error`. The kernel sees `errorCode = kind`
 * + the existing `recoverable` flag; the rest of the fiscal-specific
 * detail rides through `details`.
 */
export function toOutboxError(err: NormalizedFiscalError): NormalizedOutboxError {
  return {
    errorCode: err.normalizedKind,
    providerMessage: err.providerMessage,
    recoverable: err.recoverable,
    details: {
      providerCode: err.providerCode,
      ...(err.details ?? {}),
    },
  };
}
