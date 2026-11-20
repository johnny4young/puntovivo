const quantityFormatters = new Map<string, Intl.NumberFormat>();

export function formatQuantity(value: number, locale: string): string {
  let formatter = quantityFormatters.get(locale);
  if (!formatter) {
    formatter = new Intl.NumberFormat(locale, { maximumFractionDigits: 2 });
    quantityFormatters.set(locale, formatter);
  }
  return formatter.format(value);
}
