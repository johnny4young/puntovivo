/** Fail-closed Colombia pre-payroll arithmetic over explicitly reviewed evidence. */
import { z } from 'zod';
import { roundMoney, tryRoundMoneyToSafeCents } from '../../lib/money.js';
import { resolveColombiaPayrollPolicy } from './policy.js';

const MAX_MONEY = 1_000_000_000_000;
const moneySchema = z
  .number()
  .finite()
  .nonnegative()
  .max(MAX_MONEY)
  .refine(value => roundMoney(value) === value, 'Use at most two decimal places');
const sourceRefsSchema = z.array(z.string().trim().min(1).max(200)).min(1).max(50);
const AUTOMATIC_CONCEPT_IDENTITIES = new Set([
  'earning:base_salary',
  'earning:transport_assistance',
  'deduction:employee_health',
  'deduction:employee_pension',
  'deduction:solidarity_pension',
  'deduction:withholding_tax',
  'employer_contribution:employer_pension',
  'employer_contribution:arl',
  'employer_contribution:compensation_fund',
  'employer_contribution:employer_health',
  'employer_contribution:sena',
  'employer_contribution:icbf',
]);

export const colombiaPrePayrollBlockerCodes = [
  'policy_unavailable',
  'policy_acknowledgement_required',
  'unsupported_currency',
  'employee_classification_review_required',
  'employee_classification_unsupported',
  'holiday_calendar_review_required',
  'employee_rest_day_review_required',
  'withholding_review_required',
  'benefits_review_required',
  'contribution_exemption_review_required',
  'transport_assistance_review_required',
  'monthly_payable_days_required',
  'hourly_attendance_required',
  'attendance_evidence_incomplete',
  'attendance_evidence_overlaps',
  'attendance_evidence_limit_exceeded',
  'attendance_seconds_mismatch',
  'adjustment_requires_zero_automatic_base',
  'adjustment_manual_concept_required',
  'run_contains_blocked_employee',
  'integral_salary_minimum_not_met',
  'integral_salary_ibc_mismatch',
  'contribution_base_required',
  'contribution_base_above_cap',
  'transport_assistance_ineligible',
  'deductions_exceed_earnings',
  'money_range_exceeded',
] as const;
/** Stable safe codes explaining why no monetary result was produced. */
export type ColombiaPrePayrollBlockerCode = (typeof colombiaPrePayrollBlockerCodes)[number];

const manualConceptSchema = z
  .object({
    category: z.enum(['earning', 'deduction', 'employer_contribution']),
    code: z
      .string()
      .trim()
      .regex(/^[a-z][a-z0-9_]{0,49}$/),
    label: z.string().trim().min(1).max(120),
    amount: moneySchema,
    reason: z.string().trim().min(10).max(500),
    sourceRefs: sourceRefsSchema,
  })
  .strict();

/** Reviewed manual amount; it remains distinguishable from automatic policy lines. */
export type ColombiaManualPayrollConceptInput = z.infer<typeof manualConceptSchema>;

