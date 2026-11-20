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
