import type { CashSessionDenomination } from '@/types';

export const CASH_SESSION_DENOMINATION_VALUES = [
  100000,
  50000,
  20000,
  10000,
  5000,
  2000,
  1000,
  500,
  200,
  100,
  50,
] as const;

export function createCashSessionDenominations(): CashSessionDenomination[] {
  return CASH_SESSION_DENOMINATION_VALUES.map(value => ({
    value,
    count: 0,
  }));
}

export function getCashSessionCountedTotal(
  denominations: readonly CashSessionDenomination[]
): number {
  return denominations.reduce((total, denomination) => {
    return total + denomination.value * denomination.count;
  }, 0);
}

export function cashSessionTotalsMatch(
  openingFloat: number,
  denominations: readonly CashSessionDenomination[]
): boolean {
  return Math.abs(openingFloat - getCashSessionCountedTotal(denominations)) < 1e-6;
}