export const colombiaPrePayrollInputSchema = z
  .object({
    policyDate: z.iso.date().refine(value => !value.startsWith('0000-')),
    policyAcknowledged: z.boolean(),
    currencyCode: z.string().regex(/^[A-Z]{3}$/),
    contract: z
      .object({
        id: z.string().trim().min(1).max(100),
        version: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
        payBasis: z.enum(['monthly', 'hourly']),
        payAmount: moneySchema,
        integralSalary: z.boolean(),
        arlRiskClass: z.number().int().min(1).max(5),
      })
      .strict(),
    settlement: z
      .object({
        payrollDays: z.number().int().min(0).max(30).nullable(),
        ordinaryWorkedSeconds: z
          .number()
          .int()
          .nonnegative()
          .max(31 * 24 * 60 * 60)
          .nullable(),
        employeeClassification: z.enum(['private_cst', 'review_required', 'unsupported']),
        holidayCalendarReviewed: z.boolean(),
        employeeRestDayReviewed: z.boolean(),
        contributionExemption: z.enum(['applies', 'does_not_apply', 'review_required']),
        contributionBaseAmount: moneySchema.nullable(),
        transportAssistance: z.enum(['applies', 'does_not_apply', 'review_required']),
        transportAssistanceEligible: z.boolean(),
        withholding: z.discriminatedUnion('status', [
          z.object({ status: z.literal('review_required') }).strict(),
          z
            .object({
              status: z.literal('complete'),
              amount: moneySchema,
              reason: z.string().trim().min(10).max(500),
              sourceRefs: sourceRefsSchema,
            })
            .strict(),
        ]),
        benefitsReviewed: z.boolean(),
        reviewSourceRefs: z
          .object({
            baseCompensation: z.array(z.string().trim().min(1).max(200)).min(1).max(200),
            employeeClassification: z.array(z.string().trim().min(1).max(200)).max(50),
            holidayCalendar: z.array(z.string().trim().min(1).max(200)).max(50),
            employeeRestDay: z.array(z.string().trim().min(1).max(200)).max(50),
            contributionExemption: z.array(z.string().trim().min(1).max(200)).max(50),
            contributionBase: z.array(z.string().trim().min(1).max(200)).max(50),
            transportAssistance: z.array(z.string().trim().min(1).max(200)).max(50),
            benefits: z.array(z.string().trim().min(1).max(200)).max(50),
          })
          .strict(),
      })
      .strict(),
    manualConcepts: z.array(manualConceptSchema).max(100).default([]),
  })
  .strict()
  .superRefine((input, ctx) => {
    const identities = new Set<string>();
    for (const [index, concept] of input.manualConcepts.entries()) {
      const identity = `${concept.category}:${concept.code}`;
      if (AUTOMATIC_CONCEPT_IDENTITIES.has(identity)) {
        ctx.addIssue({
          code: 'custom',
          path: ['manualConcepts', index, 'code'],
          message: 'Manual concepts cannot shadow an automatic concept',
        });
      }
      if (identities.has(identity)) {
        ctx.addIssue({
          code: 'custom',
          path: ['manualConcepts', index, 'code'],
          message: 'Concept code must be unique within its category',
        });
      }
      identities.add(identity);
    }
    const { settlement } = input;
    const requireRefs = (reviewed: boolean, refs: readonly string[], path: string) => {
      if (reviewed && refs.length === 0) {
        ctx.addIssue({
          code: 'custom',
          path: ['settlement', 'reviewSourceRefs', path],
          message: 'Reviewed decisions require at least one frozen source reference',
        });
      }
    };
    requireRefs(true, settlement.reviewSourceRefs.baseCompensation, 'baseCompensation');
    requireRefs(
      settlement.employeeClassification !== 'review_required',
      settlement.reviewSourceRefs.employeeClassification,
      'employeeClassification'
    );
    requireRefs(
      settlement.holidayCalendarReviewed,
      settlement.reviewSourceRefs.holidayCalendar,
      'holidayCalendar'
    );
    requireRefs(
      settlement.employeeRestDayReviewed,
      settlement.reviewSourceRefs.employeeRestDay,
      'employeeRestDay'
    );
    requireRefs(
      settlement.contributionExemption !== 'review_required',
      settlement.reviewSourceRefs.contributionExemption,
      'contributionExemption'
    );
    requireRefs(
      settlement.contributionBaseAmount !== null,
      settlement.reviewSourceRefs.contributionBase,
      'contributionBase'
    );
    requireRefs(
      settlement.transportAssistance !== 'review_required',
      settlement.reviewSourceRefs.transportAssistance,
      'transportAssistance'
    );
    requireRefs(settlement.benefitsReviewed, settlement.reviewSourceRefs.benefits, 'benefits');
  });

/** Fully validated evidence required by the pure Colombia calculator. */
export type ColombiaPrePayrollInput = z.infer<typeof colombiaPrePayrollInputSchema>;

/** Persistable concept shape shared by automatic and manager-reviewed lines. */
export interface ColombiaCalculatedPayrollConcept {
  category: 'earning' | 'deduction' | 'employer_contribution';
  code: string;
  label: string;
  origin: 'contract' | 'policy' | 'manual';
  unit: 'amount' | 'days' | 'seconds';
  quantity: number | null;
  rate: number | null;
  baseAmount: number | null;
  amount: number;
  sourceRefs: string[];
  manualReason: string | null;
}

