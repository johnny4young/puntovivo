import { describe, expect, it } from 'vitest';
import {
  availabilitySlotsSchema,
  compileAvailability,
  resolveAvailabilityWindow,
  type AvailabilitySlot,
} from './availability.js';
const policy = (
  slots: AvailabilitySlot[],
  timeZone = 'America/Bogota',
  fromDate = '2026-01-01',
  untilDate: string | null = null
) =>
  compileAvailability({ ...resolveAvailabilityWindow({ fromDate, untilDate }, timeZone), slots });
describe('weekly effective availability', () => {
  it('validates non-overlapping weekly local minutes including explicit empty availability', () => {
    expect(availabilitySlotsSchema.parse([])).toEqual([]);
    const slot = { weekday: 1, startMinute: 480, endMinute: 720 };
    expect(
      availabilitySlotsSchema.safeParse([slot, { ...slot, startMinute: 720, endMinute: 960 }])
        .success
    ).toBe(true);
    for (const value of [
      [slot, slot],
      [{ ...slot, weekday: 0 }],
      [{ ...slot, endMinute: 1441 }],
      [{ ...slot, startMinute: 480.5 }],
      [{ ...slot, endMinute: 480 }],
      [{ ...slot, unknown: true }],
      Array.from({ length: 57 }, () => slot),
    ])
      expect(availabilitySlotsSchema.safeParse(value).success).toBe(false);
  });
  it('requires coverage through gaps, not only at the first and last minute', () => {
    const allows = policy([
      { weekday: 1, startMinute: 480, endMinute: 720 },
      { weekday: 1, startMinute: 780, endMinute: 960 },
    ]);
    expect(allows('2026-09-07T13:00:00.000Z', '2026-09-07T17:00:00.000Z')).toBe(true);
    expect(allows('2026-09-07T13:00:00.000Z', '2026-09-07T21:00:00.000Z')).toBe(false);
    expect(allows('2026-09-07T17:00:00.000Z', '2026-09-07T18:00:00.000Z')).toBe(false);
    expect(allows('2026-09-08T13:00:00.000Z', '2026-09-08T17:00:00.000Z')).toBe(false);
  });
  it('does not synthesize restriction outside the effective half-open period', () => {
    const allows = policy([], 'America/Bogota', '2026-09-07', '2026-09-09');
    expect(allows('2026-09-07T04:00:00.000Z', '2026-09-07T05:00:00.000Z')).toBe(true);
    expect(allows('2026-09-07T04:00:00.000Z', '2026-09-07T05:00:00.001Z')).toBe(false);
    expect(allows('2026-09-09T05:00:00.000Z', '2026-09-09T06:00:00.000Z')).toBe(true);
  });
  it('joins midnight and week boundaries without 23:59 gaps', () => {
    const allows = policy([
      { weekday: 7, startMinute: 1320, endMinute: 1440 },
      { weekday: 1, startMinute: 0, endMinute: 120 },
    ]);
    expect(allows('2026-09-07T03:00:00.000Z', '2026-09-07T07:00:00.000Z')).toBe(true);
    expect(allows('2026-09-07T03:00:00.000Z', '2026-09-07T07:00:00.001Z')).toBe(false);
  });
  it('admits both repeated local windows but not the hidden fall-back gap', () => {
    const allows = policy([{ weekday: 7, startMinute: 90, endMinute: 105 }], 'America/New_York');
    expect(allows('2026-11-01T05:30:00.000Z', '2026-11-01T05:45:00.000Z')).toBe(true);
    expect(allows('2026-11-01T06:30:00.000Z', '2026-11-01T06:45:00.000Z')).toBe(true);
    expect(allows('2026-11-01T05:30:00.000Z', '2026-11-01T06:45:00.000Z')).toBe(false);
  });
  it('admits spring-forward real time and handles Santiago skipped midnight', () => {
    expect(
      policy([{ weekday: 7, startMinute: 60, endMinute: 240 }], 'America/New_York')(
        '2026-03-08T06:00:00.000Z',
        '2026-03-08T08:00:00.000Z'
      )
    ).toBe(true);
    const window = resolveAvailabilityWindow(
      { fromDate: '2026-09-06', untilDate: '2026-09-07' },
      'America/Santiago'
    );
    expect(window.startsAt).toBe('2026-09-06T04:00:00.000Z');
    expect(
      compileAvailability({ ...window, slots: [{ weekday: 7, startMinute: 0, endMinute: 120 }] })(
        '2026-09-06T04:00:00.000Z',
        '2026-09-06T05:00:00.000Z'
      )
    ).toBe(true);
  });
  it('handles fractional instants and fractional-hour zones without endpoint rounding', () => {
    const allows = policy([{ weekday: 1, startMinute: 480, endMinute: 540 }], 'Asia/Kathmandu');
    expect(allows('2026-09-07T02:15:00.001Z', '2026-09-07T03:15:00.000Z')).toBe(true);
    expect(allows('2026-09-07T02:15:00.001Z', '2026-09-07T03:15:00.001Z')).toBe(false);
  });
  it('rejects malformed instants, unbounded shifts and invalid policy data', () => {
    const allows = policy([]);
    for (const [from, until] of [
      ['bad', 'bad'],
      ['2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z'],
      ['2026-01-01T00:00:00Z', '2026-01-03T00:00:00Z'],
    ])
      expect(allows(from!, until!)).toBe(false);
    expect(() =>
      resolveAvailabilityWindow({ fromDate: '2026-02-30', untilDate: null }, 'UTC')
    ).toThrow();
    expect(() =>
      resolveAvailabilityWindow({ fromDate: '2026-09-07', untilDate: '2026-09-07' }, 'UTC')
    ).toThrow();
    expect(() => policy([], 'Unknown/Nowhere')).toThrow();
  });
});
