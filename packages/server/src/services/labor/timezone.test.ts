import { describe, expect, it } from 'vitest';
import {
  addCalendarDays,
  calendarDateInTimeZone,
  createScheduleWallTimeResolver,
  zonedWallTimeToIso,
} from './timezone.js';

describe('labor timezone conversion', () => {
  it('converts tenant wall time without inheriting the host timezone', () => {
    expect(zonedWallTimeToIso('2026-07-20', '08:30', 'America/Bogota')).toBe(
      '2026-07-20T13:30:00.000Z'
    );
    expect(calendarDateInTimeZone('2026-07-21T02:00:00.000Z', 'America/Bogota')).toBe('2026-07-20');
  });

  it('rejects impossible calendar dates and DST gaps', () => {
    expect(() => zonedWallTimeToIso('2026-02-30', '08:00', 'America/Bogota')).toThrow(
      'Invalid schedule calendar date'
    );
    expect(() => zonedWallTimeToIso('2026-03-08', '02:30', 'America/New_York')).toThrow(
      'does not exist'
    );
  });

  it('chooses the earliest instant when a DST wall time repeats', () => {
    expect(zonedWallTimeToIso('2026-11-01', '01:30', 'America/New_York')).toBe(
      '2026-11-01T05:30:00.000Z'
    );
  });

  it('adds calendar days across month and year boundaries', () => {
    expect(addCalendarDays('2026-12-29', 4)).toBe('2027-01-02');
  });
  it('reuses a frozen-zone converter without retaining inputs or mixing concurrent zones', () => {
    const bogota = createScheduleWallTimeResolver('America/Bogota');
    const newYork = createScheduleWallTimeResolver('America/New_York');
    for (const [date, time] of [
      ['2026-09-07', '08:00'],
      ['2026-11-01', '01:30'],
      ['2026-03-08', '04:00'],
    ] as const) {
      expect(bogota(date, time)).toBe(zonedWallTimeToIso(date, time, 'America/Bogota'));
      expect(newYork(date, time)).toBe(zonedWallTimeToIso(date, time, 'America/New_York'));
    }
    expect(() => newYork('2026-03-08', '02:30')).toThrow('does not exist');
    expect(newYork('2026-03-08', '04:00')).toBe('2026-03-08T08:00:00.000Z');
    expect(() => createScheduleWallTimeResolver('Invalid/Zone')).toThrow();
  });
});
