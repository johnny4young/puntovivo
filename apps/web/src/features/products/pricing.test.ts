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

  it('clamps negative cost to 0 (the discounted-price branch)', () => {
    expect(calculatePricing({ cost: -50, price: 100 })).toEqual({
      price: 100,
      marginAmount: 100,
      marginPercent: 0,
    });
  });

  it('clamps negative price to 0', () => {
    expect(calculatePricing({ cost: 50, price: -10 })).toEqual({
      price: 0,
      marginAmount: 0,
      marginPercent: 0,
    });
  });

  it('returns 0% margin when cost is 0 in the price-driven branch (no division by zero)', () => {
    expect(calculatePricing({ cost: 0, price: 25 })).toEqual({
      price: 25,
      marginAmount: 25,
      marginPercent: 0,
    });
  });

  it('clamps negative marginPercent to 0', () => {
    expect(calculatePricing({ cost: 100, marginPercent: -10 })).toEqual({
      price: 100,
      marginAmount: 0,
      marginPercent: 0,
    });
  });

  it('derives price and marginPercent from cost + marginAmount', () => {
    expect(calculatePricing({ cost: 100, marginAmount: 40 })).toEqual({
      price: 140,
      marginAmount: 40,
      marginPercent: 40,
    });
  });

  it('clamps negative marginAmount to 0', () => {
    expect(calculatePricing({ cost: 100, marginAmount: -5 })).toEqual({
      price: 100,
      marginAmount: 0,
      marginPercent: 0,
    });
  });

  it('returns 0% margin in the marginAmount branch when cost is 0', () => {
    expect(calculatePricing({ cost: 0, marginAmount: 10 })).toEqual({
      price: 10,
      marginAmount: 10,
      marginPercent: 0,
    });
  });

  it('falls back to price=cost with zero margin when no override is supplied', () => {
    expect(calculatePricing({ cost: 75 })).toEqual({
      price: 75,
      marginAmount: 0,
      marginPercent: 0,
    });
  });

  it('treats explicit null overrides as "not provided" and falls through', () => {
    expect(
      calculatePricing({
        cost: 50,
        price: null,
        marginAmount: null,
        marginPercent: null,
      })
    ).toEqual({ price: 50, marginAmount: 0, marginPercent: 0 });
  });

  it('rounds outputs to 2 decimals (cent-level precision)', () => {
    expect(calculatePricing({ cost: 33.333, marginPercent: 11.111 })).toEqual({
      price: 37.03,
      marginAmount: 3.7,
      marginPercent: 11.11,
    });
  });

  it('price branch takes precedence over marginPercent and marginAmount when all are supplied', () => {
    // Order of precedence: price → marginPercent → marginAmount → fallback.
    expect(
      calculatePricing({
        cost: 100,
        price: 150,
        marginPercent: 1000,
        marginAmount: 9999,
      })
    ).toEqual({ price: 150, marginAmount: 50, marginPercent: 50 });
  });
});
