const CALENDAR_DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function isCalendarDay(value: string): boolean {
  if (!CALENDAR_DAY_PATTERN.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

/** Keep invalid or half-edited date ranges out of the accounting API. */
export function isValidAccountingDateRange(from: string, to: string): boolean {
  return isCalendarDay(from) && isCalendarDay(to) && from <= to;
}
