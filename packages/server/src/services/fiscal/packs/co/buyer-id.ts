/**
 * Canonical Colombian buyer ID for a requested electronic invoice.
 * @module services/fiscal/packs/co/buyer-id
 */
import { CONSUMIDOR_FINAL } from '../../cufe.js';
import { computeNitVerificationDigit } from './nit.js';

const NIT_TYPE_CODE = '31';
const NIT_BASE_DIGITS = { min: 5, max: 15 } as const;
const OTHER_ID_LENGTH = { min: 3, max: 20 } as const;

export type CoBuyerIdResult =
  | { ok: true; value: string }
  | { ok: false; reason: 'empty' | 'malformed' | 'dv_mismatch' | 'consumidor_final' };

/**
 * NIT becomes `base-DV` (the DV is computed when omitted, checked when typed);
 * other types keep letters and digits only. Natural-person NITs are cédula
 * numbers, so the base is not held to the issuer's 9-10 digit contract.
 */
export function normalizeCoBuyerId(typeCode: string, raw: string): CoBuyerIdResult {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return { ok: false, reason: 'empty' };

  if (typeCode === NIT_TYPE_CODE) {
    const match = /^([\d.\s]+?)(?:\s*-\s*(\d))?$/.exec(trimmed);
    const base = match?.[1]?.replace(/[.\s]/g, '') ?? '';
    if (
      !match ||
      base.length < NIT_BASE_DIGITS.min ||
      base.length > NIT_BASE_DIGITS.max ||
      !/^\d+$/.test(base)
    ) {
      return { ok: false, reason: 'malformed' };
    }
    if (base === CONSUMIDOR_FINAL.taxId) return { ok: false, reason: 'consumidor_final' };
    const dv = computeNitVerificationDigit(base);
    if (match[2] !== undefined && Number(match[2]) !== dv) {
      return { ok: false, reason: 'dv_mismatch' };
    }
    return { ok: true, value: `${base}-${dv}` };
  }

  const compact = trimmed.replace(/[.\s-]/g, '').toUpperCase();
  if (
    compact.length < OTHER_ID_LENGTH.min ||
    compact.length > OTHER_ID_LENGTH.max ||
    !/^[A-Z0-9]+$/.test(compact)
  ) {
    return { ok: false, reason: 'malformed' };
  }
  if (compact === CONSUMIDOR_FINAL.taxId) return { ok: false, reason: 'consumidor_final' };
  return { ok: true, value: compact };
}
