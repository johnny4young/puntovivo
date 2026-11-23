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

/** A denomination count is the amount; the typed total only stands when nothing was counted. */
export function resolveCashSessionAmount(
  typedAmount: number | undefined,
  denominations: readonly CashSessionDenomination[]
): number {
  const counted = getCashSessionCountedTotal(denominations);
  if (Number.isFinite(counted) && counted > 0) return counted;
  return typedAmount !== undefined && Number.isFinite(typedAmount) ? typedAmount : 0;
}
