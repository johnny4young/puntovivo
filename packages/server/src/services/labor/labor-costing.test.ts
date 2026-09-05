import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  aggregateOperationalCostTotals,
  estimateOperationalShiftCost,
  type OperationalCostAttendanceRow,
  type OperationalCostContract,
  type OperationalCostWindow,
} from './labor-costing.js';

const employee = (
  overrides: Partial<OperationalCostAttendanceRow> = {}
): OperationalCostAttendanceRow => ({
  id: 'attendance',
  userId: 'employee',
  userName: 'Employee',
  siteId: 'site',
  siteName: 'Central',
  clockedInAt: '2026-03-01T05:00:00.000Z',
  clockedOutAt: '2026-03-01T13:00:00.000Z',
  breaks: [],
  ...overrides,
});

const contract = (overrides: Partial<OperationalCostContract> = {}): OperationalCostContract => ({
  userId: 'employee',
  siteId: 'site',
  position: 'Cashier',
  effectiveFrom: '2026-01-01',
  effectiveUntil: null,
  timeZone: 'America/Bogota',
  currencyCode: 'COP',
  payBasis: 'hourly',
  payAmount: 10,
  costingHourlyRate: null,
  ...overrides,
});

const window = (startsAt: string, endsAt: string): OperationalCostWindow => ({
  startsAt,
  endsAt,
  observedAt: endsAt,
});

