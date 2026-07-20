/**
 * tenant-local calendar day boundaries.
 *
 * Business reports accept a calendar day (YYYY-MM-DD), not a UTC range. This
 * helper resolves both local midnights through Intl so America/Bogota and DST
 * zones produce the correct UTC instants without adding a timezone dependency.
 * Callers use the half-open interval [start, end) to avoid 23:59:59.999 gaps.
 */

const DAY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

interface CalendarParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

export interface UtcDayWindow {
  startIso: string;
  endExclusiveIso: string;
}

function parseCalendarDay(day: string): Pick<CalendarParts, 'year' | 'month' | 'day'> {
  const match = DAY_RE.exec(day);
  if (!match) throw new RangeError(`Invalid calendar day: ${day}`);

  const year = Number(match[1]);
  const month = Number(match[2]);
  const date = Number(match[3]);
  const normalized = new Date(Date.UTC(year, month - 1, date));
  if (
    normalized.getUTCFullYear() !== year ||
    normalized.getUTCMonth() !== month - 1 ||
    normalized.getUTCDate() !== date
  ) {
    throw new RangeError(`Invalid calendar day: ${day}`);
  }
  return { year, month, day: date };
}

function addCalendarDays(day: string, amount: number): string {
  const parsed = parseCalendarDay(day);
  const next = new Date(Date.UTC(parsed.year, parsed.month - 1, parsed.day + amount));
  return next.toISOString().slice(0, 10);
}

function partsInZone(instant: Date, timeZone: string): CalendarParts {
  const formatter = new Intl.DateTimeFormat('en-CA-u-ca-iso8601', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });
  const values = new Map(
    formatter
      .formatToParts(instant)
      .filter(part => part.type !== 'literal')
      .map(part => [part.type, Number(part.value)])
  );
  return {
    year: values.get('year') ?? 0,
    month: values.get('month') ?? 0,
    day: values.get('day') ?? 0,
    hour: values.get('hour') ?? 0,
    minute: values.get('minute') ?? 0,
    second: values.get('second') ?? 0,
  };
}

function observedOffsetMs(instant: Date, timeZone: string): number {
  const observed = partsInZone(instant, timeZone);
  return (
    Date.UTC(
      observed.year,
      observed.month - 1,
      observed.day,
      observed.hour,
      observed.minute,
      observed.second
    ) - instant.getTime()
  );
}

/**
 * Resolve the first real instant belonging to a local calendar day.
 *
 * Most days begin at 00:00, but some LATAM DST transitions skip local
 * midnight entirely (for example America/Santiago on 2026-09-06). Sampling
 * offsets on both sides of the boundary produces candidates for each side of
 * an offset transition; the earliest candidate that formats back to the
 * target day is its true start (01:00 for that Santiago date).
 */
function localDayStartToUtc(day: string, timeZone: string): Date {
  const target = parseCalendarDay(day);
  const targetAsUtc = Date.UTC(target.year, target.month - 1, target.day);
  const probeOffsets = [-36, -12, 0, 12, 36].map(hours =>
    observedOffsetMs(new Date(targetAsUtc + hours * 60 * 60 * 1000), timeZone)
  );
  const candidates = [...new Set(probeOffsets)]
    .map(offset => new Date(targetAsUtc - offset))
    .filter(candidate => {
      const observed = partsInZone(candidate, timeZone);
      return (
        observed.year === target.year &&
        observed.month === target.month &&
        observed.day === target.day
      );
    })
    .sort((left, right) => left.getTime() - right.getTime());

  const first = candidates[0];
  if (!first) {
    throw new RangeError(`Calendar day ${day} does not exist in timezone ${timeZone}`);
  }
  return first;
}

/** Return the UTC half-open range for one tenant-local calendar day. */
export function resolveUtcDayWindow(day: string, timeZone: string): UtcDayWindow {
  const start = localDayStartToUtc(day, timeZone);
  const end = localDayStartToUtc(addCalendarDays(day, 1), timeZone);
  return { startIso: start.toISOString(), endExclusiveIso: end.toISOString() };
}

/** Calendar day containing an instant in the supplied IANA timezone. */
export function calendarDayInTimeZone(instant: Date, timeZone: string): string {
  const parts = partsInZone(instant, timeZone);
  return `${String(parts.year).padStart(4, '0')}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}`;
}
