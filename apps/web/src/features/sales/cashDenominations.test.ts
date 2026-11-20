import { describe, expect, it } from 'vitest';
import { cashDenominationsFor, changeBreakdown } from './cashDenominations';

describe('changeBreakdown', () => {
  it('hands over as few bills as possible and the rest in coins', () => {
    expect(changeBreakdown(12_580, 'COP')).toEqual({
      bills: [
        { value: 10_000, count: 1 },
        { value: 2_000, count: 1 },
      ],
      coins: 580,
    });
    expect(changeBreakdown(140_000, 'COP')).toEqual({
      bills: [
        { value: 100_000, count: 1 },
        { value: 20_000, count: 2 },
      ],
      coins: 0,
    });
  });

  it('works in cents for decimal currencies', () => {
    expect(changeBreakdown(26.35, 'USD')).toEqual({
      bills: [
        { value: 20, count: 1 },
        { value: 5, count: 1 },
        { value: 1, count: 1 },
      ],
      coins: 0.35,
    });
    expect(changeBreakdown(0.3, 'pen')).toEqual({ bills: [], coins: 0.3 });
  });

  it('returns nothing without change or for a currency without a known cash set', () => {
    expect(changeBreakdown(0, 'COP')).toBeNull();
    expect(changeBreakdown(12_580, 'GTQ')).toBeNull();
  });
});

describe('cashDenominationsFor', () => {
  it('lists bills then coins, largest first', () => {
    expect(cashDenominationsFor('CLP')).toEqual([20000, 10000, 5000, 2000, 1000, 500, 100, 50, 10]);
    expect(cashDenominationsFor('XYZ')).toEqual([]);
  });
});
