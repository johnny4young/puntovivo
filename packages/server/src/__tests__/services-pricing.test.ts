/**
 * `services/pricing` — direct unit coverage for the catalog money math.
 *
 * MIRROR CONTRACT: `calculatePricing` here and in
 * `apps/web/src/features/products/pricing.ts` must stay logic-identical
 * (the renderer cannot import server runtime code, so the product form
 * previews locally). The `calculatePricing` blocks below intentionally
 * repeat the expectations of the web suite
 * (`apps/web/src/features/products/pricing.test.ts`) so a drift between
 * the mirrors fails loudly on BOTH sides, not only in the web run.
 *
 * `normalizeProductPricing` is server-only: the write-path authority that
 * re-derives the persisted margins from the submitted prices.
 */

import { describe, expect, it } from 'vitest';
import { calculatePricing, normalizeProductPricing } from '../services/pricing.js';

describe('calculatePricing (mirror of the web suite)', () => {
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

describe('normalizeProductPricing (server-only write-path authority)', () => {
  it('normalizes the three price tiers independently against the same cost', () => {
    const result = normalizeProductPricing({
      cost: 100,
      price: 150,
      price2: 125,
      price3: 100,
      marginPercent1: 0,
      marginPercent2: 0,
      marginPercent3: 0,
      marginAmount1: 0,
      marginAmount2: 0,
      marginAmount3: 0,
    });
    expect(result).toEqual({
      cost: 100,
      price: 150,
      price2: 125,
      price3: 100,
      marginPercent1: 50,
      marginPercent2: 25,
      marginPercent3: 0,
      marginAmount1: 50,
      marginAmount2: 25,
      marginAmount3: 0,
    });
  });

  it('recomputes stored margins from the submitted prices, ignoring the submitted margins', () => {
    // The router always passes every field as a number, so the price branch
    // always wins inside calculatePricing: the server is the final authority
    // that re-derives margins from price. The form-side margin edits were
    // already folded into the price by the web mirror before submit.
    const result = normalizeProductPricing({
      cost: 200,
      price: 300,
      price2: 250,
      price3: 220,
      marginPercent1: 999,
      marginPercent2: 999,
      marginPercent3: 999,
      marginAmount1: 12345,
      marginAmount2: 12345,
      marginAmount3: 12345,
    });
    expect(result.marginPercent1).toBe(50);
    expect(result.marginAmount1).toBe(100);
    expect(result.marginPercent2).toBe(25);
    expect(result.marginAmount2).toBe(50);
    expect(result.marginPercent3).toBe(10);
    expect(result.marginAmount3).toBe(20);
  });

  it('clamps a negative cost to 0 and keeps tier prices intact', () => {
    const result = normalizeProductPricing({
      cost: -10,
      price: 50,
      price2: 40,
      price3: 30,
      marginPercent1: 0,
      marginPercent2: 0,
      marginPercent3: 0,
      marginAmount1: 0,
      marginAmount2: 0,
      marginAmount3: 0,
    });
    expect(result.cost).toBe(0);
    expect(result.price).toBe(50);
    // cost 0 → percent margin collapses to 0 (division guard), amount = price.
    expect(result.marginPercent1).toBe(0);
    expect(result.marginAmount1).toBe(50);
  });

  it('treats a zero price as a real price (free tier), not as missing', () => {
    const result = normalizeProductPricing({
      cost: 80,
      price: 0,
      price2: 0,
      price3: 0,
      marginPercent1: 25,
      marginPercent2: 25,
      marginPercent3: 25,
      marginAmount1: 20,
      marginAmount2: 20,
      marginAmount3: 20,
    });
    expect(result.price).toBe(0);
    expect(result.price2).toBe(0);
    expect(result.price3).toBe(0);
    expect(result.marginPercent1).toBe(0);
    expect(result.marginAmount1).toBe(0);
  });

  it('rounds every tier to cent precision', () => {
    const result = normalizeProductPricing({
      cost: 33.333,
      price: 49.999,
      price2: 44.444,
      price3: 39.995,
      marginPercent1: 0,
      marginPercent2: 0,
      marginPercent3: 0,
      marginAmount1: 0,
      marginAmount2: 0,
      marginAmount3: 0,
    });
    expect(result.cost).toBe(33.33);
    expect(result.price).toBe(50);
    expect(result.price2).toBe(44.44);
    // 39.995 is stored as 39.99499... in IEEE-754, so it rounds DOWN: the
    // rounding applies to the represented value, not the decimal literal.
    expect(result.price3).toBe(39.99);
    // margins derive from the rounded figures, also at cent precision.
    expect(result.marginAmount1).toBe(16.67);
    expect(result.marginPercent1).toBe(50.02);
  });
});
