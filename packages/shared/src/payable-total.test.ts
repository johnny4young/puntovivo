import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { payableDecimals, resolvePayableTotal, roundPayable } from './money.ts';

describe('resolvePayableTotal', () => {
  it('rounds a fractional-weight COP total to whole pesos and keeps the difference', () => {
    // 1.25 kg x 2,990 COP
    assert.deepEqual(resolvePayableTotal(37569.5, 'COP'), {
      total: 37570,
      roundingAdjustment: 0.5,
    });
    assert.deepEqual(resolvePayableTotal(37569.49, 'COP'), {
      total: 37569,
      roundingAdjustment: -0.49,
    });
  });

  it('treats CLP and PYG like COP and is case-insensitive', () => {
    assert.equal(roundPayable(1000.5, 'CLP'), 1001);
    assert.equal(roundPayable(1000.4, 'pyg'), 1000);
    assert.equal(payableDecimals('cop'), 0);
  });

  it('leaves two-decimal currencies unchanged', () => {
    assert.deepEqual(resolvePayableTotal(37.57, 'USD'), { total: 37.57, roundingAdjustment: 0 });
    assert.deepEqual(resolvePayableTotal(0.1 + 0.2, 'MXN'), { total: 0.3, roundingAdjustment: 0 });
    assert.equal(payableDecimals(undefined), 2);
    assert.equal(payableDecimals('XYZ'), 2);
  });

  it('rounds negative amounts half away from zero without a negative zero', () => {
    assert.equal(roundPayable(-0.5, 'COP'), -1);
    assert.ok(Object.is(roundPayable(-0.4, 'COP'), 0));
  });
});
