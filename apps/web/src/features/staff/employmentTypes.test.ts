import { describe, expect, it } from 'vitest';
import {
  employmentTermsFromForm,
  isEmploymentDate,
  parseEmploymentMoney,
  type EmploymentFormValues,
} from './employmentTypes';

describe('employment form value boundaries', () => {
  it.each(['', ' ', '-1', '1.001', '1e3', 'Infinity', 'NaN', '1,000', '1000000000000.01'])(
    'does not invent or round money from %s',
    value => expect(parseEmploymentMoney(value)).toBeNull()
  );
  it.each([
    ['0', 0],
    ['100.10', 100.1],
    ['1000000000000', 1e12],
  ] as const)('preserves explicit %s', (value, amount) =>
    expect(parseEmploymentMoney(value)).toBe(amount)
  );
  it.each(['2026-02-29', '2026-04-31', '0000-01-01', '', '2026-1-01'])(
    'rejects normalized calendar date %s',
    date => expect(isEmploymentDate(date)).toBe(false)
  );
  it('allows leap days without applying a host timezone', () =>
    expect(isEmploymentDate('2028-02-29')).toBe(true));
  it('keeps unknown monthly cost and open end null but permits explicit zero', () => {
    const values: EmploymentFormValues = {
      userId: 'worker',
      siteId: 'site',
      position: ' Worker ',
      effectiveFrom: '2026-01-01',
      effectiveUntil: '',
      payBasis: 'monthly',
      payAmount: '0',
      costingHourlyRate: '',
      reason: 'Explicit approved terms',
    };
    expect(employmentTermsFromForm(values, 'COP')).toMatchObject({
      position: 'Worker',
      effectiveUntil: null,
      pay: { basis: 'monthly', amount: 0, costingHourlyRate: null },
    });
    expect(employmentTermsFromForm({ ...values, costingHourlyRate: '0' }, 'COP').pay).toEqual({
      basis: 'monthly',
      amount: 0,
      costingHourlyRate: 0,
    });
    expect(() => employmentTermsFromForm({ ...values, payAmount: '' }, 'COP')).toThrow();
  });
});
