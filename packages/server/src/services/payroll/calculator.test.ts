import { describe, expect, it } from 'vitest';
import {
  calculateColombiaPrePayroll,
  colombiaPrePayrollInputSchema,
  type ColombiaPrePayrollInput,
} from './calculator.js';

function input(overrides: Partial<ColombiaPrePayrollInput> = {}): ColombiaPrePayrollInput {
  return {
    policyDate: '2026-09-04',
    policyAcknowledged: true,
    currencyCode: 'COP',
    contract: {
      id: 'contract-1',
      version: 2,
      payBasis: 'monthly',
      payAmount: 2_000_000,
      integralSalary: false,
      arlRiskClass: 1,
    },
    settlement: {
      payrollDays: 30,
      ordinaryWorkedSeconds: null,
      employeeClassification: 'private_cst',
      holidayCalendarReviewed: true,
      employeeRestDayReviewed: true,
      contributionExemption: 'does_not_apply',
      contributionBaseAmount: 2_000_000,
      transportAssistance: 'applies',
      transportAssistanceEligible: true,
      withholding: {
        status: 'complete',
        amount: 0,
        reason: 'Reviewed withholding for this payroll period',
        sourceRefs: ['review:withholding-1'],
      },
      benefitsReviewed: true,
      reviewSourceRefs: {
        baseCompensation: ['review:payable-days-1'],
        employeeClassification: ['review:classification-1'],
        holidayCalendar: ['calendar:co-2026-v1'],
        employeeRestDay: ['contract:rest-day-1'],
        contributionExemption: ['review:exemption-1'],
        contributionBase: ['review:ibc-1'],
        transportAssistance: ['review:transport-1'],
        benefits: ['review:benefits-1'],
      },
    },
    manualConcepts: [],
    ...overrides,
  };
}

