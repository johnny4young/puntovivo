import { z } from 'zod';
import { roundMoney, tryRoundMoneyToSafeCents } from '../../lib/money.js';

/** Business-calendar date, not a UTC instant; year zero is not an employment date. */
export const workforceDateSchema = z.iso.date().refine(value => !value.startsWith('0000-'));

const contractMoney = z
  .number()
  .finite()
  .nonnegative()
  .max(1_000_000_000_000)
  .refine(value => roundMoney(value) === value, 'Use at most two decimal places');

const payTerms = z.discriminatedUnion('basis', [
  z.object({ basis: z.literal('hourly'), amount: contractMoney }).strict(),
  z
    .object({
      basis: z.literal('monthly'),
      amount: contractMoney,
      // Operational costing is not a statutory salary divisor or a payroll entitlement.
      costingHourlyRate: contractMoney.nullable().default(null),
    })
    .strict(),
]);

/**
 * Explicit administrator-authored terms. Effective dates form [from, until);
 * null until means open-ended. Position is a job label, never an access role.
 * Currency ownership and employee/site authority must be checked by the writer.
 */
export const employmentContractTermsSchema = z
  .object({
    userId: z.string().trim().min(1).max(100),
    siteId: z.string().trim().min(1).max(100),
    position: z.string().trim().min(1).max(100),
    effectiveFrom: workforceDateSchema,
    effectiveUntil: workforceDateSchema.nullable().default(null),
    currencyCode: z.string().regex(/^[A-Z]{3}$/),
    pay: payTerms,
  })
  .strict()
  .superRefine((terms, ctx) => {
    if (terms.effectiveUntil !== null && terms.effectiveUntil <= terms.effectiveFrom) {
      ctx.addIssue({
        code: 'custom',
        path: ['effectiveUntil'],
        message: 'The exclusive end must be after the effective start',
      });
    }
  });

/** Validated terms only; no defaults invent a wage or an hourly equivalent. */
export type EmploymentContractTerms = z.infer<typeof employmentContractTermsSchema>;

/** Validated half-open calendar window; callers preserve the business time zone separately. */
export type EmploymentContractWindow = Pick<
  EmploymentContractTerms,
  'effectiveFrom' | 'effectiveUntil'
>;

/** Neighboring contracts can meet on a boundary without sharing any effective date. */
export function employmentWindowsOverlap(
  left: EmploymentContractWindow,
  right: EmploymentContractWindow
): boolean {
  return (
    (right.effectiveUntil === null || left.effectiveFrom < right.effectiveUntil) &&
    (left.effectiveUntil === null || right.effectiveFrom < left.effectiveUntil)
  );
}

/** Select a contract using a validated business-calendar date, not device-local UTC slicing. */
export function employmentIsEffective(window: EmploymentContractWindow, date: string): boolean {
  workforceDateSchema.parse(date);
  return (
    date >= window.effectiveFrom && (window.effectiveUntil === null || date < window.effectiveUntil)
  );
}

/**
 * Operational regular-time estimate, not payroll or statutory overtime.
 * Missing costing evidence stays unknown instead of silently becoming zero.
 */
export type RegularLaborCost =
  | { available: true; currencyCode: string; amount: number; hourlyRate: number }
  | { available: false; currencyCode: string; reason: 'monthly_costing_rate_missing' };

/** Whole elapsed seconds after approved break subtraction; callers split at contract boundaries. */
export function estimateRegularLaborCost(
  terms: EmploymentContractTerms,
  workedSeconds: number
): RegularLaborCost {
  if (!Number.isSafeInteger(workedSeconds) || workedSeconds < 0) {
    throw new RangeError('Worked duration must be nonnegative whole seconds');
  }
  const hourlyRate = terms.pay.basis === 'hourly' ? terms.pay.amount : terms.pay.costingHourlyRate;
  if (hourlyRate === null) {
    return {
      available: false,
      currencyCode: terms.currencyCode,
      reason: 'monthly_costing_rate_missing',
    };
  }
  const amount = tryRoundMoneyToSafeCents((hourlyRate * workedSeconds) / 3_600);
  if (amount === null) throw new RangeError('Operational labor cost exceeds safe money range');
  return { available: true, currencyCode: terms.currencyCode, amount, hourlyRate };
}
