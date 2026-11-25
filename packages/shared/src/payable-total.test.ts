import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  defaultCashRoundingStep,
  isCashOnlyTender,
  isValidCashRoundingStep,
  payableDecimals,
  resolvePayableTotal,
  roundPayable,
} from './money.ts';

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

  it('applies optional cash coin rounding step for COP/CLP/PYG', () => {
    // 0.33 kg x 16,800 = 5,544 -> 5,550 (+6); 5,524 -> 5,500 (-24); midpoint 5,525 -> 5,550 (+25)
    assert.deepEqual(resolvePayableTotal(5544, 'COP', 50), {
      total: 5550,
      roundingAdjustment: 6,
    });
    assert.deepEqual(resolvePayableTotal(5524, 'COP', 50), {
      total: 5500,
      roundingAdjustment: -24,
    });
    assert.deepEqual(resolvePayableTotal(5525, 'COP', 50), {
      total: 5550,
      roundingAdjustment: 25,
    });
    assert.deepEqual(resolvePayableTotal(1004, 'CLP', 10), {
      total: 1000,
      roundingAdjustment: -4,
    });
    assert.deepEqual(resolvePayableTotal(1005, 'CLP', 10), {
      total: 1010,
      roundingAdjustment: 5,
    });
    assert.equal(defaultCashRoundingStep('COP'), 50);
    assert.equal(defaultCashRoundingStep('CLP'), 10);
    assert.equal(defaultCashRoundingStep('PYG'), 50);
    assert.equal(defaultCashRoundingStep('USD'), null);
    assert.equal(isValidCashRoundingStep(50), true);
    assert.equal(isValidCashRoundingStep(25), false);
    assert.equal(isCashOnlyTender({ paymentMethod: 'cash' }), true);
    assert.equal(isCashOnlyTender({ paymentMethod: 'card' }), false);
    assert.equal(
      isCashOnlyTender({
        paymentMethod: 'cash',
        payments: [
          { method: 'cash', amount: 3000 },
          { method: 'card', amount: 2544 },
        ],
      }),
      false
    );
    assert.equal(
      isCashOnlyTender({
        paymentMethod: 'card',
        payments: [{ method: 'cash', amount: 5550 }],
      }),
      true
    );
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

  it('ignores a cash step on currencies that have no coin step', () => {
    assert.deepEqual(resolvePayableTotal(2.4, 'USD', 100), { total: 2.4, roundingAdjustment: 0 });
    assert.equal(roundPayable(5.44, 'MXN', 50), 5.44);
  });

  it('rounds negative amounts half away from zero without a negative zero', () => {
    assert.equal(roundPayable(-0.5, 'COP'), -1);
    assert.ok(Object.is(roundPayable(-0.4, 'COP'), 0));
  });
});
