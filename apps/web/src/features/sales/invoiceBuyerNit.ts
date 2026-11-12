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

/** How an undashed NIT will be recorded, so a DV typed without its dash is caught. */
export function nitPreview(raw: string): string | null {
  const base = raw.trim().replace(/[.\s]/g, '');
  if (!/^\d{5,15}$/.test(base)) return null;
  return `${base}-${computeNitVerificationDigit(base)}`;
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
