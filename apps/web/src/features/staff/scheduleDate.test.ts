import { describe, expect, it } from 'vitest';
import {
  addCalendarDays,
  calendarDateAt,
  formatShiftTime,
  startOfWeek,
  wallFieldsAt,
} from './scheduleDate';

describe('schedule calendar helpers', () => {
  it('builds locale-independent calendar weeks', () => {
    expect(startOfWeek('2026-07-15', 1)).toBe('2026-07-13');
    expect(startOfWeek('2026-07-15', 0)).toBe('2026-07-12');
    expect(addCalendarDays('2026-12-29', 4)).toBe('2027-01-02');
  });

  it('formats instants in the tenant timezone rather than the browser timezone', () => {
    expect(calendarDateAt(new Date('2026-07-21T02:00:00.000Z'), 'America/Bogota')).toBe(
      '2026-07-20'
    );
    expect(wallFieldsAt('2026-07-20T13:30:00.000Z', 'America/Bogota')).toEqual({
      date: '2026-07-20',
      time: '08:30',
    });
  });

  it('formats shift times in the requested locale and timezone', () => {
    expect(formatShiftTime('2026-07-15T14:30:00.000Z', 'America/Bogota', 'en-US')).toBe('09:30 AM');
  });
});
