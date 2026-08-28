import { describe, expect, it } from 'vitest';
import { formatQuotationTaxLabel } from './quotationTaxLabel';

describe('formatQuotationTaxLabel', () => {
  it('renders every normalized tax component in frozen presentation order', () => {
    expect(
      formatQuotationTaxLabel({
        taxKind: 'iva',
        taxRate: 27,
        taxComponents: [
          {
            componentKey: 'inc:8',
            vatRateId: 'inc-rate',
            taxKind: 'inc',
            taxRate: 8,
            taxableAmount: 100,
            taxAmount: 8,
            position: 1,
          },
          {
            componentKey: 'iva:19',
            vatRateId: 'iva-rate',
            taxKind: 'iva',
            taxRate: 19,
            taxableAmount: 100,
            taxAmount: 19,
            position: 0,
          },
        ],
      })
    ).toBe('IVA 19% + INC 8%');
  });

  it('uses the scalar summary only for legacy lines without component snapshots', () => {
    expect(formatQuotationTaxLabel({ taxKind: 'inc', taxRate: 8 })).toBe('INC 8%');
    expect(formatQuotationTaxLabel({ taxKind: 'iva', taxRate: 0, taxComponents: [] })).toBe('—');
  });
});
