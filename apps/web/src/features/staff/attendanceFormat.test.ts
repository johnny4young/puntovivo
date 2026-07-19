import { describe, expect, it } from 'vitest';
import {
  formatAttendanceDate,
  formatAttendanceDateTime,
  formatAttendanceTime,
  formatDuration,
} from './attendanceFormat';

describe('attendance formatting (ENG-140b)', () => {
  it('formats instants in the frozen tenant timezone', () => {
    const instant = '2026-07-14T13:30:00.000Z';
    expect(formatAttendanceTime(instant, 'America/Bogota', 'en-US')).toBe('8:30 AM');
    expect(formatAttendanceDateTime(instant, 'America/Bogota', 'en-US')).toContain('8:30 AM');
    expect(formatAttendanceDate('2026-07-15', 'en-US')).toBe('Jul 15, 2026');
  });

  it('formats durations without inventing fractional minutes', () => {
    expect(formatDuration(Number.NaN)).toBe('0m');
    expect(formatDuration(Number.POSITIVE_INFINITY)).toBe('0m');
    expect(formatDuration(-60)).toBe('0m');
    expect(formatDuration(59)).toBe('0m');
    expect(formatDuration(60)).toBe('1m');
    expect(formatDuration(3_600)).toBe('1h');
    expect(formatDuration(5_430)).toBe('1h 30m');
  });
});
