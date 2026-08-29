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

  it('buckets IVA and INC from two frozen components on one line', () => {
    const mixed = line('iva', 27);
    mixed.taxRate = 27;
    mixed.taxComponents = [
      {
        componentKey: 'vat:iva',
        vatRateId: 'iva',
        taxKind: 'iva',
        taxRate: 19,
        taxableAmount: 100,
        taxAmount: 19,
        position: 0,
      },
      {
        componentKey: 'vat:inc',
        vatRateId: 'inc',
        taxKind: 'inc',
        taxRate: 8,
        taxableAmount: 100,
        taxAmount: 8,
        position: 1,
      },
    ];
    const totals = sumTaxTotals([mixed]);
    expect(totals).toEqual({ ivaAmount: 19, incAmount: 8 });
    expect(() => assertFiscalTaxHeaderParity(27, totals)).not.toThrow();
  });

  it('treats an empty component array as a legacy line instead of dropping its tax', () => {
    const legacy = line('inc', 8);
    legacy.taxComponents = [];
    expect(sumTaxTotals([legacy])).toEqual({ ivaAmount: 0, incAmount: 8 });
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
