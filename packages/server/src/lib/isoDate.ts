/**
 * Strict ISO-8601 calendar parsing for persisted date strings.
 *
 * Why this exists. `Date.parse` is not a validator: it rejects a month or
 * day outside its numeric range (`2026-13-01`, `2026-01-32`) but silently
 * rolls an impossible calendar date FORWARD into the next month
 * (`2026-02-30` becomes March 2nd, `2026-06-31` becomes July 1st,
 * `2026-02-29` in a non-leap year becomes March 1st). A fail-closed rule
 * built on `Number.isFinite(Date.parse(value))` therefore accepts exactly
 * the corrupt values it is meant to reject, and treats them as a valid
 * instant a couple of days later.
 *
 * The parser here validates the calendar components explicitly — month
 * 1-12, day within that month's real length under the Gregorian leap rule,
 * and in-range clock fields — before handing the string to `Date.parse`.
 * Anything it cannot prove is a real instant returns `null`, so callers can
 * fail closed on it.
 *
 * @module lib/isoDate
 */

/** `YYYY-MM-DD`, with no time component. */
export const ISO_DATE_ONLY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * `YYYY-MM-DDTHH:mm[:ss[.sss]][Z|±HH:MM]`. The zone is optional because
 * rows written before the schema tightened may omit it; a zone-less
 * timestamp is anchored to UTC rather than to the host's local time, which
 * is the same convention the date-only form already uses.
 */
const ISO_TIMESTAMP_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,9})?)?(Z|[+-]\d{2}:\d{2})?$/;

/** Real length of a Gregorian month (1-indexed). */
function daysInMonth(year: number, month: number): number {
  if (month === 2) {
    const isLeap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
    return isLeap ? 29 : 28;
  }
  return month === 4 || month === 6 || month === 9 || month === 11 ? 30 : 31;
}

/**
 * Parse an ISO date (`YYYY-MM-DD`) or ISO timestamp into epoch
 * milliseconds, rejecting anything that is not a real calendar instant.
 * A date-only value resolves to midnight UTC of that date.
 *
 * @returns Epoch milliseconds, or `null` when the string is malformed or
 *   names a date that does not exist.
 */
export function parseStrictIsoInstant(value: string): number | null {
  const dateOnly = ISO_DATE_ONLY_PATTERN.exec(value);
  const parts = dateOnly ?? ISO_TIMESTAMP_PATTERN.exec(value);
  if (!parts) return null;

  const year = Number(parts[1]);
  const month = Number(parts[2]);
  const day = Number(parts[3]);
  if (month < 1 || month > 12) return null;
  if (day < 1 || day > daysInMonth(year, month)) return null;

  if (!dateOnly) {
    const hour = Number(parts[4]);
    const minute = Number(parts[5]);
    const second = parts[6] === undefined ? 0 : Number(parts[6]);
    // Leap seconds and the ISO `24:00` end-of-day form are rejected: neither
    // is a value this codebase writes, and guessing at them would reopen the
    // normalisation hole this parser closes.
    if (hour > 23 || minute > 59 || second > 59) return null;
  }

  const normalized = dateOnly
    ? `${value}T00:00:00.000Z`
    : parts[7] === undefined
      ? `${value}Z`
      : value;
  const time = Date.parse(normalized);
  return Number.isFinite(time) ? time : null;
}

/** True when `value` is a real ISO date or timestamp. */
export function isStrictIsoInstant(value: string): boolean {
  return parseStrictIsoInstant(value) !== null;
}
