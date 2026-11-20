import { computeNitVerificationDigit } from '@/features/company/coNit';

export const NIT_TYPE_CODE = '31';
const CONSUMIDOR_FINAL_ID = '222222222222';

/** The DV the typed NIT should carry, or null when it matches or none was typed. */
export function expectedNitDigit(raw: string): number | null {
  const match = /^([\d.\s]+?)\s*-\s*(\d)$/.exec(raw.trim());
  if (!match) return null;
  const base = (match[1] ?? '').replace(/[.\s]/g, '');
  if (!/^\d+$/.test(base)) return null;
  const dv = computeNitVerificationDigit(base);
  return Number(match[2]) === dv ? null : dv;
}

/** The DV a NIT number gets when none is typed, or '' while it is not a NIT number yet. */
export function nitDigit(raw: string): string {
  const base = raw.trim().replace(/[.\s]/g, '');
  return /^\d{5,15}$/.test(base) ? String(computeNitVerificationDigit(base)) : '';
}

/** Mirrors the server's buyer-ID rules, so a refused sale stays the exception. */
export function buyerIdProblem(
  typeCode: string,
  raw: string
): 'malformed' | 'consumidorFinal' | null {
  let id: string;
  if (typeCode === NIT_TYPE_CODE) {
    const match = /^([\d.\s]+?)(?:\s*-\s*\d)?$/.exec(raw.trim());
    id = (match?.[1] ?? '').replace(/[.\s]/g, '');
    if (!/^\d{5,15}$/.test(id)) return 'malformed';
  } else {
    id = raw
      .trim()
      .replace(/[.\s-]/g, '')
      .toUpperCase();
    if (!/^[A-Z0-9]{3,20}$/.test(id)) return 'malformed';
  }
  return id === CONSUMIDOR_FINAL_ID ? 'consumidorFinal' : null;
}

/** A typed NIT as its number and DV; a dash followed by one digit is the DV. */
export function splitNit(raw: string): { base: string; dv: string } {
  const match = /^(.*?)\s*-\s*(\d)$/.exec(raw);
  return match ? { base: match[1] ?? '', dv: match[2] ?? '' } : { base: raw, dv: '' };
}

/** Comparable form of a buyer ID, so 900.123.456-7 finds a customer saved as 900123456. */
export function buyerIdKey(raw: string, isNit = true): string {
  const id = isNit ? splitNit(raw.trim()).base : raw;
  return id.replace(/[.\s-]/g, '').toUpperCase();
}
