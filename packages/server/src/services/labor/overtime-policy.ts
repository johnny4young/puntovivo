/**
 * ENG-140c — effective-dated statutory overtime baselines.
 *
 * These profiles classify attendance evidence; they do not calculate payroll.
 * Contract terms, collective agreements, holidays, and authorised schedule
 * shapes can be more favourable than the statutory maxima represented here.
 */

export const OVERTIME_COUNTRIES = ['CO', 'MX', 'CL', 'PE', 'AR'] as const;
export type OvertimeCountry = (typeof OVERTIME_COUNTRIES)[number];

export const overtimeLimitationCodes = [
  'contracted_schedule',
  'holiday_calendar',
  'collective_agreement',
  'colombia_flexible_schedule',
  'mexico_shift_type',
] as const;
export type OvertimeLimitationCode = (typeof overtimeLimitationCodes)[number];

export const overtimePremiumCodes = [
  'co_day_overtime',
  'co_night_overtime',
  'mx_double_overtime',
  'mx_triple_overtime',
  'cl_overtime',
  'pe_first_two_overtime',
  'pe_additional_overtime',
  'ar_ordinary_overtime',
  'ar_rest_day_overtime',
] as const;
export type OvertimePremiumCode = (typeof overtimePremiumCodes)[number];

export interface OvertimePolicyProfile {
  id: string;
  countryCode: OvertimeCountry;
  effectiveFrom: string;
  weeklyRegularSeconds: number;
  dailyRegularSeconds: number | null;
  /** Start of the daytime window, in tenant-local minutes after midnight. */
  dayStartMinute: number | null;
  /** Start of the nighttime window, in tenant-local minutes after midnight. */
  nightStartMinute: number | null;
  limitations: readonly OvertimeLimitationCode[];
  sourceUrls: readonly string[];
}

const HOURS = 60 * 60;
const CO_SOURCES = [
  'https://www.funcionpublica.gov.co/eva/gestornormativo/norma.php?i=260676',
  'https://www.funcionpublica.gov.co/eva/gestornormativo/norma.php?i=166506',
  'https://www1.funcionpublica.gov.co/eva/gestornormativo/norma.php?50=&i=281',
] as const;
const CL_SOURCES = [
  'https://www.dt.gob.cl/portal/1628/w3-article-60176.html',
  'https://dt.gob.cl/portal/1628/w3-article-60151.html',
] as const;

