import { describe, expect, it } from 'vitest';
import {
  availabilityWindowFields,
  formatAvailabilityMinute,
  normalizeAvailabilityWindows,
  type AvailabilityWindowFields,
} from './availabilityTypes';

const window = (overrides: Partial<AvailabilityWindowFields> = {}): AvailabilityWindowFields => ({
  weekday: 1,
  start: '09:00',
  end: '17:00',
  nextDay: false,
  ...overrides,
});
describe('availability window normalization', () => {
  it('preserves an explicit unavailable week and does not mutate input', () => {
    expect(normalizeAvailabilityWindows([])).toEqual([]);
    const input = [window({ weekday: 5 }), window()];
    expect(normalizeAvailabilityWindows(input)?.map(slot => slot.weekday)).toEqual([1, 5]);
    expect(input.map(slot => slot.weekday)).toEqual([5, 1]);
  });
  it('splits an overnight Sunday into Sunday and Monday without timezone conversion', () => {
    expect(
      normalizeAvailabilityWindows([
        window({ weekday: 7, start: '22:00', end: '02:00', nextDay: true }),
      ])
    ).toEqual([
      { weekday: 1, startMinute: 0, endMinute: 120 },
      { weekday: 7, startMinute: 1320, endMinute: 1440 },
    ]);
  });
  it('represents exactly 24 hours and omits empty midnight segments', () => {
    expect(
      normalizeAvailabilityWindows([window({ start: '00:00', end: '00:00', nextDay: true })])
    ).toEqual([{ weekday: 1, startMinute: 0, endMinute: 1440 }]);
    expect(
      normalizeAvailabilityWindows([window({ start: '09:00', end: '09:00', nextDay: true })])
    ).toEqual([
      { weekday: 1, startMinute: 540, endMinute: 1440 },
      { weekday: 2, startMinute: 0, endMinute: 540 },
    ]);
    expect(formatAvailabilityMinute(1440)).toBe('24:00');
  });
  it.each([
    { weekday: 0 },
    { weekday: 8 },
    { weekday: 1.5 },
    { weekday: NaN },
    { start: '' },
    { start: '9:00' },
    { start: '24:00' },
    { start: '09:60' },
    { end: '17:00:01' },
    { end: 'garbage' },
    { end: '09:00' },
    { end: '08:00' },
    { nextDay: true },
  ])('rejects invalid or ambiguous input %j', overrides => {
    expect(normalizeAvailabilityWindows([window(overrides)])).toBeNull();
  });
  it('rejects overlaps, duplicates and overlap across the Sunday boundary, but accepts adjacency', () => {
    expect(normalizeAvailabilityWindows([window(), window()])).toBeNull();
    expect(normalizeAvailabilityWindows([window(), window({ start: '16:00' })])).toBeNull();
    expect(
      normalizeAvailabilityWindows([
        window({ weekday: 7, start: '22:00', end: '02:00', nextDay: true }),
        window({ start: '01:59', end: '03:00' }),
      ])
    ).toBeNull();
    expect(
      normalizeAvailabilityWindows([window(), window({ start: '17:00', end: '18:00' })])
    ).toHaveLength(2);
  });
  it('limits normalized day components rather than only input rows', () => {
    const windows = Array.from({ length: 56 }, (_, index) =>
      window({
        start: formatAvailabilityMinute(index + 100),
        end: formatAvailabilityMinute(index + 101),
      })
    );
    expect(normalizeAvailabilityWindows(windows)).toHaveLength(56);
    expect(normalizeAvailabilityWindows([...windows, window({ weekday: 3 })])).toBeNull();
    expect(
      normalizeAvailabilityWindows([
        ...windows.slice(0, 55),
        window({ weekday: 7, start: '22:00', end: '00:01', nextDay: true }),
      ])
    ).toBeNull();
  });
  it('round-trips every minute boundary including end-of-day without losing a minute', () => {
    for (let day = 1; day <= 7; day++) {
      for (let minute = 0; minute < 1440; minute++) {
        const slots = [{ weekday: day, startMinute: minute, endMinute: minute + 1 }];
        expect(normalizeAvailabilityWindows(availabilityWindowFields(slots))).toEqual(slots);
      }
    }
  });
});
