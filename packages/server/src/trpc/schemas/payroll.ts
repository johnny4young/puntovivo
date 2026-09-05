/** Strict transport contracts for Colombia pre-payroll administration. */
import { z } from 'zod';
import {
  payrollPaymentMethods,
  payrollPeriodFrequencies,
  payrollProfileContractKinds,
} from '../../db/schema.js';
import { roundMoney } from '../../lib/money.js';
import { workforceDateSchema } from '../../services/labor/employment-contract.js';

const identifier = z.string().trim().min(1).max(100);
const reason = z.string().trim().min(10).max(500);
const boundedText = (maximum: number) => z.string().trim().min(1).max(maximum);
const money = z
  .number()
  .finite()
  .nonnegative()
  .max(1_000_000_000_000)
  .refine(value => roundMoney(value) === value, 'Use at most two decimal places');

export const payrollEmployeeProfileTermsSchema = z
  .object({
    userId: identifier,
    siteId: identifier,
    countryCode: z.literal('CO'),
    identificationType: boundedText(20),
    identificationNumber: boundedText(40),
    contributorType: boundedText(20),
    contributorSubtype: boundedText(20).nullable().default(null),
    contractKind: z.enum(payrollProfileContractKinds),
    integralSalary: z.boolean(),
    arlRiskClass: z.number().int().min(1).max(5),
    healthEntity: boundedText(120).nullable().default(null),
    pensionEntity: boundedText(120).nullable().default(null),
    compensationFund: boundedText(120).nullable().default(null),
    transportAssistanceEligible: z.boolean(),
    paymentMethod: z.enum(payrollPaymentMethods),
    paymentAccountLast4: z
      .string()
      .regex(/^\d{4}$/)
      .nullable()
      .default(null),
    effectiveFrom: workforceDateSchema,
    effectiveUntil: workforceDateSchema.nullable().default(null),
  })
  .strict()
  .superRefine((profile, ctx) => {
    if (profile.effectiveUntil !== null && profile.effectiveUntil <= profile.effectiveFrom) {
      ctx.addIssue({
        code: 'custom',
        path: ['effectiveUntil'],
        message: 'The exclusive end must be after the effective start',
      });
    }
    if (profile.paymentMethod === 'transfer' && profile.paymentAccountLast4 === null) {
      ctx.addIssue({
        code: 'custom',
        path: ['paymentAccountLast4'],
        message: 'Transfer requires only the last four account digits',
      });
    }
    if (profile.paymentMethod !== 'transfer' && profile.paymentAccountLast4 !== null) {
      ctx.addIssue({
        code: 'custom',
        path: ['paymentAccountLast4'],
        message: 'Account digits are only accepted for transfers',
      });
    }
  });

/** Private effective payroll profile accepted only from an administrator command. */
export type PayrollEmployeeProfileTerms = z.infer<typeof payrollEmployeeProfileTermsSchema>;

const profileTarget = z
  .object({
    id: identifier,
    siteId: identifier,
    expectedVersion: z
      .number()
      .int()
      .positive()
      .max(Number.MAX_SAFE_INTEGER - 1),
    reason,
  })
  .strict();

export const createPayrollProfileInput = z
  .object({ profile: payrollEmployeeProfileTermsSchema, reason })
  .strict();
export const endPayrollProfileInput = profileTarget.extend({ effectiveUntil: workforceDateSchema });
export const replacePayrollProfileInput = profileTarget.extend({
  profile: payrollEmployeeProfileTermsSchema,
});
export const voidPayrollProfileInput = profileTarget;
export const getPayrollProfileInput = z.object({ id: identifier, siteId: identifier }).strict();
export const listPayrollProfilesInput = z
  .object({
    siteId: identifier.optional(),
    userId: identifier.optional(),
    onDate: workforceDateSchema.optional(),
    includeVoided: z.boolean().default(false),
    cursor: z.object({ effectiveFrom: workforceDateSchema, id: identifier }).strict().optional(),
    limit: z.number().int().min(1).max(100).default(50),
  })
  .strict();
export const listPayrollProfileEventsInput = getPayrollProfileInput.extend({
  beforeVersion: z.number().int().positive().optional(),
  limit: z.number().int().min(1).max(100).default(50),
});

/** Optimistic profile target; the reason stays in private payroll evidence. */
export type PayrollProfileTarget = z.infer<typeof profileTarget>;

