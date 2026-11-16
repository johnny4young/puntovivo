import { roundMoney } from '@/lib/money';
import { getCashDenominations } from './cashSessionDenominations';

export interface ChangeBreakdown {
  /** Notes to hand over, largest first. */
  notes: Array<{ value: number; count: number }>;
  /** What is left below the smallest note. */
  coins: number;
}

/**
 * One way to hand over `change` in the currency's notes. Returns null when
 * the currency has no known denominations, so the caller shows nothing
 * rather than a breakdown in the wrong money.
 */
export function breakdownChange(change: number, currencyCode: string): ChangeBreakdown | null {
  const denominations = getCashDenominations(currencyCode);
  if (!denominations || !(change > 0)) return null;
  const notes: ChangeBreakdown['notes'] = [];
  let remaining = roundMoney(change);
  for (const value of denominations.values) {
    if (value < denominations.smallestNote) break;
    const count = Math.floor(roundMoney(remaining / value));
    if (count <= 0) continue;
    notes.push({ value, count });
    remaining = roundMoney(remaining - count * value);
  }
  return { notes, coins: remaining };
}

function roundSteps(total: number, currencyCode: string): number[] {
  const known = getCashDenominations(currencyCode);
  if (known) {
    return known.values.filter(value => value >= known.smallestNote).sort((a, b) => a - b);
  }
  // Unknown currency: 1-2-5 steps around the size of the total.
  const magnitude = 10 ** Math.max(0, Math.floor(Math.log10(total)) - 1);
  return [1, 2, 5, 10, 20, 50, 100].map(step => step * magnitude);
}

/**
 * Up to three amounts a customer is likely to hand over: the total rounded
 * up to the notes in use, never the total itself (that is the Exact key).
 */
export function suggestCashAmounts(total: number, currencyCode: string, limit = 3): number[] {
  if (!(total > 0)) return [];
  const steps = roundSteps(total, currencyCode);
  // Rounding to notes far smaller than the sale only restates the total.
  const useful = steps.filter(step => step >= total / 20);
  const amounts = new Set<number>();
  for (const step of useful.length > 0 ? useful : steps.slice(-1)) {
    const rounded = roundMoney(Math.ceil(total / step) * step);
    if (rounded > total) amounts.add(rounded);
  }
  const sorted = [...amounts].sort((a, b) => a - b).slice(0, limit);
  while (sorted.length > 0 && sorted.length < limit) {
    const last = sorted[sorted.length - 1]!;
    const bump = [...steps].reverse().find(step => step <= last / 2) ?? steps[0]!;
    sorted.push(roundMoney(last + bump));
  }
  return sorted;
}

/** The (at most two) largest notes that make up an amount, for the chip swatch. */
export function leadingNotes(amount: number, currencyCode: string): number[] {
  return (breakdownChange(amount, currencyCode)?.notes ?? []).slice(0, 2).map(note => note.value);
}

/**
 * The amount after one keypad press. Whole units only: decimals are typed.
 * `fresh` means the field still holds a preset, which the first digit replaces.
 */
export function applyKeypadKey(current: number, key: string, fresh: boolean): number {
  const whole = Math.max(0, Math.trunc(Number.isFinite(current) ? current : 0));
  if (key === 'backspace') return Math.floor(whole / 10);
  if (!/^\d+$/.test(key)) return whole;
  const base = fresh || whole === 0 ? '' : String(whole);
  // Twelve digits is far past any till amount and keeps the number exact.
  return Number(`${base}${key}`.slice(0, 12)) || 0;
}
