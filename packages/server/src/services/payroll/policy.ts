/** Effective-dated Colombia pre-payroll facts with explicit legal and capability limits. */
import { z } from 'zod';
import type { PayrollPolicySnapshot } from '../../db/schema.js';

export const colombiaPayrollLimitationCodes = [
  'holiday_calendar_required',
  'employee_rest_day_required',
  'employee_classification_required',
  'contribution_exemption_review_required',
  'withholding_profile_required',
  'benefits_policy_required',
  'electronic_provider_not_validated',
  'minimum_wage_judicial_review_pending',
] as const;
/** Missing legal or employee evidence that prevents a payroll-final result. */
export type ColombiaPayrollLimitationCode = (typeof colombiaPayrollLimitationCodes)[number];

/** Source-backed policy snapshot selected by the period's business date. */
export interface ColombiaPayrollPolicy extends PayrollPolicySnapshot {
  limitations: ColombiaPayrollLimitationCode[];
}

const DATE = z.iso.date().refine(value => !value.startsWith('0000-'));

const OFFICIAL_SOURCES = [
  'https://www.suin-juriscol.gov.co/viewDocument.asp?id=30056106',
  'https://www.suin-juriscol.gov.co/clp/contenidos.dll/Decretos/30055941',
  'https://www.funcionpublica.gov.co/eva/gestornormativo/norma.php?i=260676',
  'https://www.dian.gov.co/impuestos/Paginas/Sistema-de-Factura-Electronica/Documento-Soporte-de-Pago-de-Nomina-Electronica.aspx',
  'https://www.ugpp.gov.co/wp-content/uploads/2026/02/ABC-Trabajadores-dependientes-que-devengan-salario-integral.pdf',
  'https://www.ugpp.gov.co/sites/default/files/Parafiscales/Cartilla-anexo-detallado-empleadores-V4.pdf',
  'https://normograma.dian.gov.co/dian/compilacion/docs/oficio_dian_14753_2025.htm',
  'https://www.ugpp.gov.co/sites/default/files/Normas/Decreto-1072-de-2015-Sector-Trabajo-Gestor-Normativo.pdf',
] as const;

const COMMON_2026_POLICY = {
  countryCode: 'CO',
  legalStatus: 'transitional_pending_judicial_review',
  sourceUrls: [...OFFICIAL_SOURCES],
  reviewedAt: '2026-09-04T00:00:00.000Z',
  minimumMonthlyWage: 1_750_905,
  transportAssistance: 249_095,
  dayStartMinute: 6 * 60,
  nightStartMinute: 19 * 60,
  ordinaryNightPremiumRate: 0.35,
  dayOvertimePremiumRate: 0.25,
  nightOvertimePremiumRate: 0.75,
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
    { fromMinimumWageMultiples: 4, fromInclusive: true, upToMinimumWageMultiples: 16, rate: 0.01 },
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
  limitations: [...colombiaPayrollLimitationCodes],
} as const satisfies Omit<
  ColombiaPayrollPolicy,
  | 'policyVersion'
  | 'effectiveFrom'
  | 'effectiveUntil'
  | 'weeklyRegularSeconds'
  | 'restDayPremiumRate'
>;

const POLICIES: readonly ColombiaPayrollPolicy[] = [
  {
    ...COMMON_2026_POLICY,
    policyVersion: 'co-prepayroll-2026-h1-transitional-v2',
    effectiveFrom: '2026-01-01',
    effectiveUntil: '2026-07-01',
    weeklyRegularSeconds: 44 * 60 * 60,
    restDayPremiumRate: 0.8,
  },
  {
    ...COMMON_2026_POLICY,
    policyVersion: 'co-prepayroll-2026-rest90-transitional-v2',
    effectiveFrom: '2026-07-01',
    effectiveUntil: '2026-07-15',
    weeklyRegularSeconds: 44 * 60 * 60,
    restDayPremiumRate: 0.9,
  },
  {
    ...COMMON_2026_POLICY,
    policyVersion: 'co-prepayroll-2026-42h-transitional-v2',
    effectiveFrom: '2026-07-15',
    effectiveUntil: '2027-01-01',
    weeklyRegularSeconds: 42 * 60 * 60,
    restDayPremiumRate: 0.9,
  },
] as const;

/** Resolve the newest reviewed profile effective on one Colombia business date. */
export function resolveColombiaPayrollPolicy(localDate: string): ColombiaPayrollPolicy | null {
  DATE.parse(localDate);
  const candidates = POLICIES.filter(
    profile =>
      profile.effectiveFrom <= localDate &&
      (profile.effectiveUntil === null || localDate < profile.effectiveUntil)
  );
  const resolved = candidates.sort((left, right) =>
    right.effectiveFrom.localeCompare(left.effectiveFrom)
  )[0];
  return resolved ? structuredClone(resolved) : null;
}

/** Freeze a JSON-owned policy snapshot so callers cannot mutate the registry. */
export function freezeColombiaPayrollPolicy(localDate: string): ColombiaPayrollPolicy | null {
  const policy = resolveColombiaPayrollPolicy(localDate);
  return policy === null ? null : structuredClone(policy);
}
