import { describe, expect, it } from 'vitest';
import { calculatePricing } from './pricing';

describe('product pricing calculator', () => {
  it('derives price and margin amount from margin percent', () => {
    expect(calculatePricing({ cost: 100, marginPercent: 25 })).toEqual({
      price: 125,
      marginPercent: 25,
      marginAmount: 25,
    });
  });

  it('derives percent and amount from direct price edits', () => {
    expect(calculatePricing({ cost: 80, price: 100 })).toEqual({
      price: 100,
      marginPercent: 25,
      marginAmount: 20,
    });
  });
});
