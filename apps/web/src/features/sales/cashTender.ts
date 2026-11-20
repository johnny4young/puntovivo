import { roundMoney } from '@/lib/money';

const ROUND_STEPS = [1, 5, 10, 20, 50] as const;

/**
 * Round amounts a customer is likely to hand over: multiples of the bill that
 * covers about half the total, then of larger bills. Ascending, above the total.
 */
export function suggestCashTenders(total: number, count = 2): number[] {
  if (!Number.isFinite(total) || total <= 0) return [];
  const magnitude = Math.max(1, 10 ** Math.floor(Math.log10(total / 2)));
  const amounts = ROUND_STEPS.map(step => {
    const unit = magnitude * step;
    return Math.ceil(total / unit) * unit;
  }).filter(amount => amount > total);
  return [...new Set(amounts)].sort((a, b) => a - b).slice(0, count);
}

/** Service charge on a total at a percentage rate; zero when the rate is off. */
export function serviceChargeFor(total: number, ratePercent: number): number {
  return ratePercent > 0 ? roundMoney((total * ratePercent) / 100) : 0;
}

/** Change owed for a cash tender; never negative. */
export function cashChange(tendered: number, total: number): number {
  return Math.max(0, roundMoney(tendered - total));
}

export const CASH_KEYPAD_KEYS = [
  '1',
  '2',
  '3',
  '4',
  '5',
  '6',
  '7',
  '8',
  '9',
  '0',
  '000',
  'back',
] as const;
export type CashKeypadKey = (typeof CASH_KEYPAD_KEYS)[number];
const MAX_KEYPAD_DIGITS = 12;

/**
 * Received amount after an on-screen keypad press, in whole currency units.
 * `fresh` starts a new number, so a preset amount is replaced, not extended.
 * A typed amount with cents is replaced too, never cut down silently.
 */
export function applyCashKeypadKey(current: number, key: CashKeypadKey, fresh: boolean): number {
  const amount = Number.isFinite(current) && current > 0 ? current : 0;
  const whole = Number.isInteger(amount);
  if (key === 'back') return whole ? Math.trunc(amount / 10) : Math.trunc(amount);
  const next = (fresh || !whole || amount === 0 ? '' : String(amount)) + key;
  return next.length > MAX_KEYPAD_DIGITS ? amount : Number(next);
}
