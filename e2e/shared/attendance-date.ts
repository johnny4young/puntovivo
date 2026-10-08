/** Calendar dates for attendance fixtures, independent of the operator host timezone. */
export function attendanceDate(now: Date, timeZone: string, offsetDays = 0): string {
  // Mirror the schedule page's calendarDateAt: read parts instead of trusting
  // a locale's rendered pattern, and pin the calendar and digits.
  const parts = new Intl.DateTimeFormat('en-CA-u-ca-iso8601', {
    timeZone,
    calendar: 'iso8601',
    numberingSystem: 'latn',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find(item => item.type === type)?.value);
  const date = new Date(Date.UTC(part('year'), part('month') - 1, part('day') + offsetDays));
  return date.toISOString().slice(0, 10);
}
