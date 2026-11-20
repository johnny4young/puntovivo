import type { CashSessionDenomination } from '@/types';
import { cashDenominationsFor } from './cashDenominations';

/** Rows to count a till in the tenant currency; Colombian pesos when the currency has no known cash set. */
export function createCashSessionDenominations(currencyCode = 'COP'): CashSessionDenomination[] {
  const values = cashDenominationsFor(currencyCode);
  return (values.length > 0 ? values : cashDenominationsFor('COP')).map(value => ({
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