/** Blocked calculations deliberately carry no partial concepts or plausible zero payroll. */
export interface BlockedColombiaPrePayrollResult {
  status: 'blocked';
  policyVersion: string | null;
  blockers: ColombiaPrePayrollBlockerCode[];
  concepts: [];
  grossAmount: 0;
  deductionAmount: 0;
  netAmount: 0;
  employerContributionAmount: 0;
}

/** Complete local pre-payroll arithmetic; this is not DIAN or PILA certification. */
export interface CompleteColombiaPrePayrollResult {
  status: 'complete';
  policyVersion: string;
  blockers: [];
  concepts: ColombiaCalculatedPayrollConcept[];
  grossAmount: number;
  deductionAmount: number;
  netAmount: number;
  employerContributionAmount: number;
}

/** Explicit union prevents consumers from treating blocked zero fields as payable money. */
export type ColombiaPrePayrollResult =
  BlockedColombiaPrePayrollResult | CompleteColombiaPrePayrollResult;

function blocked(
  policyVersion: string | null,
  blockers: Iterable<ColombiaPrePayrollBlockerCode>
): BlockedColombiaPrePayrollResult {
  return {
    status: 'blocked',
    policyVersion,
    blockers: [...new Set(blockers)].sort(),
    concepts: [],
    grossAmount: 0,
    deductionAmount: 0,
    netAmount: 0,
    employerContributionAmount: 0,
  };
}

function safeMoney(value: number): number | null {
  const amount = tryRoundMoneyToSafeCents(value);
  return amount !== null && amount <= MAX_MONEY ? amount : null;
}

function addMoney(left: number, right: number): number | null {
  return safeMoney(left + right);
}

function totalByCategory(
  concepts: readonly ColombiaCalculatedPayrollConcept[],
  category: ColombiaCalculatedPayrollConcept['category']
): number | null {
  let total = 0;
  for (const concept of concepts) {
    if (concept.category !== category) continue;
    const next = addMoney(total, concept.amount);
    if (next === null) return null;
    total = next;
  }
  return total;
}

function solidarityPensionRate(
  ibcAmount: number,
  minimumMonthlyWage: number,
  brackets: readonly {
    fromMinimumWageMultiples: number;
    fromInclusive: boolean;
    upToMinimumWageMultiples: number | null;
    rate: number;
  }[]
): number {
  const multiples = ibcAmount / minimumMonthlyWage;
  let rate = 0;
  for (const bracket of brackets) {
    const aboveLowerBound = bracket.fromInclusive
      ? multiples >= bracket.fromMinimumWageMultiples
      : multiples > bracket.fromMinimumWageMultiples;
    if (
      aboveLowerBound &&
      (bracket.upToMinimumWageMultiples === null || multiples <= bracket.upToMinimumWageMultiples)
    ) {
      rate = bracket.rate;
      break;
    }
  }
  return rate;
}

function automaticConcept(
  category: ColombiaCalculatedPayrollConcept['category'],
  code: string,
  label: string,
  amount: number,
  sourceRefs: string[],
  options: Partial<
    Pick<ColombiaCalculatedPayrollConcept, 'unit' | 'quantity' | 'rate' | 'baseAmount'>
  > = {}
): ColombiaCalculatedPayrollConcept {
  return {
    category,
    code,
    label,
    origin: code === 'base_salary' ? 'contract' : 'policy',
    unit: options.unit ?? 'amount',
    quantity: options.quantity ?? null,
    rate: options.rate ?? null,
    baseAmount: options.baseAmount ?? null,
    amount,
    sourceRefs,
    manualReason: null,
  };
}

/**
 * Calculate one employee's reviewed pre-payroll result.
 *
 * The function never infers tax/exemption/holiday facts and never uses the
 * operational costing hourly rate. Missing reviews return a blocked union with
 * no partial money. Contribution bases remain explicit evidence until the full
 * monthly PILA aggregation model is implemented and externally validated.
 */
