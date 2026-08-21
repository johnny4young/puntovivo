import assert from 'node:assert/strict';
import test from 'node:test';

import { splitLineTax } from './tax-split.ts';

test('inclusive mode reproduces the historical engine vectors exactly', () => {
  // The canonical completeSale vector: 5 units of 50.00 gross at IVA 19%.
  const line = splitLineTax({
    unitPrice: 50,
    quantity: 5,
    discountPercent: 0,
    taxRate: 19,
    priceIncludesTax: true,
  });
  assert.deepEqual(line, {
    lineBase: 210.08,
    lineTax: 39.92,
    lineTotal: 250,
    discountAmount: 0,
  });

  // The lib-money doc vector: 100 gross at 19% -> base 84.03.
  const single = splitLineTax({
    unitPrice: 100,
    quantity: 1,
    discountPercent: 0,
    taxRate: 19,
    priceIncludesTax: true,
  });
  assert.equal(single.lineBase, 84.03);
  assert.equal(single.lineTax, 15.97);
  assert.equal(single.lineTotal, 100);
});

test('exclusive mode adds the tax on top of the discounted base', () => {
  const line = splitLineTax({
    unitPrice: 100,
    quantity: 1,
    discountPercent: 0,
    taxRate: 19,
    priceIncludesTax: false,
  });
  assert.deepEqual(line, { lineBase: 100, lineTax: 19, lineTotal: 119, discountAmount: 0 });

  // Non-terminating intermediate: every step is 2-dec rounded before reuse.
  const odd = splitLineTax({
    unitPrice: 33.33,
    quantity: 1,
    discountPercent: 0,
    taxRate: 19,
    priceIncludesTax: false,
  });
  assert.equal(odd.lineTax, 6.33); // round(33.33 * 0.19) = round(6.3327)
  assert.equal(odd.lineTotal, 39.66);
});

test('the discount applies to the customer-facing amount in each mode', () => {
  // Inclusive: discount comes off the gross the customer sees.
  const inclusive = splitLineTax({
    unitPrice: 100,
    quantity: 2,
    discountPercent: 10,
    taxRate: 19,
    priceIncludesTax: true,
  });
  assert.equal(inclusive.discountAmount, 20);
  assert.equal(inclusive.lineTotal, 180);
  assert.equal(inclusive.lineBase, 151.26);
  assert.equal(inclusive.lineTax, 28.74);

  // Exclusive: discount comes off the pre-tax base, tax follows it down.
  const exclusive = splitLineTax({
    unitPrice: 100,
    quantity: 2,
    discountPercent: 10,
    taxRate: 19,
    priceIncludesTax: false,
  });
  assert.equal(exclusive.discountAmount, 20);
  assert.equal(exclusive.lineBase, 180);
  assert.equal(exclusive.lineTax, 34.2);
  assert.equal(exclusive.lineTotal, 214.2);
});

test('a zero rate is identical in both modes', () => {
  for (const priceIncludesTax of [true, false]) {
    const line = splitLineTax({
      unitPrice: 25.5,
      quantity: 3,
      discountPercent: 0,
      taxRate: 0,
      priceIncludesTax,
    });
    assert.deepEqual(line, { lineBase: 76.5, lineTax: 0, lineTotal: 76.5, discountAmount: 0 });
  }
});

test('INC at 8% splits like any other single-layer rate', () => {
  // A restaurant line: INC replaces IVA; the arithmetic is the same split
  // with the restaurant's inclusive menu price.
  const line = splitLineTax({
    unitPrice: 27_000,
    quantity: 1,
    discountPercent: 0,
    taxRate: 8,
    priceIncludesTax: true,
  });
  assert.equal(line.lineBase, 25_000);
  assert.equal(line.lineTax, 2_000);
  assert.equal(line.lineTotal, 27_000);
});

test('base plus tax always reconstructs the customer total in both modes', () => {
  for (const priceIncludesTax of [true, false]) {
    for (const unitPrice of [0.01, 1.99, 33.33, 50, 4999.99]) {
      for (const taxRate of [0, 5, 8, 16, 19]) {
        const line = splitLineTax({
          unitPrice,
          quantity: 3,
          discountPercent: 7,
          taxRate,
          priceIncludesTax,
        });
        assert.equal(
          roundEq(line.lineBase + line.lineTax),
          line.lineTotal,
          `mode=${priceIncludesTax} price=${unitPrice} rate=${taxRate}`
        );
      }
    }
  }
});

function roundEq(value: number): number {
  return Math.round(value * 100) / 100;
}
