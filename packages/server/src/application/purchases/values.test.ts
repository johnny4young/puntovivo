import { describe, expect, it } from 'vitest';
import { freezePurchaseValue, hasExactPurchaseLotValue } from './values.js';

describe('purchase carrying-value evidence', () => {
  it('distinguishes legacy unknown from a known zero-cost receipt', () => {
    expect(hasExactPurchaseLotValue(null)).toBe(false);
    expect(hasExactPurchaseLotValue(0)).toBe(true);
    expect(hasExactPurchaseLotValue(34)).toBe(true);
    expect(freezePurchaseValue({ inventoryValue: -0, cogsValue: 0 }, -1)).toEqual({
      inventoryValueCents: 0,
      cogsValueCents: 0,
    });
  });
  it.each([NaN, Infinity, -1, 0.1, Number.MAX_SAFE_INTEGER + 1])(
    'rejects corrupt proof %s instead of treating it as legacy',
    value => {
      expect(() => hasExactPurchaseLotValue(value)).toThrowError(
        expect.objectContaining({
          cause: expect.objectContaining({ errorCode: 'INVENTORY_VALUE_INVALID' }),
        })
      );
    }
  );
  it('freezes separate book values and rejects absent or wrong-direction evidence', () => {
    expect(freezePurchaseValue({ inventoryValue: -0.34, cogsValue: -0.37 }, -1)).toEqual({
      inventoryValueCents: 34,
      cogsValueCents: 37,
    });
    expect(() => freezePurchaseValue(null, -1)).toThrow();
    expect(() => freezePurchaseValue({ inventoryValue: 0.34, cogsValue: -0.37 }, -1)).toThrow();
  });
});
