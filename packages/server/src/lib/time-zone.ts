/**
 * Whether this runtime can resolve a named IANA time zone (including UTC and
 * supported aliases). Fixed numeric offsets are not company time zones: they
 * would discard daylight-saving and historical calendar rules.
 */
export function isSupportedTimeZone(timeZone: string): boolean {
  if (/^[+-]/.test(timeZone)) return false;
  try {
    new Intl.DateTimeFormat('en', { timeZone });
    return true;
  } catch (error) {
    if (error instanceof RangeError) return false;
    throw error;
  }
}
