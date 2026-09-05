import { describe, expect, it } from 'vitest';
import {
  colombiaPayrollLimitationCodes,
  freezeColombiaPayrollPolicy,
  resolveColombiaPayrollPolicy,
} from './policy.js';

describe('Colombia pre-payroll policy provenance', () => {
  it('fails closed before the first reviewed policy window', () => {
    expect(resolveColombiaPayrollPolicy('2025-12-31')).toBeNull();
    expect(resolveColombiaPayrollPolicy('2027-01-01')).toBeNull();
  });

  it('rejects malformed or year-zero business dates', () => {
    for (const date of ['2026-02-30', '0000-01-01', '2026/01/01']) {
      expect(() => resolveColombiaPayrollPolicy(date)).toThrow();
    }
  });

  it('resolves the transitional 2026 facts and keeps every limitation explicit', () => {
    const policy = resolveColombiaPayrollPolicy('2026-09-04');
    expect(policy).toMatchObject({
      policyVersion: 'co-prepayroll-2026-42h-transitional-v2',
      countryCode: 'CO',
      legalStatus: 'transitional_pending_judicial_review',
      minimumMonthlyWage: 1_750_905,
      transportAssistance: 249_095,
      weeklyRegularSeconds: 151_200,
      nightStartMinute: 1_140,
      restDayPremiumRate: 0.9,
    });
    expect(policy?.limitations).toEqual(colombiaPayrollLimitationCodes);
    expect(policy?.sourceUrls).toHaveLength(8);
    expect(policy?.sourceUrls.every(url => url.startsWith('https://'))).toBe(true);
  });

  it('switches rest-day and weekly-hour rules on their exact statutory dates', () => {
    expect(resolveColombiaPayrollPolicy('2026-06-30')).toMatchObject({
      policyVersion: 'co-prepayroll-2026-h1-transitional-v2',
      weeklyRegularSeconds: 44 * 60 * 60,
      restDayPremiumRate: 0.8,
    });
    expect(resolveColombiaPayrollPolicy('2026-07-01')).toMatchObject({
      policyVersion: 'co-prepayroll-2026-rest90-transitional-v2',
      weeklyRegularSeconds: 44 * 60 * 60,
      restDayPremiumRate: 0.9,
    });
    expect(resolveColombiaPayrollPolicy('2026-07-15')).toMatchObject({
      policyVersion: 'co-prepayroll-2026-42h-transitional-v2',
      weeklyRegularSeconds: 42 * 60 * 60,
      restDayPremiumRate: 0.9,
    });
  });

  it('freezes source-backed contribution and IBC parameters', () => {
    expect(resolveColombiaPayrollPolicy('2026-09-04')).toMatchObject({
      employeeHealthRate: 0.04,
      employerHealthRate: 0.085,
      employeePensionRate: 0.04,
      employerPensionRate: 0.12,
      compensationFundRate: 0.04,
      senaRate: 0.02,
      icbfRate: 0.03,
      integralSalaryIbcRate: 0.7,
      integralSalaryMinimumWageMultiples: 13,
      maximumIbcMinimumWageMultiples: 25,
      transportAssistanceMaximumWageMultiples: 2,
      arlRiskRates: {
        '1': 0.00522,
        '2': 0.01044,
        '3': 0.02436,
        '4': 0.0435,
        '5': 0.0696,
      },
      solidarityPensionBrackets: [
        {
          fromMinimumWageMultiples: 4,
          fromInclusive: true,
          upToMinimumWageMultiples: 16,
          rate: 0.01,
        },
        {
          fromMinimumWageMultiples: 16,
          fromInclusive: false,
          upToMinimumWageMultiples: 17,
          rate: 0.012,
        },
        {
          fromMinimumWageMultiples: 17,
          fromInclusive: false,
          upToMinimumWageMultiples: 18,
          rate: 0.014,
        },
        {
          fromMinimumWageMultiples: 18,
          fromInclusive: false,
          upToMinimumWageMultiples: 19,
          rate: 0.016,
        },
        {
          fromMinimumWageMultiples: 19,
          fromInclusive: false,
          upToMinimumWageMultiples: 20,
          rate: 0.018,
        },
        {
          fromMinimumWageMultiples: 20,
          fromInclusive: false,
          upToMinimumWageMultiples: null,
          rate: 0.02,
        },
      ],
    });
  });

  it('returns owned copies instead of exposing the policy registry', () => {
    const first = freezeColombiaPayrollPolicy('2026-09-04');
    expect(first).not.toBeNull();
    first!.limitations.pop();
    first!.sourceUrls.length = 0;
    const next = freezeColombiaPayrollPolicy('2026-09-04');
    expect(next?.limitations).toHaveLength(colombiaPayrollLimitationCodes.length);
    expect(next?.sourceUrls).toHaveLength(8);
  });
});
