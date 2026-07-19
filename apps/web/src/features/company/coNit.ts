/**
 * A-33 — client-side NIT verification-digit hint.
 *
 * The server (`services/fiscal/packs/co/nit.ts`) is the source of truth and
 * rejects an invalid NIT on save. This is a thin mirror of the same DIAN
 * algorithm so the card can show the correct DV as the admin types, without
 * a round-trip and without the web importing server runtime code (the repo
 * boundary: web imports server TYPES only). Drift between the two is pinned
 * by both `co-nit.test.ts` (server) and `coNit.test.ts` (web) asserting the
 * same hand-computed cases (e.g. NIT 900373115 → DV 3).
 */

/** Official DIAN weights, least-significant position first. */
const DV_WEIGHTS = [3, 7, 13, 17, 19, 23, 29, 37, 41, 43, 47, 53, 59, 67, 71];
const MIN_NIT_DIGITS = 9;
const MAX_NIT_DIGITS = 10;

/** Compute the DIAN verification digit for a digits-only NIT base. */
export function computeNitVerificationDigit(nitDigits: string): number {
  let sum = 0;
  for (let i = 0; i < nitDigits.length; i += 1) {
    const digit = nitDigits.charCodeAt(nitDigits.length - 1 - i) - 48;
    sum += digit * DV_WEIGHTS[i]!;
  }
  const remainder = sum % 11;
  return remainder > 1 ? 11 - remainder : remainder;
}

/** Live hint state for the NIT field. */
export type NitHint =
  | { kind: 'idle' }
  | { kind: 'invalid'; reason: 'non_numeric' | 'too_short' | 'too_long' }
  | { kind: 'suggest'; nit: string; dv: number }
  | { kind: 'match'; nit: string; dv: number }
  | { kind: 'mismatch'; nit: string; dv: number; provided: number };

/**
 * Parse a NIT (`900373115`, `900373115-3`, `900.373.115-3`) and return the
 * hint the card should render as the admin types. Empty input is `idle`.
 */
export function nitHint(input: string): NitHint {
  const trimmed = input.trim();
  if (trimmed.length === 0) return { kind: 'idle' };

  const dashIndex = trimmed.lastIndexOf('-');
  let basePart = trimmed;
  let provided: number | null = null;
  if (dashIndex !== -1) {
    const dvCandidate = trimmed.slice(dashIndex + 1).trim();
    if (/^\d$/.test(dvCandidate)) {
      provided = Number(dvCandidate);
      basePart = trimmed.slice(0, dashIndex);
    }
  }

  const nit = basePart.replace(/[.\s]/g, '');
  if (!/^\d+$/.test(nit)) return { kind: 'invalid', reason: 'non_numeric' };
  if (nit.length < MIN_NIT_DIGITS) return { kind: 'invalid', reason: 'too_short' };
  if (nit.length > MAX_NIT_DIGITS) return { kind: 'invalid', reason: 'too_long' };

  const dv = computeNitVerificationDigit(nit);
  if (provided === null) return { kind: 'suggest', nit, dv };
  return provided === dv ? { kind: 'match', nit, dv } : { kind: 'mismatch', nit, dv, provided };
}
