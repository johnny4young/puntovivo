import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { roundMoney } from './money.ts';
import { formatQuantity, normalizedQuantity, roundQuantity } from './unit-math.ts';
import { UNIT_DIMENSIONS } from './units.ts';

function referenceRoundMoney(value: number): number {
  const rounded =
    Math.sign(value) * (Math.round((Math.abs(value) + Number.EPSILON) * 100) / 100);
  return Object.is(rounded, -0) ? 0 : rounded;
}

function* seededValues(count: number): Generator<number> {
  let state = 0x2f6e2b1;
  for (let index = 0; index < count; index += 1) {
    state = (state * 48271) % 0x7fffffff;
    const magnitude = (state % 10_000_000) / 1000;
    yield index % 2 === 0 ? magnitude : -magnitude;
  }
}

const MONEY_EDGE_CASES = [
  0,
  -0,
  1.005,
  -1.005,
  2.675,
  10.005,
  0.1 + 0.2,
  99.99000000000001,
  100 / 1.19,
  84.03 * 1.19,
  0.004999999,
  0.005,
  -2.345,
  1e9 + 0.005,
  0.015,
  0.025,
  0.035,
  1.115,
  1.245,
];

describe('shared money contract', () => {
  it('matches the canonical formula on edge cases and a deterministic sweep', () => {
    for (const value of [...MONEY_EDGE_CASES, ...seededValues(10_000)]) {
      assert.equal(roundMoney(value), referenceRoundMoney(value), `value=${value}`);
    }
  });

  it('never returns negative zero', () => {
    assert.equal(Object.is(roundMoney(-0), -0), false);
    assert.equal(Object.is(roundMoney(-0.001), -0), false);
  });
});

describe('shared unit contract', () => {
  it('normalizes valid quantities and rejects hostile results', () => {
    assert.equal(normalizedQuantity(2.5, 6), 15);
    assert.throws(() => normalizedQuantity(0, 1), RangeError);
    assert.throws(() => normalizedQuantity(1, Number.NaN), RangeError);
    assert.throws(() => normalizedQuantity(Number.POSITIVE_INFINITY, 1), RangeError);
  });

  it('rounds quantity precision independently from money', () => {
    assert.equal(roundQuantity(1.23456), 1.235);
    assert.equal(roundQuantity(0.30000000000000004, 6), 0.3);
    assert.equal(Object.is(roundQuantity(-0.0001), -0), false);
    assert.throws(() => roundQuantity(1, 13), RangeError);
  });

  it('formats quantities using the requested locale and precision', () => {
    assert.equal(formatQuantity(1234.5678, 'en-US'), '1,234.568');
    assert.equal(formatQuantity(1234.5678, 'es-CO', { maximumFractionDigits: 2 }), '1.234,57');
  });

  it('publishes the complete stable dimension catalogue', () => {
    assert.deepEqual(UNIT_DIMENSIONS, [
      'count',
      'mass',
      'volume',
      'length',
      'area',
      'time',
      'other',
    ]);
  });
});
