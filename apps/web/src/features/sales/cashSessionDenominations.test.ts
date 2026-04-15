import { describe, expect, it } from 'vitest';
import {
  cashSessionTotalsMatch,
  createCashSessionDenominations,
  getCashSessionCountedTotal,
} from './cashSessionDenominations';

describe('cashSessionDenominations', () => {
  it('creates a zero-count row for each supported denomination', () => {
    const denominations = createCashSessionDenominations();

    expect(denominations).toHaveLength(11);
    expect(denominations.every(denomination => denomination.count === 0)).toBe(true);
  });

  it('calculates the counted total from denomination rows', () => {
    const total = getCashSessionCountedTotal([
      { value: 100000, count: 1 },
      { value: 5000, count: 2 },
      { value: 500, count: 3 },
    ]);

    expect(total).toBe(111500);
  });

  it('compares opening float and counted total with a small numeric tolerance', () => {
    expect(
      cashSessionTotalsMatch(100, [
        { value: 50, count: 2 },
      ])
    ).toBe(true);

    expect(
      cashSessionTotalsMatch(120, [
        { value: 50, count: 2 },
      ])
    ).toBe(false);
  });
});
