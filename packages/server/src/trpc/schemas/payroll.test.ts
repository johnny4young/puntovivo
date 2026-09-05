import { describe, expect, it } from 'vitest';
import {
  createPayrollPeriodInput,
  createPayrollProfileInput,
  createPayrollRunInput,
  recalculatePayrollRunInput,
} from './payroll.js';

describe('payroll transport contracts', () => {
  it('accepts only minimal transfer details and half-open effective profiles', () => {
    expect(
      createPayrollProfileInput.parse({
        profile: {
          userId: 'employee-1',
          siteId: 'site-1',
          countryCode: 'CO',
          identificationType: 'CC',
          identificationNumber: '123456789',
          contributorType: '01',
          contributorSubtype: null,
          contractKind: 'indefinite',
          integralSalary: false,
          arlRiskClass: 1,
          healthEntity: 'EPS Example',
          pensionEntity: 'Pension Example',
          compensationFund: 'CCF Example',
          transportAssistanceEligible: true,
          paymentMethod: 'transfer',
          paymentAccountLast4: '4321',
          effectiveFrom: '2026-09-01',
          effectiveUntil: null,
        },
        reason: 'Initial reviewed payroll profile',
      }).profile.paymentAccountLast4
    ).toBe('4321');
  });

  it('rejects full account-like values and invalid payment-method combinations', () => {
    const base = {
      userId: 'employee-1',
      siteId: 'site-1',
      countryCode: 'CO',
      identificationType: 'CC',
      identificationNumber: '123456789',
      contributorType: '01',
      contributorSubtype: null,
      contractKind: 'indefinite',
      integralSalary: false,
      arlRiskClass: 1,
      healthEntity: null,
      pensionEntity: null,
      compensationFund: null,
      transportAssistanceEligible: false,
      effectiveFrom: '2026-09-01',
      effectiveUntil: null,
    };
    for (const profile of [
      { ...base, paymentMethod: 'transfer', paymentAccountLast4: '1234567890' },
      { ...base, paymentMethod: 'cash', paymentAccountLast4: '1234' },
    ]) {
      expect(
        createPayrollProfileInput.safeParse({
          profile,
          reason: 'Invalid payment evidence is rejected',
        }).success
      ).toBe(false);
    }
  });

  it('rejects inverted periods and adjustment runs without an approved source identity', () => {
    expect(
      createPayrollPeriodInput.safeParse({
        countryCode: 'CO',
        frequency: 'monthly',
        fromDate: '2026-09-30',
        untilDate: '2026-09-01',
        payDate: '2026-09-30',
        currencyCode: 'COP',
        reason: 'Invalid inverted payroll period',
      }).success
    ).toBe(false);
    expect(
      createPayrollPeriodInput.safeParse({
        countryCode: 'CO',
        frequency: 'monthly',
        fromDate: '2026-08-01',
        untilDate: '2026-09-02',
        payDate: '2026-09-05',
        currencyCode: 'COP',
        reason: 'Invalid payroll period longer than one month',
      }).success
    ).toBe(false);
    expect(
      createPayrollRunInput.safeParse({
        periodId: 'period-1',
        kind: 'adjustment',
        originalRunId: null,
        reason: 'Adjustment requires an approved source',
      }).success
    ).toBe(false);
  });

  it('rejects duplicate employees and unknown settlement fields', () => {
    const employee = {
      userId: 'employee-1',
      payrollDays: 30,
      ordinaryWorkedSeconds: null,
      employeeClassification: 'private_cst',
      holidayCalendarReviewed: true,
      employeeRestDayReviewed: true,
      contributionExemption: 'does_not_apply',
      contributionBaseAmount: 2_000_000,
      transportAssistance: 'does_not_apply',
      withholding: {
        status: 'complete',
        amount: 0,
        reason: 'Reviewed withholding for this period',
      },
      benefitsReviewed: true,
      reviewReason: 'Reviewed against employee and payroll evidence',
      manualConcepts: [],
    } as const;
    expect(
      recalculatePayrollRunInput.safeParse({
        runId: 'run-1',
        expectedVersion: 1,
        policyAcknowledged: true,
        employees: [employee, employee],
        reason: 'Recalculate reviewed employee results',
      }).success
    ).toBe(false);
    expect(
      recalculatePayrollRunInput.safeParse({
        runId: 'run-1',
        expectedVersion: 1,
        policyAcknowledged: true,
        employees: [{ ...employee, rawBankAccount: 'not-accepted' }],
        reason: 'Recalculate reviewed employee results',
      }).success
    ).toBe(false);
  });
});
