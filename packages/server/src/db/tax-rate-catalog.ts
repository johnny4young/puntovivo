import type { TaxKind } from './schema.js';

export interface SeedTaxRateDefinition {
  name: string;
  rate: number;
  kind: TaxKind;
}

const COUNTRY_TAX_RATES = {
  CO: [
    { name: 'IVA 0%', rate: 0, kind: 'iva' },
    { name: 'IVA 5%', rate: 5, kind: 'iva' },
    { name: 'IVA 19%', rate: 19, kind: 'iva' },
    { name: 'INC 8%', rate: 8, kind: 'inc' },
  ],
  MX: [
    { name: 'IVA 0%', rate: 0, kind: 'iva' },
    { name: 'IVA 8%', rate: 8, kind: 'iva' },
    { name: 'IVA 16%', rate: 16, kind: 'iva' },
  ],
  CL: [{ name: 'IVA 19%', rate: 19, kind: 'iva' }],
} as const satisfies Record<string, readonly SeedTaxRateDefinition[]>;

export type SeedTaxCountryCode = keyof typeof COUNTRY_TAX_RATES;

export function seedTaxRatesForCountry(countryCode: string): readonly SeedTaxRateDefinition[] {
  const normalized = countryCode.toUpperCase() as SeedTaxCountryCode;
  return COUNTRY_TAX_RATES[normalized] ?? COUNTRY_TAX_RATES.CO;
}

/**
 * Map the Colombia-shaped product fixtures to the selected demo country.
 * This is deliberately a seed-only policy: production catalog edits always
 * require the operator to pick a real tenant-owned rate.
 */
export function resolveSeedProductTaxRate(
  countryCode: string,
  fixtureRateName: string
): SeedTaxRateDefinition {
  const rates = seedTaxRatesForCountry(countryCode);
  const exact = rates.find(rate => rate.name === fixtureRateName);
  if (exact) return exact;

  if (countryCode.toUpperCase() === 'MX') {
    if (fixtureRateName === 'IVA 5%') return rates.find(rate => rate.rate === 8)!;
    return rates.find(rate => rate.rate === 16)!;
  }

  if (countryCode.toUpperCase() === 'CL') {
    return rates[0]!;
  }

  return COUNTRY_TAX_RATES.CO[0];
}
