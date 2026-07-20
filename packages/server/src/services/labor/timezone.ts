/**
 * deterministic conversion between tenant wall time and UTC.
 *
 * Schedules are entered in the tenant's IANA timezone, not the browser or
 * server machine timezone. Intl is used instead of process-local Date parsing
 * so a manager travelling in another country still creates the intended
 * store shift. Non-existent DST wall times fail closed; repeated wall times
 * choose the earliest matching instant deterministically.
 */

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;

interface WallTimeParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
}

function parseWallTime(date: string, time: string): WallTimeParts {
  const dateMatch = DATE_PATTERN.exec(date);
  const timeMatch = TIME_PATTERN.exec(time);
  if (!dateMatch || !timeMatch) throw new Error('Invalid schedule wall time');

  const parts = {
    year: Number(dateMatch[1]),
    month: Number(dateMatch[2]),
    day: Number(dateMatch[3]),
    hour: Number(timeMatch[1]),
    minute: Number(timeMatch[2]),
  };
  const probe = new Date(
    Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute)
  );
  if (
    probe.getUTCFullYear() !== parts.year ||
    probe.getUTCMonth() !== parts.month - 1 ||
    probe.getUTCDate() !== parts.day
  ) {
    throw new Error('Invalid schedule calendar date');
  }
  return parts;
}

function partsAt(instantMs: number, timeZone: string): WallTimeParts {
  const formatted = new Intl.DateTimeFormat('en-CA-u-ca-iso8601', {
    timeZone,
    calendar: 'iso8601',
    numberingSystem: 'latn',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(instantMs));
  const value = (type: Intl.DateTimeFormatPartTypes) => {
    const raw = formatted.find(part => part.type === type)?.value;
    if (!raw) throw new Error(`Unable to resolve ${type} in ${timeZone}`);
    return Number(raw);
  };
  return {
    year: value('year'),
    month: value('month'),
    day: value('day'),
    hour: value('hour'),
    minute: value('minute'),
  };
}

function wallEpoch(parts: WallTimeParts): number {
  return Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute);
}

function sameWallTime(left: WallTimeParts, right: WallTimeParts): boolean {
  return (
    left.year === right.year &&
    left.month === right.month &&
    left.day === right.day &&
    left.hour === right.hour &&
    left.minute === right.minute
  );
}

/** Convert one tenant-local minute to a canonical UTC ISO timestamp. */
export function zonedWallTimeToIso(date: string, time: string, timeZone: string): string {
  const desired = parseWallTime(date, time);
  const desiredEpoch = wallEpoch(desired);

  // Iterate the observed zone offset to a fixed point. Two passes are enough
  // for ordinary offsets; four keep transitions and historical offsets safe.
  let candidate = desiredEpoch;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const observed = partsAt(candidate, timeZone);
    const delta = desiredEpoch - wallEpoch(observed);
    if (delta === 0) break;
    candidate += delta;
  }

  // Around a fall-back transition the same wall minute has two valid UTC
  // instants. Search a bounded window and choose the earliest one so retries,
  // tests, and audit snapshots always produce the same value.
  const matches: number[] = [];
  for (let offsetMinutes = -180; offsetMinutes <= 180; offsetMinutes += 15) {
    const possible = candidate + offsetMinutes * 60_000;
    if (sameWallTime(partsAt(possible, timeZone), desired)) matches.push(possible);
  }
  if (matches.length === 0) {
    throw new Error(`The local time ${date} ${time} does not exist in ${timeZone}`);
  }
  return new Date(Math.min(...matches)).toISOString();
}

/** Return YYYY-MM-DD for an instant in a frozen schedule timezone. */
export function calendarDateInTimeZone(iso: string, timeZone: string): string {
  const instant = Date.parse(iso);
  if (!Number.isFinite(instant)) throw new Error('Invalid schedule instant');
  const parts = partsAt(instant, timeZone);
  return `${String(parts.year).padStart(4, '0')}-${String(parts.month).padStart(2, '0')}-${String(
    parts.day
  ).padStart(2, '0')}`;
}

/** Calendar-day arithmetic that never inherits the host machine timezone. */
export function addCalendarDays(date: string, days: number): string {
  const parts = parseWallTime(date, '00:00');
  const value = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + days));
  return `${String(value.getUTCFullYear()).padStart(4, '0')}-${String(
    value.getUTCMonth() + 1
  ).padStart(2, '0')}-${String(value.getUTCDate()).padStart(2, '0')}`;
}
