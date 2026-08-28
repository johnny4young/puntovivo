import { describe, expect, it } from 'vitest';
import { assertFiscalTaxHeaderParity, sumTaxTotals } from './tax-lines.js';
import type { ResolvedLine } from './types.js';

function line(taxKind: 'iva' | 'inc', taxAmount: number): ResolvedLine {
  return {
    lineNumber: 1,
    productId: 'product-1',
    productName: 'Product',
    productSku: 'SKU-1',
    unitStandardCode: 'H87',
    quantity: 1,
    unitPrice: 100,
    discountAmount: 0,
    taxRate: taxAmount,
    taxKind,
    taxAmount,
    lineTotal: 100 + taxAmount,
  };
}

describe('fiscal header tax parity', () => {
  it('rounds and reconciles IVA plus INC against the compatibility header', () => {
    const totals = sumTaxTotals([line('iva', 19.004), line('inc', 8.004)]);
    expect(totals).toEqual({ ivaAmount: 19, incAmount: 8 });
    expect(() => assertFiscalTaxHeaderParity(27, totals)).not.toThrow();
  });

  it('rejects a stale header instead of emitting inconsistent evidence', () => {
    try {
      assertFiscalTaxHeaderParity(19, { ivaAmount: 19, incAmount: 8 });
      throw new Error('Expected fiscal parity to fail');
    } catch (error) {
      expect((error as { cause?: { errorCode?: string } }).cause?.errorCode).toBe(
        'FISCAL_TAX_TOTAL_MISMATCH'
      );
    }
  });
});
