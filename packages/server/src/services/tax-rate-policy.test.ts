import { describe, expect, it } from 'vitest';
import { assertTaxRateOverrideAllowed } from './tax-rate-policy.js';

const allowedRates = { iva: [0, 5, 19], inc: [8] } as const;

describe('tax-rate override policy', () => {
  it('accepts the frozen catalog rate without requiring a live replacement row', () => {
    expect(() =>
      assertTaxRateOverrideAllowed({
        allowedRates: { iva: [], inc: [] },
        catalogTaxRate: 19,
        requestedTaxRate: 19,
        taxKind: 'iva',
        productId: 'product-1',
      })
    ).not.toThrow();
  });

  it('accepts an active override of the same tax kind', () => {
    expect(() =>
      assertTaxRateOverrideAllowed({
        allowedRates,
        catalogTaxRate: 5,
        requestedTaxRate: 19,
        taxKind: 'iva',
        productId: 'product-1',
      })
    ).not.toThrow();
  });

  it('rejects a rate that only exists under another tax kind', () => {
    try {
      assertTaxRateOverrideAllowed({
        allowedRates,
        catalogTaxRate: 8,
        requestedTaxRate: 19,
        taxKind: 'inc',
        productId: 'product-1',
      });
      throw new Error('Expected override policy to fail');
    } catch (error) {
      expect((error as { cause?: { errorCode?: string } }).cause?.errorCode).toBe(
        'TAX_RATE_KIND_INVALID'
      );
    }
  });
});