describe('operational labor cost projection', () => {
  it('clips long attendance to adjacent report windows without double-counting', () => {
    const row = employee({
      clockedInAt: '2026-03-01T04:00:00.000Z',
      clockedOutAt: '2026-03-03T06:00:00.000Z',
    });
    const windows = [
      window('2026-02-28T05:00:00.000Z', '2026-03-01T05:00:00.000Z'),
      window('2026-03-01T05:00:00.000Z', '2026-03-02T05:00:00.000Z'),
      window('2026-03-02T05:00:00.000Z', '2026-03-03T05:00:00.000Z'),
      window('2026-03-03T05:00:00.000Z', '2026-03-04T05:00:00.000Z'),
    ];
    const results = windows.map(item => estimateOperationalShiftCost(row, [contract()], item));
    expect(results.map(item => item.workedSeconds)).toEqual([3_600, 86_400, 86_400, 3_600]);
    expect(results.reduce((sum, item) => sum + item.workedSeconds, 0)).toBe(50 * 3_600);
    expect(results.reduce((sum, item) => sum + (item.components[0]?.amount ?? 0), 0)).toBe(500);
  });

  it('splits at a frozen DST contract boundary and subtracts a crossing break once', () => {
    const result = estimateOperationalShiftCost(
      employee({
        clockedInAt: '2026-03-09T03:00:00.000Z',
        clockedOutAt: '2026-03-09T06:00:00.000Z',
        breaks: [{ startedAt: '2026-03-09T03:30:00.000Z', endedAt: '2026-03-09T04:30:00.000Z' }],
      }),
      [
        contract({
          effectiveUntil: '2026-03-09',
          timeZone: 'America/New_York',
          payAmount: 10,
        }),
        contract({
          effectiveFrom: '2026-03-09',
          timeZone: 'America/New_York',
          currencyCode: 'USD',
          payAmount: 20,
        }),
      ],
      window('2026-03-08T05:00:00.000Z', '2026-03-10T05:00:00.000Z')
    );
    expect(result).toMatchObject({
      workedSeconds: 7_200,
      pricedSeconds: 7_200,
      unavailableSeconds: 0,
      status: 'complete',
      components: [
        { currencyCode: 'COP', amount: 5 },
        { currencyCode: 'USD', amount: 30 },
      ],
      reasons: [],
    });
  });

  it('keeps uncovered time explicit when dated terms have a gap', () => {
    const result = estimateOperationalShiftCost(
      employee({
        clockedInAt: '2026-03-01T05:00:00.000Z',
        clockedOutAt: '2026-03-04T05:00:00.000Z',
      }),
      [contract({ effectiveUntil: '2026-03-02' }), contract({ effectiveFrom: '2026-03-03' })],
      window('2026-03-01T05:00:00.000Z', '2026-03-04T05:00:00.000Z')
    );
    expect(result).toMatchObject({
      workedSeconds: 72 * 3_600,
      pricedSeconds: 48 * 3_600,
      unavailableSeconds: 24 * 3_600,
      status: 'partial',
      components: [{ currencyCode: 'COP', amount: 480 }],
      reasons: ['employment_terms_missing'],
    });
  });

  it('fails closed for overlapping terms instead of selecting or double-pricing a wage', () => {
    const result = estimateOperationalShiftCost(
      employee(),
      [contract(), contract({ effectiveFrom: '2026-02-01', payAmount: 20 })],
      window('2026-03-01T05:00:00.000Z', '2026-03-02T05:00:00.000Z')
    );
    expect(result).toMatchObject({
      workedSeconds: 8 * 3_600,
      pricedSeconds: 0,
      unavailableSeconds: 8 * 3_600,
      status: 'unavailable',
      components: [],
      reasons: ['employment_terms_overlap'],
    });
  });

  it('turns invalid boundaries and unsafe arithmetic into unavailable evidence, not exceptions', () => {
    const invalid = estimateOperationalShiftCost(
      employee(),
      [contract({ timeZone: 'Invalid/Zone' })],
      window('2026-03-01T05:00:00.000Z', '2026-03-02T05:00:00.000Z')
    );
    expect(invalid).toMatchObject({
      status: 'unavailable',
      reasons: ['employment_terms_missing', 'invalid_contract_boundary'],
    });

    const unsafe = estimateOperationalShiftCost(
      employee({
        clockedInAt: '2026-03-01T05:00:00.000Z',
        clockedOutAt: '2026-03-05T09:00:00.000Z',
      }),
      [contract({ payAmount: 1_000_000_000_000 })],
      window('2026-03-01T05:00:00.000Z', '2026-03-05T09:00:00.000Z')
    );
    expect(unsafe).toMatchObject({
      workedSeconds: 100 * 3_600,
      pricedSeconds: 0,
      unavailableSeconds: 100 * 3_600,
      status: 'unavailable',
      components: [],
      reasons: ['unsafe_money_range'],
    });
  });

  it('omits an overflowing currency aggregate instead of displaying a partial total', () => {
    expect(
      aggregateOperationalCostTotals([
        { components: [{ currencyCode: 'COP', amount: 50_000_000_000_000 }] },
        {
          components: [
            { currencyCode: 'USD', amount: 12.34 },
            { currencyCode: 'COP', amount: 50_000_000_000_000 },
          ],
        },
      ])
    ).toEqual({
      totals: [{ currencyCode: 'USD', amount: 12.34 }],
      unavailableTotalCurrencies: ['COP'],
    });
  });

  it('partitions arbitrary attendance and breaks across report windows exactly once', () => {
    const base = Date.parse('2026-03-01T00:00:00.000Z');
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 86_399 }),
        fc.integer({ min: 1, max: 5 * 86_400 }),
        fc.nat(),
        fc.nat(),
        (offset, duration, breakStartSeed, breakLengthSeed) => {
          const start = base + offset * 1_000;
          const end = start + duration * 1_000;
          const breakStartOffset = breakStartSeed % duration;
          const maxBreakLength = duration - breakStartOffset;
          const breakLength = maxBreakLength === 0 ? 0 : breakLengthSeed % (maxBreakLength + 1);
          const breaks =
            breakLength === 0
              ? []
              : [
                  {
                    startedAt: new Date(start + breakStartOffset * 1_000).toISOString(),
                    endedAt: new Date(
                      start + (breakStartOffset + breakLength) * 1_000
                    ).toISOString(),
                  },
                ];
          const row = employee({
            clockedInAt: new Date(start).toISOString(),
            clockedOutAt: new Date(end).toISOString(),
            breaks,
          });
          const daily = Array.from({ length: 7 }, (_, index) =>
            estimateOperationalShiftCost(
              row,
              [contract({ effectiveFrom: '2020-01-01', timeZone: 'UTC', payAmount: 3_600 })],
              window(
                new Date(base + index * 86_400_000).toISOString(),
                new Date(base + (index + 1) * 86_400_000).toISOString()
              )
            )
          );
          const expected = duration - breakLength;
          expect(daily.reduce((sum, item) => sum + item.workedSeconds, 0)).toBe(expected);
          expect(daily.reduce((sum, item) => sum + (item.components[0]?.amount ?? 0), 0)).toBe(
            expected
          );
        }
      ),
      { numRuns: 200 }
    );
  });
});
