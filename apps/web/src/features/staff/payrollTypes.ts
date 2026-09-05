import type { inferRouterInputs, inferRouterOutputs } from '@trpc/server';
import type { AppRouter } from '@puntovivo/server';
import { isEmploymentDate, parseEmploymentMoney } from './employmentTypes';

type PayrollRouter = inferRouterOutputs<AppRouter>['workforce']['payroll'];
type PayrollInputs = inferRouterInputs<AppRouter>['workforce']['payroll'];

/** Administrator-only employee profile including display labels and private payroll evidence. */
export type PayrollProfile = PayrollRouter['profiles']['list']['items'][number];
/** Half-open pre-payroll period. */
export type PayrollPeriod = PayrollRouter['periods']['list']['items'][number];
/** Stable run header; calculated values remain in immutable revisions. */
export type PayrollRun = PayrollRouter['runs']['list']['items'][number];
/** Server-authoritative employee universe and attendance preview for one draft run. */
export type PayrollPreparation = PayrollRouter['runs']['preparation'];
/** One employee in the server-authoritative run preparation. */
export type PayrollPreparationEmployee = PayrollPreparation['employees'][number];
/** Bounded private calculation page. */
export type PayrollRevisionPage = PayrollRouter['runs']['revision'];
/** One employee settlement review sent to a new immutable revision. */
export type PayrollSettlementInput = PayrollInputs['runs']['recalculate']['employees'][number];
/** Manual earning, deduction or employer contribution reviewed by an administrator. */
export type PayrollManualConcept = NonNullable<PayrollSettlementInput['manualConcepts']>[number];

export interface PayrollProfileFormValues {
  userId: string;
  siteId: string;
  identificationType: string;
  identificationNumber: string;
  contributorType: string;
  contributorSubtype: string;
  contractKind: PayrollProfile['contractKind'];
  integralSalary: boolean;
  arlRiskClass: string;
  healthEntity: string;
  pensionEntity: string;
  compensationFund: string;
  transportAssistanceEligible: boolean;
  paymentMethod: PayrollProfile['paymentMethod'];
  paymentAccountLast4: string;
  effectiveFrom: string;
  effectiveUntil: string;
  reason: string;
}

/** Convert a validated UI draft without defaulting private identity or payment evidence. */
export function payrollProfileTerms(values: PayrollProfileFormValues) {
  return {
    userId: values.userId,
    siteId: values.siteId,
    countryCode: 'CO' as const,
    identificationType: values.identificationType.trim(),
    identificationNumber: values.identificationNumber.trim(),
    contributorType: values.contributorType.trim(),
    contributorSubtype: values.contributorSubtype.trim() || null,
    contractKind: values.contractKind,
    integralSalary: values.integralSalary,
    arlRiskClass: Number(values.arlRiskClass),
    healthEntity: values.healthEntity.trim() || null,
    pensionEntity: values.pensionEntity.trim() || null,
    compensationFund: values.compensationFund.trim() || null,
    transportAssistanceEligible: values.transportAssistanceEligible,
    paymentMethod: values.paymentMethod,
    paymentAccountLast4:
      values.paymentMethod === 'transfer' ? values.paymentAccountLast4.trim() : null,
    effectiveFrom: values.effectiveFrom,
    effectiveUntil: values.effectiveUntil || null,
  };
}

/** Strict calendar interval validation shared by profile and period forms. */
export function isPayrollWindow(fromDate: string, untilDate: string): boolean {
  return (
    isEmploymentDate(fromDate) &&
    (!untilDate || (isEmploymentDate(untilDate) && untilDate > fromDate))
  );
}

/** Mirror the transport's half-open 31-day period constraints for immediate form feedback. */
export function payrollPeriodDateIssue(
  fromDate: string,
  untilDate: string,
  payDate: string
): 'date' | 'window' | 'periodSpan' | 'payDate' | null {
  if (![fromDate, untilDate, payDate].every(isEmploymentDate)) return 'date';
  if (untilDate <= fromDate) return 'window';
  const spanDays =
    (Date.parse(`${untilDate}T00:00:00.000Z`) - Date.parse(`${fromDate}T00:00:00.000Z`)) /
    86_400_000;
  if (spanDays > 31) return 'periodSpan';
  if (payDate < fromDate) return 'payDate';
  return null;
}

/** Strict hours input converted to integer seconds without silent rounding. */
export function payrollHoursToSeconds(value: string): number | null {
  if (!/^\d+(?:\.\d{1,4})?$/.test(value.trim())) return null;
  const hours = Number(value);
  const seconds = hours * 3600;
  if (!Number.isSafeInteger(seconds) || seconds > 31 * 24 * 60 * 60) return null;
  return seconds;
}

/** Reuse the exact two-decimal money parser used by employment compensation. */
export const parsePayrollMoney = parseEmploymentMoney;