export const createPayrollPeriodInput = z
  .object({
    countryCode: z.literal('CO'),
    frequency: z.enum(payrollPeriodFrequencies),
    fromDate: workforceDateSchema,
    untilDate: workforceDateSchema,
    payDate: workforceDateSchema,
    currencyCode: z.literal('COP'),
    reason,
  })
  .strict()
  .superRefine((period, ctx) => {
    if (period.untilDate <= period.fromDate) {
      ctx.addIssue({
        code: 'custom',
        path: ['untilDate'],
        message: 'The exclusive period end must be after the start',
      });
    }
    if (period.payDate < period.fromDate) {
      ctx.addIssue({
        code: 'custom',
        path: ['payDate'],
        message: 'Pay date cannot precede the period start',
      });
    }
    const spanDays =
      (Date.parse(`${period.untilDate}T00:00:00.000Z`) -
        Date.parse(`${period.fromDate}T00:00:00.000Z`)) /
      86_400_000;
    if (spanDays > 31) {
      ctx.addIssue({
        code: 'custom',
        path: ['untilDate'],
        message: 'A payroll period cannot exceed 31 calendar days',
      });
    }
  });
export const closePayrollPeriodInput = z
  .object({
    id: identifier,
    expectedVersion: z
      .number()
      .int()
      .positive()
      .max(Number.MAX_SAFE_INTEGER - 1),
    reason,
  })
  .strict();
export const listPayrollPeriodsInput = z
  .object({
    status: z.enum(['open', 'closed']).optional(),
    cursor: z.object({ fromDate: workforceDateSchema, id: identifier }).strict().optional(),
    limit: z.number().int().min(1).max(100).default(50),
  })
  .strict();
export const getPayrollPeriodInput = z.object({ id: identifier }).strict();

const manualPayrollConceptInput = z
  .object({
    category: z.enum(['earning', 'deduction', 'employer_contribution']),
    code: z
      .string()
      .trim()
      .regex(/^[a-z][a-z0-9_]{0,49}$/),
    label: boundedText(120),
    amount: money,
    reason,
  })
  .strict();

const payrollEmployeeSettlementInput = z
  .object({
    userId: identifier,
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
    contributionBaseAmount: money.nullable(),
    transportAssistance: z.enum(['applies', 'does_not_apply', 'review_required']),
    withholding: z.discriminatedUnion('status', [
      z.object({ status: z.literal('review_required') }).strict(),
      z.object({ status: z.literal('complete'), amount: money, reason }).strict(),
    ]),
    benefitsReviewed: z.boolean(),
    reviewReason: reason,
    manualConcepts: z.array(manualPayrollConceptInput).max(100).default([]),
  })
  .strict();

/** One employee's reviewed run inputs; authoritative profile/contract rows are server-loaded. */
export type PayrollEmployeeSettlementInput = z.infer<typeof payrollEmployeeSettlementInput>;

export const createPayrollRunInput = z
  .object({
    periodId: identifier,
    kind: z.enum(['regular', 'adjustment']),
    originalRunId: identifier.nullable().default(null),
    reason,
  })
  .strict()
  .superRefine((run, ctx) => {
    if ((run.kind === 'regular') !== (run.originalRunId === null)) {
      ctx.addIssue({
        code: 'custom',
        path: ['originalRunId'],
        message: 'Only adjustment runs reference an approved original run',
      });
    }
  });
export const recalculatePayrollRunInput = z
  .object({
    runId: identifier,
    expectedVersion: z
      .number()
      .int()
      .positive()
      .max(Number.MAX_SAFE_INTEGER - 1),
    authorityToken: z.string().regex(/^[a-f0-9]{64}$/),
    policyAcknowledged: z.boolean(),
    employees: z.array(payrollEmployeeSettlementInput).min(1).max(500),
    reason,
  })
  .strict()
  .superRefine((run, ctx) => {
    const users = new Set<string>();
    for (const [index, employee] of run.employees.entries()) {
      if (users.has(employee.userId)) {
        ctx.addIssue({
          code: 'custom',
          path: ['employees', index, 'userId'],
          message: 'Each employee can appear only once in a revision',
        });
      }
      users.add(employee.userId);
    }
  });
export const advancePayrollRunInput = z
  .object({
    runId: identifier,
    expectedVersion: z
      .number()
      .int()
      .positive()
      .max(Number.MAX_SAFE_INTEGER - 1),
    expectedRevision: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    reason,
  })
  .strict();
export const listPayrollRunsInput = z
  .object({
    periodId: identifier.optional(),
    status: z.enum(['draft', 'reviewed', 'approved']).optional(),
    cursor: z.object({ createdAt: z.iso.datetime(), id: identifier }).strict().optional(),
    limit: z.number().int().min(1).max(100).default(50),
  })
  .strict();
export const getPayrollRunInput = z.object({ runId: identifier }).strict();
export const listPayrollRunEmployeesInput = z
  .object({
    runId: identifier,
    cursor: z.object({ userId: identifier, id: identifier }).strict().optional(),
    limit: z.number().int().min(1).max(100).default(50),
  })
  .strict();
export const getPayrollRunRevisionInput = z
  .object({
    runId: identifier,
    revision: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    cursor: z.object({ userId: identifier, id: identifier }).strict().optional(),
    limit: z.number().int().min(1).max(50).default(25),
  })
  .strict();
