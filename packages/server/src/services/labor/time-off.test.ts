import { describe, expect, it } from 'vitest';
import {
  canAdvanceTimeOff,
  resolveTimeOffWindow,
  TIME_OFF_STATUSES,
  timeOffWindowSchema,
} from './time-off.js';
import { createTimeOffInput } from '../../trpc/schemas/timeOff.js';

describe('operational time-off policy', () => {
  it.each([
    ['America/Bogota', '2026-09-04', '2026-09-05', 24],
    ['America/Santiago', '2026-09-06', '2026-09-07', 23],
    ['America/New_York', '2026-11-01', '2026-11-02', 25],
    ['America/New_York', '2026-03-08', '2026-03-09', 23],
  ])('freezes real calendar duration in %s from %s', (zone, fromDate, untilDate, hours) => {
    const result = resolveTimeOffWindow({ fromDate, untilDate }, zone);
    expect((Date.parse(result.endsAt) - Date.parse(result.startsAt)) / 3_600_000).toBe(hours);
    expect(result).toMatchObject({ fromDate, untilDate, timeZone: zone });
  });
  it('uses the first real instant on a skipped LATAM midnight', () => {
    expect(
      resolveTimeOffWindow({ fromDate: '2026-09-06', untilDate: '2026-09-07' }, 'America/Santiago')
    ).toMatchObject({ startsAt: '2026-09-06T04:00:00.000Z', endsAt: '2026-09-07T03:00:00.000Z' });
  });
  it.each([
    ['2026-02-30', '2026-03-02'],
    ['0000-01-01', '2026-01-01'],
    ['2026-01-02', '2026-01-01'],
    ['2026-01-01', '2026-01-01'],
    ['2026-01-01', '2027-01-03'],
  ])('rejects malformed, empty, reversed or unbounded dates %s to %s', (fromDate, untilDate) => {
    expect(timeOffWindowSchema.safeParse({ fromDate, untilDate }).success).toBe(false);
    expect(
      createTimeOffInput.safeParse({
        fromDate,
        untilDate,
        userId: 'worker',
        siteId: 'site',
        kind: 'vacation',
        reason: 'Explicit operational reason',
      }).success
    ).toBe(false);
  });
  it('preserves validation when extending the refined calendar schema', () => {
    expect(
      createTimeOffInput.parse({
        fromDate: '2026-01-01',
        untilDate: '2026-01-02',
        userId: 'worker',
        siteId: 'site',
        kind: 'vacation',
        reason: 'Explicit operational reason',
      }).kind
    ).toBe('vacation');
  });
  it('admits only explicit closed lifecycle edges', () => {
    for (const current of TIME_OFF_STATUSES) {
      for (const next of ['approved', 'rejected', 'cancelled'] as const) {
        expect(canAdvanceTimeOff(current, next)).toBe(
          current === 'pending' || (current === 'approved' && next === 'cancelled')
        );
      }
    }
  });
});
