import { describe, expect, it } from 'vitest';
import { calculateOvertime, type OvertimeShiftInput } from './overtime-calculator.js';
import type { OvertimeCountry } from './overtime-policy.js';

const HOUR = 3_600;

function shift(
  id: string,
  startedAt: string,
  endedAt: string,
  breaks: OvertimeShiftInput['breaks'] = []
): OvertimeShiftInput {
  return { id, userId: 'employee-1', startedAt, endedAt, breaks };
}

function calculate(countryCode: OvertimeCountry, shifts: OvertimeShiftInput[], timeZone = 'UTC') {
  return calculateOvertime({ countryCode, timeZone, firstDayOfWeek: 1, shifts });
}

describe('overtime calculator', () => {
  it('returns no allocations when there is no attendance evidence', () => {
    expect(calculate('CO', [])).toEqual(new Map());
  });

  it('subtracts breaks and classifies Colombia weekly overtime without double counting', () => {
    const shifts = Array.from({ length: 5 }, (_, day) =>
      shift(
        `shift-${day}`,
        `2026-07-${String(20 + day).padStart(2, '0')}T08:00:00.000Z`,
        `2026-07-${String(20 + day).padStart(2, '0')}T17:00:00.000Z`,
        [
          {
            startedAt: `2026-07-${String(20 + day).padStart(2, '0')}T12:00:00.000Z`,
            endedAt: `2026-07-${String(20 + day).padStart(2, '0')}T12:30:00.000Z`,
          },
        ]
      )
    );
    const result = calculate('CO', shifts);

    expect(result.get('shift-4')).toMatchObject({
      regularSeconds: 8 * HOUR,
      overtimeSeconds: 30 * 60,
      premiums: [{ code: 'co_day_overtime', multiplier: 1.25, seconds: 30 * 60 }],
    });
    expect([...result.values()].reduce((sum, item) => sum + item.regularSeconds, 0)).toBe(
      42 * HOUR
    );
  });

  it('splits Colombia overtime at the effective 19:00 night boundary', () => {
    const result = calculate('CO', [
      shift('day', '2026-07-20T00:00:00.000Z', '2026-07-21T18:00:00.000Z'),
      shift('overtime', '2026-07-21T18:00:00.000Z', '2026-07-21T20:00:00.000Z'),
    ]).get('overtime');

    expect(result?.premiums).toEqual([
      { code: 'co_day_overtime', multiplier: 1.25, seconds: HOUR },
      { code: 'co_night_overtime', multiplier: 1.75, seconds: HOUR },
    ]);
  });

  it('allocates Mexico weekly overtime to double and triple tiers', () => {
    const result = calculate(
      'MX',
      Array.from({ length: 6 }, (_, day) =>
        shift(
          `shift-${day}`,
          `2026-07-${String(20 + day).padStart(2, '0')}T08:00:00.000Z`,
          `2026-07-${String(20 + day).padStart(2, '0')}T18:00:00.000Z`
        )
      )
    );
    const totals = [...result.values()].reduce(
      (summary, allocation) => {
        summary.regular += allocation.regularSeconds;
        summary.overtime += allocation.overtimeSeconds;
        for (const premium of allocation.premiums) {
          summary.premiums[premium.code] = (summary.premiums[premium.code] ?? 0) + premium.seconds;
        }
        return summary;
      },
      { regular: 0, overtime: 0, premiums: {} as Record<string, number> }
    );

    expect(totals).toEqual({
      regular: 48 * HOUR,
      overtime: 12 * HOUR,
      premiums: {
        mx_double_overtime: 9 * HOUR,
        mx_triple_overtime: 3 * HOUR,
      },
    });
  });

  it('allocates Peru daily overtime after eight hours to 25 and 35 percent tiers', () => {
    const result = calculate('PE', [
      shift('long-day', '2026-07-20T08:00:00.000Z', '2026-07-20T20:00:00.000Z'),
    ]).get('long-day');

    expect(result).toEqual({
      regularSeconds: 8 * HOUR,
      overtimeSeconds: 4 * HOUR,
      premiums: [
        { code: 'pe_first_two_overtime', multiplier: 1.25, seconds: 2 * HOUR },
        { code: 'pe_additional_overtime', multiplier: 1.35, seconds: 2 * HOUR },
      ],
      policyIds: ['PE-48H'],
    });
  });

  it('uses Chile weekly-only threshold and preserves cross-midnight elapsed time', () => {
    const result = calculate('CL', [
      shift('week', '2026-07-20T08:00:00.000Z', '2026-07-22T03:00:00.000Z'),
    ]).get('week');

    expect(result).toMatchObject({ regularSeconds: 42 * HOUR, overtimeSeconds: HOUR });
  });

  it('classifies Argentina Saturday afternoon overtime at the rest-day rate', () => {
    const regularWeek = Array.from({ length: 5 }, (_, day) =>
      shift(
        `weekday-${day}`,
        `2026-07-${String(20 + day).padStart(2, '0')}T08:00:00.000Z`,
        `2026-07-${String(20 + day).padStart(2, '0')}T17:00:00.000Z`
      )
    );
    const result = calculate('AR', [
      ...regularWeek,
      shift('saturday-regular', '2026-07-25T09:00:00.000Z', '2026-07-25T12:00:00.000Z'),
      shift('saturday-overtime', '2026-07-25T12:00:00.000Z', '2026-07-25T15:00:00.000Z'),
    ]).get('saturday-overtime');

    expect(result?.premiums).toEqual([
      { code: 'ar_ordinary_overtime', multiplier: 1.5, seconds: HOUR },
      { code: 'ar_rest_day_overtime', multiplier: 2, seconds: 2 * HOUR },
    ]);
  });

  it('merges overlapping breaks defensively instead of subtracting them twice', () => {
    const result = calculate('PE', [
      shift('breaks', '2026-07-20T08:00:00.000Z', '2026-07-20T18:00:00.000Z', [
        { startedAt: '2026-07-20T12:00:00.000Z', endedAt: '2026-07-20T13:00:00.000Z' },
        { startedAt: '2026-07-20T12:30:00.000Z', endedAt: '2026-07-20T13:30:00.000Z' },
      ]),
    ]).get('breaks');

    expect(result).toMatchObject({ regularSeconds: 8 * HOUR, overtimeSeconds: 30 * 60 });
  });

  it('resets daily thresholds at midnight in the tenant timezone', () => {
    const result = calculate(
      'PE',
      [shift('local-midnight', '2026-07-22T03:00:00.000Z', '2026-07-22T13:00:00.000Z')],
      'America/Bogota'
    ).get('local-midnight');

    expect(result).toMatchObject({ regularSeconds: 10 * HOUR, overtimeSeconds: 0 });
  });
});