const PROFILES: readonly OvertimePolicyProfile[] = [
  {
    id: 'CO-2021-48H',
    countryCode: 'CO',
    effectiveFrom: '0001-01-01',
    weeklyRegularSeconds: 48 * HOURS,
    dailyRegularSeconds: 9 * HOURS,
    dayStartMinute: 6 * 60,
    nightStartMinute: 21 * 60,
    limitations: ['contracted_schedule', 'holiday_calendar', 'colombia_flexible_schedule'],
    sourceUrls: CO_SOURCES,
  },
  {
    id: 'CO-2023-47H',
    countryCode: 'CO',
    effectiveFrom: '2023-07-15',
    weeklyRegularSeconds: 47 * HOURS,
    dailyRegularSeconds: 9 * HOURS,
    dayStartMinute: 6 * 60,
    nightStartMinute: 21 * 60,
    limitations: ['contracted_schedule', 'holiday_calendar', 'colombia_flexible_schedule'],
    sourceUrls: CO_SOURCES,
  },
  {
    id: 'CO-2024-46H',
    countryCode: 'CO',
    effectiveFrom: '2024-07-15',
    weeklyRegularSeconds: 46 * HOURS,
    dailyRegularSeconds: 9 * HOURS,
    dayStartMinute: 6 * 60,
    nightStartMinute: 21 * 60,
    limitations: ['contracted_schedule', 'holiday_calendar', 'colombia_flexible_schedule'],
    sourceUrls: CO_SOURCES,
  },
  {
    id: 'CO-2025-44H',
    countryCode: 'CO',
    effectiveFrom: '2025-07-15',
    weeklyRegularSeconds: 44 * HOURS,
    dailyRegularSeconds: 9 * HOURS,
    dayStartMinute: 6 * 60,
    nightStartMinute: 21 * 60,
    limitations: ['contracted_schedule', 'holiday_calendar', 'colombia_flexible_schedule'],
    sourceUrls: CO_SOURCES,
  },
  {
    id: 'CO-2025-44H-NIGHT-19',
    countryCode: 'CO',
    effectiveFrom: '2025-12-25',
    weeklyRegularSeconds: 44 * HOURS,
    dailyRegularSeconds: 9 * HOURS,
    dayStartMinute: 6 * 60,
    nightStartMinute: 19 * 60,
    limitations: ['contracted_schedule', 'holiday_calendar', 'colombia_flexible_schedule'],
    sourceUrls: CO_SOURCES,
  },
  {
    id: 'CO-2026-42H',
    countryCode: 'CO',
    effectiveFrom: '2026-07-15',
    weeklyRegularSeconds: 42 * HOURS,
    dailyRegularSeconds: 9 * HOURS,
    dayStartMinute: 6 * 60,
    nightStartMinute: 19 * 60,
    limitations: ['contracted_schedule', 'holiday_calendar', 'colombia_flexible_schedule'],
    sourceUrls: CO_SOURCES,
  },
  {
    id: 'MX-48H',
    countryCode: 'MX',
    effectiveFrom: '0001-01-01',
    weeklyRegularSeconds: 48 * HOURS,
    dailyRegularSeconds: 8 * HOURS,
    dayStartMinute: null,
    nightStartMinute: null,
    limitations: [
      'contracted_schedule',
      'holiday_calendar',
      'collective_agreement',
      'mexico_shift_type',
    ],
    sourceUrls: ['https://www.diputados.gob.mx/LeyesBiblio/pdf/LFT.pdf'],
  },
  {
    id: 'CL-45H',
    countryCode: 'CL',
    effectiveFrom: '0001-01-01',
    weeklyRegularSeconds: 45 * HOURS,
    dailyRegularSeconds: null,
    dayStartMinute: null,
    nightStartMinute: null,
    limitations: ['contracted_schedule', 'holiday_calendar', 'collective_agreement'],
    sourceUrls: CL_SOURCES,
  },
  {
    id: 'CL-2024-44H',
    countryCode: 'CL',
    effectiveFrom: '2024-04-26',
    weeklyRegularSeconds: 44 * HOURS,
    dailyRegularSeconds: null,
    dayStartMinute: null,
    nightStartMinute: null,
    limitations: ['contracted_schedule', 'holiday_calendar', 'collective_agreement'],
    sourceUrls: CL_SOURCES,
  },
  {
    id: 'CL-2026-42H',
    countryCode: 'CL',
    effectiveFrom: '2026-04-26',
    weeklyRegularSeconds: 42 * HOURS,
    dailyRegularSeconds: null,
    dayStartMinute: null,
    nightStartMinute: null,
    limitations: ['contracted_schedule', 'holiday_calendar', 'collective_agreement'],
    sourceUrls: CL_SOURCES,
  },
  {
    id: 'CL-2028-40H',
    countryCode: 'CL',
    effectiveFrom: '2028-04-26',
    weeklyRegularSeconds: 40 * HOURS,
    dailyRegularSeconds: null,
    dayStartMinute: null,
    nightStartMinute: null,
    limitations: ['contracted_schedule', 'holiday_calendar', 'collective_agreement'],
    sourceUrls: CL_SOURCES,
  },
  {
    id: 'PE-48H',
    countryCode: 'PE',
    effectiveFrom: '0001-01-01',
    weeklyRegularSeconds: 48 * HOURS,
    dailyRegularSeconds: 8 * HOURS,
    dayStartMinute: null,
    nightStartMinute: null,
    limitations: ['contracted_schedule', 'holiday_calendar', 'collective_agreement'],
    sourceUrls: [
      'https://www.gob.pe/institucion/sunafil/noticias/1100081-conoce-las-diferencias-entre-trabajo-forzoso-y-trabajo-en-sobretiempo',
    ],
  },
  {
    id: 'AR-48H',
    countryCode: 'AR',
    effectiveFrom: '0001-01-01',
    weeklyRegularSeconds: 48 * HOURS,
    dailyRegularSeconds: 9 * HOURS,
    dayStartMinute: null,
    nightStartMinute: null,
    limitations: ['contracted_schedule', 'holiday_calendar', 'collective_agreement'],
    sourceUrls: ['https://www.argentina.gob.ar/justicia/derechofacil/leysimple/jornada-de-trabajo'],
  },
] as const;

export function isOvertimeCountry(countryCode: string): countryCode is OvertimeCountry {
  return OVERTIME_COUNTRIES.includes(countryCode as OvertimeCountry);
}

/** Resolve the last profile effective on one tenant-local calendar date. */
export function resolveOvertimePolicy(
  countryCode: string,
  localDate: string
): OvertimePolicyProfile | null {
  if (!isOvertimeCountry(countryCode)) return null;
  let resolved: OvertimePolicyProfile | null = null;
  for (const profile of PROFILES) {
    if (
      profile.countryCode === countryCode &&
      profile.effectiveFrom <= localDate &&
      (!resolved || profile.effectiveFrom > resolved.effectiveFrom)
    ) {
      resolved = profile;
    }
  }
  return resolved;
}
