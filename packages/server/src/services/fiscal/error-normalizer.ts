/**
 * ENG-057 — Normalize a raw adapter throw into a
 * `NormalizedFiscalError`.
 *
 * Dispatch order:
 *
 * 1. If the error is already a `FiscalProviderError`, lift its kind
 *    and providerCode directly.
 * 2. Otherwise, dispatch by `providerId` to the per-pack mapper
 *    (`packs/co/error-mapping.ts`, `packs/mx/error-mapping.ts`,
 *    `packs/cl/error-mapping.ts`). Each mapper inspects the raw
 *    error and returns either a `NormalizedFiscalError` or `null`
 *    when it cannot classify.
 * 3. Fall back to the universal heuristic: `TypeError` /
 *    `SyntaxError` → `MALFORMED_REQUEST` (non-recoverable);
 *    anything else → `PROVIDER_5XX` (recoverable).
 *
 * The fallback is intentional: the only adapter that ships with
 * real provider semantics today is the Colombia mock (which does
 * not throw on its own) — until ENG-021 / ENG-035c / ENG-036c land
 * provider-specific code dispatch, recoverable-by-default keeps
 * pilot retries flowing without burning the budget on transient
 * failures. The 6-attempt cap bounds the damage if a permanent
 * error is mis-classified.
 *
 * @module services/fiscal/error-normalizer
 */

import {
  FiscalProviderError,
  isFiscalErrorRecoverable,
  type NormalizedFiscalError,
  type NormalizedFiscalErrorKind,
} from './errors.js';
import { mapColombiaProviderError } from './packs/co/error-mapping.js';
import { mapMexicoProviderError } from './packs/mx/error-mapping.js';
import { mapChileProviderError } from './packs/cl/error-mapping.js';

const PER_PACK_MAPPERS: Record<
  string,
  (err: unknown) => NormalizedFiscalError | null
> = {
  'mock-co': mapColombiaProviderError,
  'cfdi-mx': mapMexicoProviderError,
  'sii-cl': mapChileProviderError,
};

function buildError(
  kind: NormalizedFiscalErrorKind,
  args: {
    providerCode?: string | null;
    providerMessage: string;
    details?: Record<string, unknown> | null;
  }
): NormalizedFiscalError {
  return {
    normalizedKind: kind,
    providerCode: args.providerCode ?? null,
    providerMessage: args.providerMessage,
    recoverable: isFiscalErrorRecoverable(kind),
    details: args.details ?? null,
  };
}

/**
 * Default heuristic when no per-pack mapper claims the error. Picks
 * `MALFORMED_REQUEST` (non-recoverable) for `TypeError` / `SyntaxError`
 * and `PROVIDER_5XX` (recoverable) for everything else. Stack trace
 * rides through `details` for forensics.
 */
function defaultHeuristic(err: unknown): NormalizedFiscalError {
  const message = err instanceof Error ? err.message : String(err);
  const stack = err instanceof Error ? err.stack ?? null : null;

  if (err instanceof TypeError || err instanceof SyntaxError) {
    return buildError('MALFORMED_REQUEST', {
      providerMessage: message,
      details: { stack, errorName: err.name },
    });
  }

  return buildError('PROVIDER_5XX', {
    providerMessage: message,
    details: stack ? { stack } : null,
  });
}

/**
 * Normalize a raw error thrown by an adapter into a
 * `NormalizedFiscalError`. The fiscal worker wraps every
 * `await adapter.issue(input)` in a try/catch and calls this.
 */
export function normalizeFiscalError(
  err: unknown,
  providerId: string | null
): NormalizedFiscalError {
  if (err instanceof FiscalProviderError) {
    return buildError(err.normalizedKind, {
      providerCode: err.providerCode,
      providerMessage: err.message,
      details: err.details,
    });
  }

  if (providerId) {
    const mapper = PER_PACK_MAPPERS[providerId];
    if (mapper) {
      const mapped = mapper(err);
      if (mapped) return mapped;
    }
  }

  return defaultHeuristic(err);
}
