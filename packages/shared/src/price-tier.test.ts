import assert from 'node:assert/strict';
import test from 'node:test';

import { isPriceTier, resolveTierUnitPrice } from './price-tier.ts';

const PRICES = { price: 1000, price2: 800, price3: 700 };

test('tier 1 always keeps the assignment price', () => {
  assert.equal(
    resolveTierUnitPrice({
      tier: 1,
      assignmentPrice: 1000,
      isBaseUnit: true,
      productPrices: PRICES,
    }),
    1000
  );
});

test('tiers 2 and 3 map the base unit to price2 / price3', () => {
  assert.equal(
    resolveTierUnitPrice({
      tier: 2,
      assignmentPrice: 1000,
      isBaseUnit: true,
      productPrices: PRICES,
    }),
    800
  );
  assert.equal(
    resolveTierUnitPrice({
      tier: 3,
      assignmentPrice: 1000,
      isBaseUnit: true,
      productPrices: PRICES,
    }),
    700
  );
});

test('non-base assignments use their own tier grid', () => {
  assert.equal(
    resolveTierUnitPrice({
      tier: 2,
      assignmentPrice: 5500,
      assignmentPrice2: 5000,
      assignmentPrice3: 4500,
      isBaseUnit: false,
      productPrices: PRICES,
    }),
    5000
  );
});

test('an unconfigured non-base tier falls back to that assignment price', () => {
  assert.equal(
    resolveTierUnitPrice({
      tier: 3,
      assignmentPrice: 5500,
      assignmentPrice2: 0,
      assignmentPrice3: 0,
      isBaseUnit: false,
      productPrices: PRICES,
    }),
    5500
  );
});

test('an unconfigured tier price falls back to the assignment price, never zero', () => {
  assert.equal(
    resolveTierUnitPrice({
      tier: 2,
      assignmentPrice: 1000,
      isBaseUnit: true,
      productPrices: { price: 1000, price2: 0, price3: 0 },
    }),
    1000
  );
});

test('isPriceTier accepts only 1, 2 and 3', () => {
  assert.equal(isPriceTier(1), true);
  assert.equal(isPriceTier(3), true);
  assert.equal(isPriceTier(0), false);
  assert.equal(isPriceTier(4), false);
  assert.equal(isPriceTier('2'), false);
  assert.equal(isPriceTier(null), false);
});
