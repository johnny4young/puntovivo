/**
 * The canonical IANA id this runtime resolves a named time zone to (including
 * UTC, aliases and any letter case), or null when it is unsupported. Bare
 * numeric offset strings are not company time zones: they would discard
 * daylight-saving and historical calendar rules.
 */
export function canonicalTimeZone(timeZone: string): string | null {
  if (/^[+-]/.test(timeZone)) return null;
  try {
    return new Intl.DateTimeFormat('en', { timeZone }).resolvedOptions().timeZone;
  } catch (error) {
    if (error instanceof RangeError) return null;
    throw error;
  }
}

/** Whether this runtime can resolve a named IANA time zone. */
export function isSupportedTimeZone(timeZone: string): boolean {
  return canonicalTimeZone(timeZone) !== null;
}
