import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  employmentContractTermsSchema,
  employmentIsEffective,
  employmentWindowsOverlap,
  estimateRegularLaborCost,
  workforceDateSchema,
} from './employment-contract.js';
import { roundMoney } from '../../lib/money.js';

const input = {
  userId: 'employee',
  siteId: 'site',
  position: 'Kitchen assistant',
  effectiveFrom: '2026-09-01',
  currencyCode: 'COP',
  pay: { basis: 'hourly', amount: 10_000 },
};
const terms = employmentContractTermsSchema.parse(input);

describe('explicit effective employment terms', () => {
  it('keeps work position separate from authorization and never defaults a wage', () => {
    expect(terms).toMatchObject({ position: 'Kitchen assistant', effectiveUntil: null });
    expect(employmentContractTermsSchema.safeParse({ ...input, role: 'admin' }).success).toBe(
      false
    );
    expect(employmentContractTermsSchema.safeParse({ ...input, pay: undefined }).success).toBe(
      false
    );
  });

  it.each([
    '2026-02-29',
    '2026-02-30',
    '0000-01-01',
    '2026-13-01',
    '2026-9-1',
    '2026-09-01T00:00:00Z',
  ])('rejects a non-canonical or impossible date: %s', date =>
    expect(workforceDateSchema.safeParse(date).success).toBe(false)
  );

  it('accepts leap days and forbids empty or inverted effective windows', () => {
    expect(workforceDateSchema.parse('2028-02-29')).toBe('2028-02-29');
    for (const effectiveUntil of ['2026-09-01', '2026-08-31']) {
      expect(employmentContractTermsSchema.safeParse({ ...input, effectiveUntil }).success).toBe(
        false
      );
    }
  });

  it.each([NaN, Infinity, -1, 0.001, 99.99000000000001, 1_000_000_000_001])(
    'rejects unsafe or ambiguous pay amount %s',
    amount => {
      expect(
        employmentContractTermsSchema.safeParse({ ...input, pay: { basis: 'hourly', amount } })
          .success
      ).toBe(false);
      expect(
        employmentContractTermsSchema.safeParse({
          ...input,
          pay: { basis: 'monthly', amount: 1000, costingHourlyRate: amount },
        }).success
      ).toBe(false);
    }
  );

  it('refuses two competing hourly authorities and undocumented currency normalization', () => {
    expect(
      employmentContractTermsSchema.safeParse({
        ...input,
        pay: { ...input.pay, costingHourlyRate: 25 },
      }).success
    ).toBe(false);
    expect(employmentContractTermsSchema.safeParse({ ...input, currencyCode: 'cop' }).success).toBe(
      false
    );
  });

  it('uses an exclusive end and allows adjacent terms', () => {
    const first = { effectiveFrom: '2026-09-01', effectiveUntil: '2026-10-01' };
    const next = { effectiveFrom: '2026-10-01', effectiveUntil: null };
    expect(employmentIsEffective(first, '2026-09-01')).toBe(true);
    expect(employmentIsEffective(first, '2026-10-01')).toBe(false);
    expect(employmentIsEffective(next, '2026-10-01')).toBe(true);
    expect(employmentIsEffective(first, '2026-08-31')).toBe(false);
    expect(employmentWindowsOverlap(first, next)).toBe(false);
    expect(employmentWindowsOverlap(next, first)).toBe(false);
    expect(employmentWindowsOverlap(first, { ...next, effectiveFrom: '2026-09-30' })).toBe(true);
    expect(() => employmentIsEffective(first, '2026-02-30')).toThrow();
  });

  it('makes overlap symmetric for finite and open-ended validated intervals', () => {
    const window = fc
      .tuple(
        fc.integer({ min: 1, max: 27 }),
        fc.option(fc.integer({ min: 1, max: 3 }), { nil: null })
      )
      .map(([start, length]) => ({
        effectiveFrom: `2026-09-${String(start).padStart(2, '0')}`,
        effectiveUntil:
          length === null ? null : `2026-09-${String(start + length).padStart(2, '0')}`,
      }));
    fc.assert(
      fc.property(window, window, (left, right) => {
        expect(employmentWindowsOverlap(left, right)).toBe(employmentWindowsOverlap(right, left));
        expect(employmentWindowsOverlap(left, left)).toBe(true);
      })
    );
  });
});

describe('regular-time operational costing, not payroll', () => {
  it('never invents a monthly salary divisor or treats missing rates as zero', () => {
    const monthly = employmentContractTermsSchema.parse({
      ...input,
      pay: { basis: 'monthly', amount: 2_000_000 },
    });
    expect(monthly.pay).toMatchObject({ costingHourlyRate: null });
    for (const seconds of [0, 3600, 160 * 3600]) {
      expect(estimateRegularLaborCost(monthly, seconds)).toEqual({
        available: false,
        currencyCode: 'COP',
        reason: 'monthly_costing_rate_missing',
      });
    }
  });

  it('uses only the explicit monthly costing rate, without changing monthly pay', () => {
    const monthly = employmentContractTermsSchema.parse({
      ...input,
      pay: { basis: 'monthly', amount: 2_000_000, costingHourlyRate: 12_000 },
    });
    expect(estimateRegularLaborCost(monthly, 1800)).toEqual({
      available: true,
      currencyCode: 'COP',
      amount: 6_000,
      hourlyRate: 12_000,
    });
    expect(monthly.pay.amount).toBe(2_000_000);
  });

  it('preserves an explicitly zero rate and applies shared half-away rounding', () => {
    const zero = employmentContractTermsSchema.parse({
      ...input,
      pay: { basis: 'hourly', amount: 0 },
    });
    expect(estimateRegularLaborCost(zero, 3600)).toMatchObject({ available: true, amount: 0 });
    const cent = employmentContractTermsSchema.parse({
      ...input,
      pay: { basis: 'hourly', amount: 0.01 },
    });
    expect(estimateRegularLaborCost(cent, 1800)).toMatchObject({ amount: 0.01 });
  });

  it.each([-1, 0.1, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])(
    'rejects invalid elapsed seconds %s',
    seconds => {
      expect(() => estimateRegularLaborCost(terms, seconds)).toThrow(RangeError);
    }
  );

  it('fails closed rather than returning an unsafe financial result', () => {
    const high = employmentContractTermsSchema.parse({
      ...input,
      pay: { basis: 'hourly', amount: 1_000_000_000_000 },
    });
    expect(() => estimateRegularLaborCost(high, Number.MAX_SAFE_INTEGER)).toThrow(RangeError);
  });

  it('retains currency and cent precision for bounded rates and durations', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 100_000_000 }),
        fc.integer({ min: 0, max: 31 * 86400 }),
        (cents, seconds) => {
          const hourly = employmentContractTermsSchema.parse({
            ...input,
            pay: { basis: 'hourly', amount: cents / 100 },
          });
          const result = estimateRegularLaborCost(hourly, seconds);
          expect(result.available).toBe(true);
          if (!result.available) throw new Error('Explicit hourly rate must be available');
          expect(result.currencyCode).toBe('COP');
          expect(result.amount).toBe(roundMoney(((cents / 100) * seconds) / 3600));
          expect(result.amount).toBeGreaterThanOrEqual(0);
        }
      )
    );
  });
});
