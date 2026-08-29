import { describe, expect, it } from 'vitest';
import {
  assertTaxComponentsRepresentable,
  calculateTaxComponentSnapshots,
  legacyComponent,
  summarizeTaxComponents,
  type TaxComponentDefinition,
} from './tax-components.js';

const components: TaxComponentDefinition[] = [
  {
    componentKey: 'vat:iva-19',
    vatRateId: 'iva-19',
    taxKind: 'iva',
    taxRate: 19,
    position: 0,
  },
  {
    componentKey: 'vat:inc-8',
    vatRateId: 'inc-8',
    taxKind: 'inc',
    taxRate: 8,
    position: 1,
  },
];

describe('normalized tax components', () => {
  it('splits one inclusive line into frozen IVA and INC without changing the header', () => {
    const result = calculateTaxComponentSnapshots({
      components,
      unitPrice: 127,
      quantity: 1,
      discountPercent: 0,
      priceIncludesTax: true,
    });

    expect(result).toMatchObject({ lineBase: 100, lineTax: 27, lineTotal: 127 });
    expect(result.components).toEqual([
      expect.objectContaining({ taxKind: 'iva', taxableAmount: 100, taxAmount: 19 }),
      expect.objectContaining({ taxKind: 'inc', taxableAmount: 100, taxAmount: 8 }),
    ]);
    expect(result.components.reduce((sum, component) => sum + component.taxAmount, 0)).toBe(
      result.lineTax
    );
    expect(summarizeTaxComponents(result.components)).toMatchObject({
      taxKind: 'iva',
      taxRate: 27,
    });
  });

  it('keeps the same component amounts in exclusive mode and adds them to the base', () => {
    const result = calculateTaxComponentSnapshots({
      components,
      unitPrice: 100,
      quantity: 1,
      discountPercent: 0,
      priceIncludesTax: false,
    });
    expect(result).toMatchObject({ lineBase: 100, lineTax: 27, lineTotal: 127 });
  });

  it('builds one normalized component for a legacy summary', () => {
    expect(legacyComponent({ vatRateId: null, taxKind: 'iva', taxRate: 19 })).toEqual({
      componentKey: 'legacy:iva:19.000000',
      vatRateId: null,
      taxKind: 'iva',
      taxRate: 19,
      position: 0,
    });
  });

  it('allows mixed components for Colombia and rejects lossy MX/CL serialization', () => {
    expect(() => assertTaxComponentsRepresentable('CO', components)).not.toThrow();
    for (const countryCode of ['MX', 'CL']) {
      try {
        assertTaxComponentsRepresentable(countryCode, components);
        throw new Error('Expected country policy to reject the combination');
      } catch (error) {
        expect((error as { cause?: { errorCode?: string } }).cause?.errorCode).toBe(
          'TAX_COMPONENTS_UNREPRESENTABLE'
        );
      }
    }
  });

  it('rejects duplicates and more than four components', () => {
    expect(() => summarizeTaxComponents([...components, components[0]!])).toThrow();
    expect(() =>
      summarizeTaxComponents(
        Array.from({ length: 5 }, (_, position) => ({
          ...components[0]!,
          componentKey: `vat:${position}`,
          vatRateId: String(position),
          position,
        }))
      )
    ).toThrow();
  });
});
