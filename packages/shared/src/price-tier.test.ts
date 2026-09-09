import assert from 'node:assert/strict';
import test from 'node:test';

import { isPriceTier, isUnitPriceOverride, resolveTierUnitPrice } from './price-tier.ts';

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

test('price overrides exclude both the customer tier and retail grid', () => {
  assert.equal(
    isUnitPriceOverride({ unitPrice: 800, referenceUnitPrice: 800, retailUnitPrice: 1000 }),
    false
  );
  assert.equal(
    isUnitPriceOverride({ unitPrice: 1000, referenceUnitPrice: 800, retailUnitPrice: 1000 }),
    false
  );
  assert.equal(
    isUnitPriceOverride({ unitPrice: 799.996, referenceUnitPrice: 800, retailUnitPrice: 1000 }),
    false
  );
  assert.equal(
    isUnitPriceOverride({ unitPrice: 799.99, referenceUnitPrice: 800, retailUnitPrice: 1000 }),
    true
  );
});

test('the half-cent boundary decides the same way at every price magnitude', () => {
  // Subtracting decimal prices lands just under 0.005 at some magnitudes and
  // just over it at others. Before the tolerance, 1 - 0.995 counted as an
  // override while 800 - 799.995 did not, so the exact boundary silently
  // skipped manager approval on higher-priced lines.
  for (const reference of [1, 10, 50, 100, 800, 1000, 12345.67]) {
    assert.equal(
      isUnitPriceOverride({
        unitPrice: reference - 0.005,
        referenceUnitPrice: reference,
        retailUnitPrice: reference * 3,
      }),
      true,
      `a half-cent discount off ${reference} must count as an override`
    );
  }
});

test('a difference below the half-cent boundary is still not an override', () => {
  for (const reference of [1, 10, 50, 100, 800, 1000, 12345.67]) {
    assert.equal(
      isUnitPriceOverride({
        unitPrice: reference - 0.004,
        referenceUnitPrice: reference,
        retailUnitPrice: reference * 3,
      }),
      false,
      `a sub-half-cent difference off ${reference} must not count as an override`
    );
  }
});
