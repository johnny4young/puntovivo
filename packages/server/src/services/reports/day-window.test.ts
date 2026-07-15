import { describe, expect, it } from 'vitest';
import { calendarDayInTimeZone, resolveUtcDayWindow } from './day-window.js';

describe('tenant-local report day windows (ENG-141a)', () => {
  it('resolves a fixed-offset LATAM day as a half-open UTC interval', () => {
    expect(resolveUtcDayWindow('2026-07-14', 'America/Bogota')).toEqual({
      startIso: '2026-07-14T05:00:00.000Z',
      endExclusiveIso: '2026-07-15T05:00:00.000Z',
    });
  });

  it('preserves 23-hour and 25-hour DST calendar days', () => {
    const spring = resolveUtcDayWindow('2026-03-08', 'America/New_York');
    const fall = resolveUtcDayWindow('2026-11-01', 'America/New_York');

    expect(Date.parse(spring.endExclusiveIso) - Date.parse(spring.startIso)).toBe(
      23 * 60 * 60 * 1000
    );
    expect(Date.parse(fall.endExclusiveIso) - Date.parse(fall.startIso)).toBe(25 * 60 * 60 * 1000);
  });

  it('uses the first real instant when a LATAM DST transition skips midnight', () => {
    expect(resolveUtcDayWindow('2026-09-06', 'America/Santiago')).toEqual({
      startIso: '2026-09-06T04:00:00.000Z',
      endExclusiveIso: '2026-09-07T03:00:00.000Z',
    });
  });

  it('maps instants to the tenant calendar day and rejects invalid dates or zones', () => {
    expect(calendarDayInTimeZone(new Date('2026-07-15T03:30:00.000Z'), 'America/Bogota')).toBe(
      '2026-07-14'
    );
    expect(() => resolveUtcDayWindow('2026-02-30', 'America/Bogota')).toThrow(RangeError);
    expect(() => resolveUtcDayWindow('2026-07-14', 'Mars/Olympus_Mons')).toThrow(RangeError);
    expect(() => resolveUtcDayWindow('2011-12-30', 'Pacific/Apia')).toThrow(
      'Calendar day 2011-12-30 does not exist'
    );
  });
});