describe('Colombia reviewed pre-payroll calculator', () => {
  it('calculates salary, transport, deductions and non-exempt employer contributions', () => {
    const result = calculateColombiaPrePayroll(input());
    expect(result).toMatchObject({
      status: 'complete',
      policyVersion: 'co-prepayroll-2026-42h-transitional-v2',
      grossAmount: 2_249_095,
      deductionAmount: 160_000,
      netAmount: 2_089_095,
      employerContributionAmount: 600_440,
    });
    if (result.status !== 'complete') throw new Error('expected complete result');
    expect(result.concepts.map(line => line.code)).toEqual([
      'base_salary',
      'transport_assistance',
      'employee_health',
      'employee_pension',
      'employer_pension',
      'arl',
      'compensation_fund',
      'employer_health',
      'sena',
      'icbf',
    ]);
  });

  it('omits health, SENA and ICBF employer lines only after explicit exemption review', () => {
    const base = input();
    const result = calculateColombiaPrePayroll({
      ...base,
      settlement: { ...base.settlement, contributionExemption: 'applies' },
    });
    expect(result).toMatchObject({ status: 'complete', employerContributionAmount: 330_440 });
    if (result.status !== 'complete') throw new Error('expected complete result');
    expect(result.concepts.map(line => line.code)).not.toContain('employer_health');
    expect(result.concepts.map(line => line.code)).not.toContain('sena');
    expect(result.concepts.map(line => line.code)).not.toContain('icbf');
  });

  it('adds the solidarity pension rate only above four minimum wages', () => {
    const base = input();
    const contributionBaseAmount = 8_000_000;
    const result = calculateColombiaPrePayroll({
      ...base,
      contract: { ...base.contract, payAmount: contributionBaseAmount },
      settlement: {
        ...base.settlement,
        contributionBaseAmount,
        transportAssistance: 'does_not_apply',
      },
    });
    expect(result).toMatchObject({ status: 'complete', deductionAmount: 720_000 });
    if (result.status !== 'complete') throw new Error('expected complete result');
    expect(result.concepts.find(line => line.code === 'solidarity_pension')).toMatchObject({
      rate: 0.01,
      amount: 80_000,
    });
  });

  it('honors the exact inclusive and exclusive solidarity-pension bracket edges', () => {
    const base = input();
    const minimumWage = 1_750_905;
    const run = (contributionBaseAmount: number) =>
      calculateColombiaPrePayroll({
        ...base,
        contract: { ...base.contract, payAmount: contributionBaseAmount },
        settlement: {
          ...base.settlement,
          contributionBaseAmount,
          transportAssistance: 'does_not_apply',
        },
      });
    const atFour = run(minimumWage * 4);
    const atSixteen = run(minimumWage * 16);
    const aboveSixteen = run(minimumWage * 16 + 0.01);
    for (const result of [atFour, atSixteen, aboveSixteen]) {
      if (result.status !== 'complete') throw new Error('expected complete result');
    }
    expect(atFour.concepts.find(line => line.code === 'solidarity_pension')?.rate).toBe(0.01);
    expect(atSixteen.concepts.find(line => line.code === 'solidarity_pension')?.rate).toBe(0.01);
    expect(aboveSixteen.concepts.find(line => line.code === 'solidarity_pension')?.rate).toBe(
      0.012
    );
  });

  it('prorates monthly salary and transport by reviewed payable days', () => {
    const base = input();
    const result = calculateColombiaPrePayroll({
      ...base,
      settlement: { ...base.settlement, payrollDays: 15, contributionBaseAmount: 1_000_000 },
    });
    expect(result).toMatchObject({
      status: 'complete',
      grossAmount: 1_124_547.5,
      deductionAmount: 80_000,
      netAmount: 1_044_547.5,
    });
  });

  it('uses explicit attendance seconds for hourly contracts without a monthly divisor', () => {
    const base = input();
    const result = calculateColombiaPrePayroll({
      ...base,
      contract: { ...base.contract, payBasis: 'hourly', payAmount: 10_000 },
      settlement: {
        ...base.settlement,
        payrollDays: null,
        ordinaryWorkedSeconds: 8 * 3_600,
        contributionBaseAmount: 80_000,
        transportAssistance: 'does_not_apply',
      },
    });
    expect(result).toMatchObject({ status: 'complete', grossAmount: 80_000 });
    if (result.status !== 'complete') throw new Error('expected complete result');
    expect(result.concepts[0]).toMatchObject({
      code: 'base_salary',
      unit: 'seconds',
      quantity: 28_800,
      rate: 10_000,
      amount: 80_000,
    });
  });

  it('fails closed with every missing legal review and no partial money', () => {
    const base = input();
    const result = calculateColombiaPrePayroll({
      ...base,
      policyAcknowledged: false,
      settlement: {
        ...base.settlement,
        employeeClassification: 'review_required',
        holidayCalendarReviewed: false,
        employeeRestDayReviewed: false,
        contributionExemption: 'review_required',
        contributionBaseAmount: null,
        transportAssistance: 'review_required',
        withholding: { status: 'review_required' },
        benefitsReviewed: false,
      },
    });
    expect(result).toEqual({
      status: 'blocked',
      policyVersion: 'co-prepayroll-2026-42h-transitional-v2',
      blockers: [
        'benefits_review_required',
        'contribution_base_required',
        'contribution_exemption_review_required',
        'employee_classification_review_required',
        'employee_rest_day_review_required',
        'holiday_calendar_review_required',
        'policy_acknowledgement_required',
        'transport_assistance_review_required',
        'withholding_review_required',
      ],
      concepts: [],
      grossAmount: 0,
      deductionAmount: 0,
      netAmount: 0,
      employerContributionAmount: 0,
    });
  });

  it('rejects an invalid integral salary and mismatched 70 percent contribution base', () => {
    const base = input();
    const result = calculateColombiaPrePayroll({
      ...base,
      contract: { ...base.contract, integralSalary: true },
      settlement: {
        ...base.settlement,
        contributionBaseAmount: 2_000_000,
        transportAssistance: 'does_not_apply',
      },
    });
    expect(result).toMatchObject({
      status: 'blocked',
      blockers: ['integral_salary_ibc_mismatch', 'integral_salary_minimum_not_met'],
    });
  });

  it('rejects transport assistance when reviewed evidence contradicts the profile or threshold', () => {
    const base = input();
    const result = calculateColombiaPrePayroll({
      ...base,
      settlement: { ...base.settlement, transportAssistanceEligible: false },
    });
    expect(result).toMatchObject({
      status: 'blocked',
      blockers: ['transport_assistance_ineligible'],
    });
  });

  it('keeps reviewed manual concepts traceable and rejects duplicate category/code identities', () => {
    const base = input();
    const manual = {
      category: 'earning' as const,
      code: 'approved_bonus',
      label: 'Approved bonus',
      amount: 100_000,
      reason: 'Approved variable bonus for the period',
      sourceRefs: ['manual:bonus-approval-1'],
    };
    const result = calculateColombiaPrePayroll({ ...base, manualConcepts: [manual] });
    expect(result).toMatchObject({ status: 'complete', grossAmount: 2_349_095 });
    if (result.status !== 'complete') throw new Error('expected complete result');
    expect(result.concepts.find(line => line.code === manual.code)).toMatchObject({
      origin: 'manual',
      manualReason: manual.reason,
      sourceRefs: manual.sourceRefs,
    });
    expect(() =>
      colombiaPrePayrollInputSchema.parse({ ...base, manualConcepts: [manual, manual] })
    ).toThrow();
    expect(() =>
      colombiaPrePayrollInputSchema.parse({
        ...base,
        manualConcepts: [{ ...manual, category: 'deduction', code: 'employee_health' }],
      })
    ).toThrow();
  });

  it('rejects deductions beyond earnings instead of persisting a negative net result', () => {
    const base = input();
    const result = calculateColombiaPrePayroll({
      ...base,
      settlement: {
        ...base.settlement,
        withholding: {
          status: 'complete',
          amount: 3_000_000,
          reason: 'Reviewed withholding for this payroll period',
          sourceRefs: ['review:withholding-2'],
        },
      },
    });
    expect(result).toMatchObject({ status: 'blocked', blockers: ['deductions_exceed_earnings'] });
  });

  it('rejects a reviewed decision without a frozen evidence reference', () => {
    const base = input();
    expect(() =>
      colombiaPrePayrollInputSchema.parse({
        ...base,
        settlement: {
          ...base.settlement,
          reviewSourceRefs: {
            ...base.settlement.reviewSourceRefs,
            contributionBase: [],
          },
        },
      })
    ).toThrow(/source reference/);
  });
});
