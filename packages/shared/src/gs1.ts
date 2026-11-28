/** Prefixes reserved for variable-measure labels generated inside a store. */
export const GS1_IN_STORE_PREFIXES = [
  '20',
  '21',
  '22',
  '23',
  '24',
  '25',
  '26',
  '27',
  '28',
  '29',
] as const;

export type Gs1InStorePrefix = (typeof GS1_IN_STORE_PREFIXES)[number];
export type Gs1PrefixRole = 'weight' | 'price';

export const GS1_SCHEMES = ['none', 'generic', 'co', 'mx', 'cl'] as const;
export type Gs1Scheme = (typeof GS1_SCHEMES)[number];

/** Divisor applied to 5-digit GS1 price payloads: 100 for cents, 1 for whole currency units (COP/CLP). */
export const GS1_PRICE_DIVISORS = [1, 100] as const;
export type Gs1PriceDivisor = (typeof GS1_PRICE_DIVISORS)[number];
export const DEFAULT_GS1_PRICE_DIVISOR: Gs1PriceDivisor = 100;

export function isGs1PriceDivisor(value: unknown): value is Gs1PriceDivisor {
  return value === 1 || value === 100;
}

export interface Gs1PrefixConfig {
  weight: ReadonlyArray<Gs1InStorePrefix>;
  price: ReadonlyArray<Gs1InStorePrefix>;
}

/** Historical Puntovivo mapping: even prefixes carry grams, odd prefixes cents. */
export const DEFAULT_GS1_PREFIX_CONFIG: Gs1PrefixConfig = {
  weight: ['20', '22', '24', '26', '28'],
  price: ['21', '23', '25', '27', '29'],
};

/** One shared runtime guard for renderer JSON and persisted server config. */
export function isGs1PrefixConfig(value: unknown): value is Gs1PrefixConfig {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const candidate = value as { weight?: unknown; price?: unknown };
  if (!Array.isArray(candidate.weight) || !Array.isArray(candidate.price)) return false;

  // Keep the renderer guard identical to the server's strict Zod object.
  // Otherwise a typo such as `prices` could look valid in the typed editor
  // and then be rejected only after the operator submits the form.
  const keys = Object.keys(value);
  if (keys.length !== 2 || keys.some(key => key !== 'weight' && key !== 'price')) return false;

  const prefixes = [...candidate.weight, ...candidate.price];
  return (
    prefixes.length > 0 &&
    prefixes.every(
      prefix =>
        typeof prefix === 'string' && GS1_IN_STORE_PREFIXES.includes(prefix as Gs1InStorePrefix)
    ) &&
    new Set(prefixes).size === prefixes.length
  );
}

/**
 * Resolve one prefix to its configured role. Ambiguous maps fail closed even
 * if an unvalidated legacy caller bypasses the server-side configuration
 * schema.
 */
export function resolveGs1PrefixRole(
  prefix: string,
  config: Gs1PrefixConfig = DEFAULT_GS1_PREFIX_CONFIG
): Gs1PrefixRole | null {
  const isWeight = config.weight.includes(prefix as Gs1InStorePrefix);
  const isPrice = config.price.includes(prefix as Gs1InStorePrefix);
  if (isWeight === isPrice) return null;
  return isWeight ? 'weight' : 'price';
}

/** True for a digit-only EAN-8/UPC-A/EAN-13 whose mod-10 check digit fails; other codes are internal. */
export function hasInvalidGs1CheckDigit(barcode: string | null | undefined): boolean {
  const code = barcode?.trim() ?? '';
  if (!/^\d+$/.test(code) || (code.length !== 8 && code.length !== 12 && code.length !== 13)) {
    return false;
  }
  let sum = 0;
  for (let i = code.length - 2, weight = 3; i >= 0; i--, weight = 4 - weight) {
    sum += Number(code[i]) * weight;
  }
  return (10 - (sum % 10)) % 10 !== Number(code[code.length - 1]);
}
