/** Cache formatter configuration, never a formatted value or tenant-owned date. */
const formatters = new Map<string, Intl.DateTimeFormat>();
const MAX_FORMATTERS = 64;

export function dateTimeFormatter(
  locale: string,
  options: Intl.DateTimeFormatOptions
): Intl.DateTimeFormat {
  // Without an explicit zone the OS can change the default during this process.
  // Avoid retaining that ambient setting; resolved tenant dates always have one.
  if (!options.timeZone) return new Intl.DateTimeFormat(locale, options);
  const entries = Object.entries(options)
    .filter(([, value]) => value !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const key = JSON.stringify([locale, entries]);
  const cached = formatters.get(key);
  if (cached) return cached;
  const formatter = new Intl.DateTimeFormat(locale, options);
  if (formatters.size >= MAX_FORMATTERS) formatters.delete(formatters.keys().next().value!);
  formatters.set(key, formatter);
  return formatter;
}
