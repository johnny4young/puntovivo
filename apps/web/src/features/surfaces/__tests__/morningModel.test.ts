import { describe, expect, it } from 'vitest';
import { todayFixture } from '@/features/dashboard/today/fixtures';
import {
  curvePeaks,
  floatSummary,
  greetingAt,
  groupBySite,
  isBeforeOpening,
  openingIn,
  type MorningRegister,
} from '../morningModel';

const register = (siteId: string, registerName: string, openingFloat: number): MorningRegister => ({
  siteId,
  siteName: siteId,
  registerName,
  openingFloat,
});

describe('morning model', () => {
  it('is before opening only while nothing sold, opened or waits to be received', () => {
    const closed = { sales: { ...todayFixture().sales, total: 0, orders: 0 }, registers: [] };
    expect(isBeforeOpening(todayFixture({ ...closed, awaitingHandoffs: [] }))).toBe(true);
    expect(isBeforeOpening(todayFixture())).toBe(false);
    expect(
      isBeforeOpening(
        todayFixture({
          ...closed,
          awaitingHandoffs: [
            {
              id: 'h',
              siteId: 's',
              registerName: 'Caja 1',
              fromUserName: 'Laura',
              toUserName: null,
              handedOverAt: '2026-11-11T06:00:00.000Z',
            },
          ],
        })
      )
    ).toBe(false);
  });

  it('greets by the business hour', () => {
    const dayStartIso = '2026-11-11T05:00:00.000Z';
    expect(greetingAt({ dayStartIso, generatedAt: '2026-11-11T12:05:00.000Z' })).toBe('morning');
    expect(greetingAt({ dayStartIso, generatedAt: '2026-11-11T18:00:00.000Z' })).toBe('afternoon');
    expect(greetingAt({ dayStartIso, generatedAt: '2026-11-12T01:00:00.000Z' })).toBe('evening');
  });

  it('picks the two busiest hours at least two hours apart, in time order', () => {
    const rows = [
      { hour: 12, value: 900 },
      { hour: 13, value: 850 },
      { hour: 18, value: 700 },
      { hour: 9, value: 100 },
    ];
    expect(curvePeaks(rows)).toEqual([12, 18]);
    expect(curvePeaks([{ hour: 9, value: 0 }])).toEqual([]);
  });

  it('says each when every drawer starts the same, the total otherwise', () => {
    expect(
      floatSummary([register('a', 'Caja 1', 200000), register('a', 'Caja 2', 200000)])
    ).toEqual({ kind: 'each', amount: 200000 });
    expect(floatSummary([register('a', 'Caja 1', 200000)])).toEqual({
      kind: 'single',
      amount: 200000,
    });
    expect(floatSummary([register('a', 'Caja 1', 100000), register('a', 'Caja 2', 50000)])).toEqual(
      { kind: 'total', amount: 150000 }
    );
    expect(floatSummary([register('a', 'Caja 1', 0)])).toBeNull();
  });

  it('groups registers by site and finds the first shift of today while it is ahead', () => {
    expect(
      groupBySite([register('a', '1', 0), register('b', '1', 0), register('a', '2', 0)]).map(
        group => group.map(row => `${row.siteId}${row.registerName}`)
      )
    ).toEqual([['a1', 'a2'], ['b1']]);
    const shift = (startsAt: string) => ({
      userId: 'u',
      userName: 'Laura',
      siteId: 's',
      startsAt,
      endsAt: '2026-11-11T22:00:00.000Z',
    });
    const day = {
      dayStartIso: '2026-11-11T05:00:00.000Z',
      generatedAt: '2026-11-11T12:05:30.000Z',
    };
    // A night shift that began yesterday is not today's opening.
    expect(
      openingIn({
        ...day,
        shifts: [shift('2026-11-11T03:00:00.000Z'), shift('2026-11-11T12:30:00.000Z')],
      })
    ).toEqual({ at: '2026-11-11T12:30:00.000Z', minutes: 25 });
    expect(openingIn({ ...day, shifts: [shift('2026-11-11T12:00:00.000Z')] })).toBeNull();
    expect(openingIn({ ...day, shifts: [] })).toBeNull();
  });
});
