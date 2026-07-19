const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

function parseDate(date: string): Date {
  const match = DATE_PATTERN.exec(date);
  if (!match) throw new Error('Invalid calendar date');
  const value = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  if (
    value.getUTCFullYear() !== Number(match[1]) ||
    value.getUTCMonth() !== Number(match[2]) - 1 ||
    value.getUTCDate() !== Number(match[3])
  ) {
    throw new Error('Invalid calendar date');
  }
  return value;
}

function formatCalendarDate(value: Date): string {
  return `${String(value.getUTCFullYear()).padStart(4, '0')}-${String(
    value.getUTCMonth() + 1
  ).padStart(2, '0')}-${String(value.getUTCDate()).padStart(2, '0')}`;
}

export function addCalendarDays(date: string, days: number): string {
  const value = parseDate(date);
  value.setUTCDate(value.getUTCDate() + days);
  return formatCalendarDate(value);
}

export function startOfWeek(date: string, firstDayOfWeek: number): string {
  const value = parseDate(date);
  const delta = (value.getUTCDay() - firstDayOfWeek + 7) % 7;
  return addCalendarDays(date, -delta);
}

export function calendarDateAt(instant: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA-u-ca-iso8601', {
    timeZone,
    calendar: 'iso8601',
    numberingSystem: 'latn',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(instant);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find(item => item.type === type)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')}`;
}

export function wallFieldsAt(iso: string, timeZone: string): { date: string; time: string } {
  const parts = new Intl.DateTimeFormat('en-CA-u-ca-iso8601', {
    timeZone,
    calendar: 'iso8601',
    numberingSystem: 'latn',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(iso));
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find(item => item.type === type)?.value ?? '';
  return {
    date: `${part('year')}-${part('month')}-${part('day')}`,
    time: `${part('hour')}:${part('minute')}`,
  };
}

export function formatShiftTime(iso: string, timeZone: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(iso));
}
