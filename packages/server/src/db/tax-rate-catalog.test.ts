import { describe, expect, it } from 'vitest';
import { resolveSeedProductTaxRate, seedTaxRatesForCountry } from './tax-rate-catalog.js';

describe('country-aware tax-rate seed catalog', () => {
  it('keeps the Colombia IVA and INC ladder', () => {
    expect(seedTaxRatesForCountry('CO')).toEqual([
      { name: 'IVA 0%', rate: 0, kind: 'iva' },
      { name: 'IVA 5%', rate: 5, kind: 'iva' },
      { name: 'IVA 19%', rate: 19, kind: 'iva' },
      { name: 'INC 8%', rate: 8, kind: 'inc' },
    ]);
  });

  it('uses the Mexico IVA ladder without inventing INC', () => {
    expect(seedTaxRatesForCountry('MX')).toEqual([
      { name: 'IVA 0%', rate: 0, kind: 'iva' },
      { name: 'IVA 8%', rate: 8, kind: 'iva' },
      { name: 'IVA 16%', rate: 16, kind: 'iva' },
    ]);
    expect(resolveSeedProductTaxRate('MX', 'INC 8%')).toEqual({
      name: 'IVA 16%',
      rate: 16,
      kind: 'iva',
    });
  });

  it('uses only Chile IVA 19 for the current demo profile', () => {
    expect(seedTaxRatesForCountry('CL')).toEqual([{ name: 'IVA 19%', rate: 19, kind: 'iva' }]);
    expect(resolveSeedProductTaxRate('CL', 'IVA 0%')).toEqual({
      name: 'IVA 19%',
      rate: 19,
      kind: 'iva',
    });
  });

  it('falls back to Colombia for an unsupported seed country', () => {
    expect(seedTaxRatesForCountry('ZZ')).toEqual(seedTaxRatesForCountry('CO'));
  });
});
