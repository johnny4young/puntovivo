const DEFAULT_QUANTITY_DECIMALS = 3;

/**
 * Smallest operational quantity increment exposed by Puntovivo's forms.
 *
 * This is a renderer/input capability floor, not a server rejection rule:
 * legacy catalogs with a finer positive policy remain readable. Three
 * decimals cover kilograms, metres and common count/weight scale labels.
 */
export const MIN_OPERATIONAL_QUANTITY = 0.001;

/**
 * Resolve a sold/received quantity into its base-unit stock quantity.
 * Domain callers translate the RangeError into their transport-specific code.
 */
export function normalizedQuantity(quantity: number, equivalence: number): number {
  const normalized = quantity * equivalence;

  if (!Number.isFinite(normalized) || normalized <= 0) {
    throw new RangeError('The normalized quantity must be a finite positive number');
  }

  return normalized;
}

/** Round stock quantities without applying money semantics. */
export function roundQuantity(value: number, decimalPlaces = DEFAULT_QUANTITY_DECIMALS): number {
  if (!Number.isInteger(decimalPlaces) || decimalPlaces < 0 || decimalPlaces > 12) {
    throw new RangeError('Quantity decimal places must be an integer between 0 and 12');
  }

  const factor = 10 ** decimalPlaces;
  const rounded = Math.round(value * factor) / factor;
  return Object.is(rounded, -0) ? 0 : rounded;
}

/** Locale-aware quantity formatting with a common three-decimal default. */
export function formatQuantity(
  value: number,
  locales?: Intl.LocalesArgument,
  options: Intl.NumberFormatOptions = {}
): string {
  return new Intl.NumberFormat(locales, {
    minimumFractionDigits: 0,
    maximumFractionDigits: DEFAULT_QUANTITY_DECIMALS,
    ...options,
  }).format(value);
}
