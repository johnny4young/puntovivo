import { describe, expect, it } from 'vitest';
import {
  createCashSessionDenominations,
  getCashSessionCountedTotal,
  resolveCashSessionAmount,
} from './cashSessionDenominations';

describe('cashSessionDenominations', () => {
  it('creates a zero-count row for each supported denomination', () => {
    const denominations = createCashSessionDenominations();

    expect(denominations).toHaveLength(11);
    expect(denominations.every(denomination => denomination.count === 0)).toBe(true);
  });

  it('counts in the tenant currency and keeps the peso grid when it has no known cash set', () => {
    expect(createCashSessionDenominations('CLP').map(row => row.value)).toEqual([
      20000, 10000, 5000, 2000, 1000, 500, 100, 50, 10,
    ]);
    expect(createCashSessionDenominations('GTQ')).toEqual(createCashSessionDenominations());
  });

  it('calculates the counted total from denomination rows', () => {
    const total = getCashSessionCountedTotal([
      { value: 100000, count: 1 },
      { value: 5000, count: 2 },
      { value: 500, count: 3 },
    ]);

    expect(total).toBe(111500);
  });

  it('takes the amount from the denominations and the typed total only when none were counted', () => {
    expect(resolveCashSessionAmount(120, [{ value: 50, count: 2 }])).toBe(100);
    expect(resolveCashSessionAmount(120, [{ value: 50, count: 0 }])).toBe(120);
    expect(resolveCashSessionAmount(Number.NaN, [])).toBe(0);
  });
});