export function calculateColombiaPrePayroll(
  raw: ColombiaPrePayrollInput
): ColombiaPrePayrollResult {
  const input = colombiaPrePayrollInputSchema.parse(raw);
  const policy = resolveColombiaPayrollPolicy(input.policyDate);
  if (!policy) return blocked(null, ['policy_unavailable']);

  const blockers: ColombiaPrePayrollBlockerCode[] = [];
  const { contract, settlement } = input;
  if (!input.policyAcknowledged) blockers.push('policy_acknowledgement_required');
  if (input.currencyCode !== 'COP') blockers.push('unsupported_currency');
  if (settlement.employeeClassification === 'review_required')
    blockers.push('employee_classification_review_required');
  if (settlement.employeeClassification === 'unsupported')
    blockers.push('employee_classification_unsupported');
  if (!settlement.holidayCalendarReviewed) blockers.push('holiday_calendar_review_required');
  if (!settlement.employeeRestDayReviewed) blockers.push('employee_rest_day_review_required');
  if (settlement.withholding.status === 'review_required')
    blockers.push('withholding_review_required');
  if (!settlement.benefitsReviewed) blockers.push('benefits_review_required');
  if (settlement.contributionExemption === 'review_required')
    blockers.push('contribution_exemption_review_required');
  if (settlement.transportAssistance === 'review_required')
    blockers.push('transport_assistance_review_required');
  if (contract.payBasis === 'monthly' && settlement.payrollDays === null)
    blockers.push('monthly_payable_days_required');
  if (contract.payBasis === 'hourly' && settlement.ordinaryWorkedSeconds === null)
    blockers.push('hourly_attendance_required');
  if (settlement.contributionBaseAmount === null) blockers.push('contribution_base_required');

  const minimumWage = policy.minimumMonthlyWage;
  if (minimumWage === null) blockers.push('policy_unavailable');
  if (
    minimumWage !== null &&
    contract.integralSalary &&
    contract.payAmount < minimumWage * policy.integralSalaryMinimumWageMultiples
  ) {
    blockers.push('integral_salary_minimum_not_met');
  }

  const contributionBase = settlement.contributionBaseAmount;
  if (
    minimumWage !== null &&
    contributionBase !== null &&
    contributionBase > minimumWage * policy.maximumIbcMinimumWageMultiples
  ) {
    blockers.push('contribution_base_above_cap');
  }
  if (
    minimumWage !== null &&
    contributionBase !== null &&
    contract.integralSalary &&
    contract.payBasis === 'monthly'
  ) {
    const expectedIbc = safeMoney(
      Math.min(
        contract.payAmount * policy.integralSalaryIbcRate,
        minimumWage * policy.maximumIbcMinimumWageMultiples
      )
    );
    if (expectedIbc === null || contributionBase !== expectedIbc) {
      blockers.push('integral_salary_ibc_mismatch');
    }
  }
  if (settlement.transportAssistance === 'applies') {
    const ineligible =
      minimumWage === null ||
      !settlement.transportAssistanceEligible ||
      contract.integralSalary ||
      contract.payAmount > minimumWage * policy.transportAssistanceMaximumWageMultiples;
    if (ineligible) blockers.push('transport_assistance_ineligible');
  }
  if (blockers.length > 0) return blocked(policy.policyVersion, blockers);

  const policyRef = `policy:${policy.policyVersion}`;
  const contractRef = `employment_contract:${contract.id}:v${contract.version}`;
  const concepts: ColombiaCalculatedPayrollConcept[] = [];
  const baseAmount =
    contract.payBasis === 'monthly'
      ? safeMoney((contract.payAmount * settlement.payrollDays!) / 30)
      : safeMoney((contract.payAmount * settlement.ordinaryWorkedSeconds!) / 3_600);
  if (baseAmount === null) return blocked(policy.policyVersion, ['money_range_exceeded']);
  concepts.push(
    automaticConcept(
      'earning',
      'base_salary',
      'Base salary',
      baseAmount,
      [contractRef, ...settlement.reviewSourceRefs.baseCompensation],
      {
        unit: contract.payBasis === 'monthly' ? 'days' : 'seconds',
        quantity:
          contract.payBasis === 'monthly'
            ? settlement.payrollDays
            : settlement.ordinaryWorkedSeconds,
        rate: contract.payAmount,
      }
    )
  );

  if (settlement.transportAssistance === 'applies') {
    const transport = safeMoney(
      (policy.transportAssistance! *
        (contract.payBasis === 'monthly' ? settlement.payrollDays! : 30)) /
        30
    );
    if (transport === null) return blocked(policy.policyVersion, ['money_range_exceeded']);
    concepts.push(
      automaticConcept('earning', 'transport_assistance', 'Transport assistance', transport, [
        policyRef,
        contractRef,
        ...settlement.reviewSourceRefs.transportAssistance,
      ])
    );
  }

  for (const concept of input.manualConcepts) {
    concepts.push({
      category: concept.category,
      code: concept.code,
      label: concept.label,
      origin: 'manual',
      unit: 'amount',
      quantity: null,
      rate: null,
      baseAmount: null,
      amount: concept.amount,
      sourceRefs: [...concept.sourceRefs],
      manualReason: concept.reason,
    });
  }

  const ibc = contributionBase!;
  const contributionSources = [
    policyRef,
    ...settlement.reviewSourceRefs.contributionBase,
    ...settlement.reviewSourceRefs.contributionExemption,
  ];
  const contribution = (
    category: 'deduction' | 'employer_contribution',
    code: string,
    label: string,
    rate: number
  ) => {
    const amount = safeMoney(ibc * rate);
    if (amount === null) return false;
    concepts.push(
      automaticConcept(category, code, label, amount, contributionSources, {
        rate,
        baseAmount: ibc,
      })
    );
    return true;
  };

  if (
    !contribution(
      'deduction',
      'employee_health',
      'Employee health contribution',
      policy.employeeHealthRate
    ) ||
    !contribution(
      'deduction',
      'employee_pension',
      'Employee pension contribution',
      policy.employeePensionRate
    )
  ) {
    return blocked(policy.policyVersion, ['money_range_exceeded']);
  }
  const fspRate = solidarityPensionRate(ibc, minimumWage!, policy.solidarityPensionBrackets);
  if (
    fspRate > 0 &&
    !contribution('deduction', 'solidarity_pension', 'Solidarity pension fund', fspRate)
  )
    return blocked(policy.policyVersion, ['money_range_exceeded']);

  if (
    !contribution(
      'employer_contribution',
      'employer_pension',
      'Employer pension contribution',
      policy.employerPensionRate
    ) ||
    !contribution(
      'employer_contribution',
      'arl',
      'Occupational risk contribution',
      policy.arlRiskRates[String(contract.arlRiskClass) as '1' | '2' | '3' | '4' | '5']
    ) ||
    !contribution(
      'employer_contribution',
      'compensation_fund',
      'Family compensation fund',
      policy.compensationFundRate
    )
  ) {
    return blocked(policy.policyVersion, ['money_range_exceeded']);
  }
  if (settlement.contributionExemption === 'does_not_apply') {
    if (
      !contribution(
        'employer_contribution',
        'employer_health',
        'Employer health contribution',
        policy.employerHealthRate
      ) ||
      !contribution('employer_contribution', 'sena', 'SENA contribution', policy.senaRate) ||
      !contribution('employer_contribution', 'icbf', 'ICBF contribution', policy.icbfRate)
    ) {
      return blocked(policy.policyVersion, ['money_range_exceeded']);
    }
  }
  if (settlement.withholding.status === 'complete' && settlement.withholding.amount > 0) {
    concepts.push({
      category: 'deduction',
      code: 'withholding_tax',
      label: 'Reviewed withholding tax',
      origin: 'manual',
      unit: 'amount',
      quantity: null,
      rate: null,
      baseAmount: null,
      amount: settlement.withholding.amount,
      sourceRefs: [...settlement.withholding.sourceRefs],
      manualReason: settlement.withholding.reason,
    });
  }

  const grossAmount = totalByCategory(concepts, 'earning');
  const deductionAmount = totalByCategory(concepts, 'deduction');
  const employerContributionAmount = totalByCategory(concepts, 'employer_contribution');
  if (grossAmount === null || deductionAmount === null || employerContributionAmount === null)
    return blocked(policy.policyVersion, ['money_range_exceeded']);
  if (deductionAmount > grossAmount)
    return blocked(policy.policyVersion, ['deductions_exceed_earnings']);
  const netAmount = safeMoney(grossAmount - deductionAmount);
  if (netAmount === null) return blocked(policy.policyVersion, ['money_range_exceeded']);
  return {
    status: 'complete',
    policyVersion: policy.policyVersion,
    blockers: [],
    concepts,
    grossAmount,
    deductionAmount,
    netAmount,
    employerContributionAmount,
  };
}
