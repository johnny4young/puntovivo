/** Colombia-first pre-payroll evidence; approved rows are review artifacts, not legal certification. */
import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  real,
  sqliteTable,
  text,
  uniqueIndex,
  type AnySQLiteColumn,
} from 'drizzle-orm/sqlite-core';
import { sites, tenants, users } from './auth.js';
import { currencyCatalog } from './config.js';
import { employmentContracts } from './workforce.js';
import { moneyPositiveChecks, moneyTwoDecimalCheck, sqliteNow } from './base.js';

const calendarDate = (column: AnySQLiteColumn) => sql`
  length(${column}) = 10
  AND ${column} GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'
  AND substr(${column}, 1, 4) != '0000'
  AND date(${column}, '+0 days') IS NOT NULL
  AND date(${column}, '+0 days') = ${column}`;

const utcInstant = (column: AnySQLiteColumn) => sql`
  strftime('%Y-%m-%dT%H:%M:%fZ', ${column}) IS NOT NULL
  AND strftime('%Y-%m-%dT%H:%M:%fZ', ${column}) = ${column}`;

export const payrollProfileContractKinds = [
  'indefinite',
  'fixed_term',
  'work_or_task',
  'apprenticeship',
  'other',
] as const;
/** Employment classification carried into a frozen pre-payroll result. */
export type PayrollProfileContractKind = (typeof payrollProfileContractKinds)[number];

export const payrollPaymentMethods = ['cash', 'transfer', 'other'] as const;
/** Payment-method category only; account references remain opaque and private. */
export type PayrollPaymentMethod = (typeof payrollPaymentMethods)[number];

export const payrollPeriodFrequencies = [
  'weekly',
  'biweekly',
  'semimonthly',
  'monthly',
  'other',
] as const;
/** Administrative cadence; it does not choose a statutory salary divisor by itself. */
export type PayrollPeriodFrequency = (typeof payrollPeriodFrequencies)[number];

export const payrollRunKinds = ['regular', 'adjustment'] as const;
/** Adjustment runs append to, rather than mutate, an approved regular run. */
export type PayrollRunKind = (typeof payrollRunKinds)[number];

export const payrollRunStatuses = ['draft', 'reviewed', 'approved'] as const;
/** Monotonic pre-payroll lifecycle; approved is terminal. */
export type PayrollRunStatus = (typeof payrollRunStatuses)[number];

export const payrollCalculationStatuses = ['complete', 'blocked'] as const;
/** A blocked result exposes missing prerequisites without manufacturing zero money. */
export type PayrollCalculationStatus = (typeof payrollCalculationStatuses)[number];

export const payrollConceptCategories = ['earning', 'deduction', 'employer_contribution'] as const;
/** Accounting side of one frozen normalized pre-payroll concept. */
export type PayrollConceptCategory = (typeof payrollConceptCategories)[number];

export const payrollConceptOrigins = [
  'contract',
  'attendance',
  'policy',
  'manual',
  'adjustment',
] as const;
/** Provenance class for a concept line; exact source ids live in the private snapshot. */
export type PayrollConceptOrigin = (typeof payrollConceptOrigins)[number];

export const payrollResultSourceKinds = [
  'payroll_profile',
  'employment_contract',
  'attendance',
  'attendance_correction',
  'reconciliation',
  'policy',
] as const;
/** Exact immutable source category linked to one employee calculation result. */
export type PayrollResultSourceKind = (typeof payrollResultSourceKinds)[number];

export const payrollConceptUnits = ['amount', 'seconds', 'days', 'units'] as const;
/** Unit attached to quantity/rate evidence; amount means the line was entered directly. */
export type PayrollConceptUnit = (typeof payrollConceptUnits)[number];

/** Private effective worker profile used only by pre-payroll and provider handoff. */
export interface PayrollEmployeeProfileSnapshot {
  userId: string;
  siteId: string;
  countryCode: string;
  identificationType: string;
  identificationNumber: string;
  contributorType: string;
  contributorSubtype: string | null;
  contractKind: PayrollProfileContractKind;
  integralSalary: boolean;
  arlRiskClass: number;
  healthEntity: string | null;
  pensionEntity: string | null;
  compensationFund: string | null;
  transportAssistanceEligible: boolean;
  paymentMethod: PayrollPaymentMethod;
  paymentAccountLast4: string | null;
  effectiveFrom: string;
  effectiveUntil: string | null;
  version: number;
  voidedAt: string | null;
}

export const payrollEmployeeProfiles = sqliteTable(
  'payroll_employee_profiles',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    userId: text('user_id')
      .notNull()
      .references(() => users.id),
    siteId: text('site_id')
      .notNull()
      .references(() => sites.id),
    countryCode: text('country_code').notNull(),
    identificationType: text('identification_type').notNull(),
    identificationNumber: text('identification_number').notNull(),
    contributorType: text('contributor_type').notNull(),
    contributorSubtype: text('contributor_subtype'),
    contractKind: text('contract_kind', { enum: payrollProfileContractKinds }).notNull(),
    integralSalary: integer('integral_salary', { mode: 'boolean' }).notNull().default(false),
    arlRiskClass: integer('arl_risk_class').notNull(),
    healthEntity: text('health_entity'),
    pensionEntity: text('pension_entity'),
    compensationFund: text('compensation_fund'),
    transportAssistanceEligible: integer('transport_assistance_eligible', {
      mode: 'boolean',
    })
      .notNull()
      .default(false),
    paymentMethod: text('payment_method', { enum: payrollPaymentMethods }).notNull(),
    paymentAccountLast4: text('payment_account_last4'),
    effectiveFrom: text('effective_from').notNull(),
    effectiveUntil: text('effective_until'),
    predecessorId: text('predecessor_id').references(
      (): AnySQLiteColumn => payrollEmployeeProfiles.id
    ),
    version: integer('version').notNull().default(1),
    voidedAt: text('voided_at'),
    createdByUserId: text('created_by_user_id')
      .notNull()
      .references(() => users.id),
    updatedByUserId: text('updated_by_user_id')
      .notNull()
      .references(() => users.id),
    createdAt: text('created_at').notNull().default(sqliteNow),
    updatedAt: text('updated_at').notNull().default(sqliteNow),
  },
  table => [
    index('idx_payroll_profiles_user_window').on(
      table.tenantId,
      table.userId,
      table.effectiveFrom,
      table.id
    ),
    index('idx_payroll_profiles_site').on(table.tenantId, table.siteId, table.id),
    uniqueIndex('idx_payroll_profiles_active_start')
      .on(table.tenantId, table.userId, table.effectiveFrom)
      .where(sql`${table.voidedAt} IS NULL`),
    check('chk_payroll_profiles_country', sql`${table.countryCode} = 'CO'`),
    check('chk_payroll_profiles_start', calendarDate(table.effectiveFrom)),
    check(
      'chk_payroll_profiles_end',
      sql`${table.effectiveUntil} IS NULL OR (${calendarDate(table.effectiveUntil)} AND ${table.effectiveUntil} > ${table.effectiveFrom})`
    ),
    check(
      'chk_payroll_profiles_identity',
      sql`length(trim(${table.identificationType})) BETWEEN 1 AND 20 AND length(trim(${table.identificationNumber})) BETWEEN 3 AND 40`
    ),
    check(
      'chk_payroll_profiles_contributor',
      sql`length(trim(${table.contributorType})) BETWEEN 1 AND 20 AND (${table.contributorSubtype} IS NULL OR length(trim(${table.contributorSubtype})) BETWEEN 1 AND 20)`
    ),
    check(
      'chk_payroll_profiles_contract_kind',
      sql`${table.contractKind} IN ('indefinite','fixed_term','work_or_task','apprenticeship','other')`
    ),
    check(
      'chk_payroll_profiles_arl',
      sql`typeof(${table.arlRiskClass}) = 'integer' AND ${table.arlRiskClass} BETWEEN 1 AND 5`
    ),
    check(
      'chk_payroll_profiles_payment',
      sql`${table.paymentMethod} IN ('cash','transfer','other') AND (${table.paymentMethod} != 'transfer' OR ${table.paymentAccountLast4} IS NOT NULL)`
    ),
    check(
      'chk_payroll_profiles_account',
      sql`${table.paymentAccountLast4} IS NULL OR ${table.paymentAccountLast4} GLOB '[0-9][0-9][0-9][0-9]'`
    ),
    check(
      'chk_payroll_profiles_version',
      sql`typeof(${table.version}) = 'integer' AND ${table.version} >= 1`
    ),
    check(
      'chk_payroll_profiles_predecessor',
      sql`${table.predecessorId} IS NULL OR ${table.predecessorId} != ${table.id}`
    ),
  ]
);

/** Complete private profile history; corrections append evidence rather than rewrite it. */
export const payrollEmployeeProfileEvents = sqliteTable(
  'payroll_employee_profile_events',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    profileId: text('profile_id')
      .notNull()
      .references(() => payrollEmployeeProfiles.id),
    version: integer('version').notNull(),
    kind: text('kind', { enum: ['created', 'ended', 'replaced', 'voided'] }).notNull(),
    actorId: text('actor_id')
      .notNull()
      .references(() => users.id),
    operationId: text('operation_id').notNull(),
    reason: text('reason').notNull(),
    before: text('before_json', { mode: 'json' }).$type<PayrollEmployeeProfileSnapshot>(),
    after: text('after_json', { mode: 'json' }).$type<PayrollEmployeeProfileSnapshot>().notNull(),
    createdAt: text('created_at').notNull().default(sqliteNow),
  },
  table => [
    uniqueIndex('idx_payroll_profile_events_version').on(
      table.tenantId,
      table.profileId,
      table.version
    ),
    index('idx_payroll_profile_events_operation').on(table.tenantId, table.operationId),
    check(
      'chk_payroll_profile_events_version',
      sql`typeof(${table.version}) = 'integer' AND ${table.version} >= 1`
    ),
    check(
      'chk_payroll_profile_events_kind',
      sql`${table.kind} IN ('created','ended','replaced','voided')`
    ),
    check(
      'chk_payroll_profile_events_reason',
      sql`length(trim(${table.reason})) BETWEEN 10 AND 500`
    ),
    check(
      'chk_payroll_profile_events_json',
      sql`(${table.before} IS NULL OR json_valid(${table.before})) AND json_valid(${table.after})`
    ),
    check(
      'chk_payroll_profile_events_creation',
      sql`(${table.kind} = 'created' AND ${table.version} = 1 AND ${table.before} IS NULL) OR (${table.kind} != 'created' AND ${table.version} > 1 AND ${table.before} IS NOT NULL)`
    ),
  ]
);

export const payrollPeriods = sqliteTable(
  'payroll_periods',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    countryCode: text('country_code').notNull(),
    frequency: text('frequency', { enum: payrollPeriodFrequencies }).notNull(),
    fromDate: text('from_date').notNull(),
    untilDate: text('until_date').notNull(),
    payDate: text('pay_date').notNull(),
    currencyCode: text('currency_code')
      .notNull()
      .references(() => currencyCatalog.code),
    status: text('status', { enum: ['open', 'closed'] })
      .notNull()
      .default('open'),
    version: integer('version').notNull().default(1),
    createdReason: text('created_reason').notNull(),
    closedReason: text('closed_reason'),
    createdByUserId: text('created_by_user_id')
      .notNull()
      .references(() => users.id),
    closedByUserId: text('closed_by_user_id').references(() => users.id),
    closedAt: text('closed_at'),
    createdAt: text('created_at').notNull().default(sqliteNow),
    updatedAt: text('updated_at').notNull().default(sqliteNow),
  },
  table => [
    uniqueIndex('idx_payroll_periods_window').on(
      table.tenantId,
      table.frequency,
      table.fromDate,
      table.untilDate
    ),
    index('idx_payroll_periods_status_date').on(
      table.tenantId,
      table.status,
      table.fromDate,
      table.id
    ),
    check('chk_payroll_periods_country', sql`${table.countryCode} = 'CO'`),
    check(
      'chk_payroll_periods_frequency',
      sql`${table.frequency} IN ('weekly','biweekly','semimonthly','monthly','other')`
    ),
    check(
      'chk_payroll_periods_dates',
      sql`${calendarDate(table.fromDate)} AND ${calendarDate(table.untilDate)} AND ${calendarDate(table.payDate)} AND ${table.untilDate} > ${table.fromDate} AND julianday(${table.untilDate}) - julianday(${table.fromDate}) BETWEEN 1 AND 31 AND ${table.payDate} >= ${table.fromDate}`
    ),
    check(
      'chk_payroll_periods_state',
      sql`(${table.status} = 'open' AND ${table.closedByUserId} IS NULL AND ${table.closedAt} IS NULL AND ${table.closedReason} IS NULL) OR (${table.status} = 'closed' AND ${table.closedByUserId} IS NOT NULL AND ${table.closedAt} IS NOT NULL AND ${utcInstant(table.closedAt)} AND ${table.closedReason} IS NOT NULL)`
    ),
    check(
      'chk_payroll_periods_reasons',
      sql`length(trim(${table.createdReason})) BETWEEN 10 AND 500 AND (${table.closedReason} IS NULL OR length(trim(${table.closedReason})) BETWEEN 10 AND 500)`
    ),
    check(
      'chk_payroll_periods_version',
      sql`typeof(${table.version}) = 'integer' AND ${table.version} >= 1`
    ),
  ]
);

/** Stable run header; all calculated values live in append-only revisions. */
export const payrollRuns = sqliteTable(
  'payroll_runs',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    periodId: text('period_id')
      .notNull()
      .references(() => payrollPeriods.id),
    kind: text('kind', { enum: payrollRunKinds }).notNull(),
    originalRunId: text('original_run_id').references((): AnySQLiteColumn => payrollRuns.id),
    status: text('status', { enum: payrollRunStatuses }).notNull().default('draft'),
    currentRevision: integer('current_revision').notNull().default(0),
    reviewedRevision: integer('reviewed_revision'),
    approvedRevision: integer('approved_revision'),
    version: integer('version').notNull().default(1),
    createdByUserId: text('created_by_user_id')
      .notNull()
      .references(() => users.id),
    reviewedByUserId: text('reviewed_by_user_id').references(() => users.id),
    approvedByUserId: text('approved_by_user_id').references(() => users.id),
    reviewedAt: text('reviewed_at'),
    approvedAt: text('approved_at'),
    createdAt: text('created_at').notNull().default(sqliteNow),
    updatedAt: text('updated_at').notNull().default(sqliteNow),
  },
  table => [
    uniqueIndex('idx_payroll_runs_regular_period')
      .on(table.tenantId, table.periodId)
      .where(sql`${table.kind} = 'regular'`),
    index('idx_payroll_runs_period_status').on(
      table.tenantId,
      table.periodId,
      table.status,
      table.id
    ),
    index('idx_payroll_runs_original').on(table.tenantId, table.originalRunId, table.id),
    check('chk_payroll_runs_kind', sql`${table.kind} IN ('regular','adjustment')`),
    check('chk_payroll_runs_status', sql`${table.status} IN ('draft','reviewed','approved')`),
    check(
      'chk_payroll_runs_adjustment',
      sql`(${table.kind} = 'regular' AND ${table.originalRunId} IS NULL) OR (${table.kind} = 'adjustment' AND ${table.originalRunId} IS NOT NULL AND ${table.originalRunId} != ${table.id})`
    ),
    check(
      'chk_payroll_runs_revision',
      sql`typeof(${table.currentRevision}) = 'integer' AND ${table.currentRevision} >= 0 AND (${table.reviewedRevision} IS NULL OR (typeof(${table.reviewedRevision}) = 'integer' AND ${table.reviewedRevision} BETWEEN 1 AND ${table.currentRevision})) AND (${table.approvedRevision} IS NULL OR (typeof(${table.approvedRevision}) = 'integer' AND ${table.approvedRevision} = ${table.reviewedRevision}))`
    ),
    check(
      'chk_payroll_runs_state',
      sql`(${table.status} = 'draft' AND ${table.reviewedRevision} IS NULL AND ${table.approvedRevision} IS NULL AND ${table.reviewedByUserId} IS NULL AND ${table.approvedByUserId} IS NULL AND ${table.reviewedAt} IS NULL AND ${table.approvedAt} IS NULL) OR (${table.status} = 'reviewed' AND ${table.reviewedRevision} IS NOT NULL AND ${table.approvedRevision} IS NULL AND ${table.reviewedByUserId} IS NOT NULL AND ${table.approvedByUserId} IS NULL AND ${table.reviewedAt} IS NOT NULL AND ${table.approvedAt} IS NULL) OR (${table.status} = 'approved' AND ${table.reviewedRevision} IS NOT NULL AND ${table.approvedRevision} = ${table.reviewedRevision} AND ${table.reviewedByUserId} IS NOT NULL AND ${table.approvedByUserId} IS NOT NULL AND ${table.reviewedAt} IS NOT NULL AND ${table.approvedAt} IS NOT NULL)`
    ),
    check(
      'chk_payroll_runs_instants',
      sql`(${table.reviewedAt} IS NULL OR ${utcInstant(table.reviewedAt)}) AND (${table.approvedAt} IS NULL OR ${utcInstant(table.approvedAt)})`
    ),
    check(
      'chk_payroll_runs_version',
      sql`typeof(${table.version}) = 'integer' AND ${table.version} >= 1`
    ),
  ]
);

/** Effective policy facts frozen into one calculation revision. */
export interface PayrollPolicySnapshot {
  policyVersion: string;
  countryCode: 'CO';
  effectiveFrom: string;
  effectiveUntil: string | null;
  legalStatus: 'review_required' | 'transitional_pending_judicial_review';
  sourceUrls: string[];
  reviewedAt: string;
  minimumMonthlyWage: number | null;
  transportAssistance: number | null;
  weeklyRegularSeconds: number;
  dayStartMinute: number;
  nightStartMinute: number;
  ordinaryNightPremiumRate: number;
  dayOvertimePremiumRate: number;
  nightOvertimePremiumRate: number;
  restDayPremiumRate: number;
  employeeHealthRate: number;
  employerHealthRate: number;
  employeePensionRate: number;
  employerPensionRate: number;
  compensationFundRate: number;
  senaRate: number;
  icbfRate: number;
  integralSalaryIbcRate: number;
  integralSalaryMinimumWageMultiples: number;
  maximumIbcMinimumWageMultiples: number;
  transportAssistanceMaximumWageMultiples: number;
  arlRiskRates: Record<'1' | '2' | '3' | '4' | '5', number>;
  solidarityPensionBrackets: Array<{
    fromMinimumWageMultiples: number;
    fromInclusive: boolean;
    upToMinimumWageMultiples: number | null;
    rate: number;
  }>;
  limitations: string[];
}

export const payrollRunRevisions = sqliteTable(
  'payroll_run_revisions',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    runId: text('run_id')
      .notNull()
      .references(() => payrollRuns.id),
    revision: integer('revision').notNull(),
    status: text('status', { enum: payrollCalculationStatuses }).notNull(),
    policyVersion: text('policy_version').notNull(),
    policySnapshot: text('policy_snapshot_json', { mode: 'json' })
      .$type<PayrollPolicySnapshot>()
      .notNull(),
    sourceCutoff: text('source_cutoff').notNull(),
    currencyCode: text('currency_code')
      .notNull()
      .references(() => currencyCatalog.code),
    grossAmount: real('gross_amount').notNull(),
    deductionAmount: real('deduction_amount').notNull(),
    netAmount: real('net_amount').notNull(),
    employerContributionAmount: real('employer_contribution_amount').notNull(),
    blockers: text('blockers_json', { mode: 'json' }).$type<string[]>().notNull(),
    generatedByUserId: text('generated_by_user_id')
      .notNull()
      .references(() => users.id),
    createdAt: text('created_at').notNull().default(sqliteNow),
  },
  table => [
    uniqueIndex('idx_payroll_run_revisions_number').on(table.tenantId, table.runId, table.revision),
    index('idx_payroll_run_revisions_created').on(table.tenantId, table.createdAt, table.id),
    check(
      'chk_payroll_run_revisions_revision',
      sql`typeof(${table.revision}) = 'integer' AND ${table.revision} >= 1`
    ),
    check(
      'chk_payroll_run_revisions_status',
      sql`${table.status} IN ('complete','blocked') AND CASE WHEN json_valid(${table.blockers}) AND json_type(${table.blockers}) = 'array' THEN (${table.status} = 'complete' AND json_array_length(${table.blockers}) = 0) OR (${table.status} = 'blocked' AND json_array_length(${table.blockers}) > 0) ELSE 0 END`
    ),
    check('chk_payroll_run_revisions_policy', sql`json_valid(${table.policySnapshot})`),
    check('chk_payroll_run_revisions_cutoff', utcInstant(table.sourceCutoff)),
    ...moneyPositiveChecks('payroll_run_revisions_gross', table.grossAmount),
    ...moneyPositiveChecks('payroll_run_revisions_deduction', table.deductionAmount),
    ...moneyPositiveChecks('payroll_run_revisions_net', table.netAmount),
    ...moneyPositiveChecks(
      'payroll_run_revisions_employer_contribution',
      table.employerContributionAmount
    ),
    check(
      'chk_payroll_run_revisions_totals',
      sql`round(${table.grossAmount} - ${table.deductionAmount}, 2) = ${table.netAmount}`
    ),
  ]
);

/** Administrator-reviewed facts frozen with one employee calculation. */
export interface PayrollSettlementReviewSnapshot {
  operationId: string;
  policyAcknowledged: boolean;
  payrollDays: number | null;
  ordinaryWorkedSeconds: number | null;
  employeeClassification: 'private_cst' | 'review_required' | 'unsupported';
  holidayCalendarReviewed: boolean;
  employeeRestDayReviewed: boolean;
  contributionExemption: 'applies' | 'does_not_apply' | 'review_required';
  contributionBaseAmount: number | null;
  transportAssistance: 'applies' | 'does_not_apply' | 'review_required';
  withholding:
    { status: 'review_required' } | { status: 'complete'; amount: number; reason: string };
  benefitsReviewed: boolean;
  reviewReason: string;
  manualConcepts: Array<{
    category: PayrollConceptCategory;
    code: string;
    label: string;
    amount: number;
    reason: string;
  }>;
}

/** Optional immutable lineage from an adjustment to the approved employee result it corrects. */
export interface PayrollAdjustmentSourceSnapshot {
  runId: string;
  revision: number;
  employeeResultId: string;
}

/** Exact private evidence used to calculate one employee in one revision. */
export interface PayrollEmployeeSourceSnapshot {
  payrollProfile: PayrollEmployeeProfileSnapshot;
  employmentContractId: string;
  employmentContractVersion: number;
  attendanceIds: string[];
  attendanceCorrectionVersions: Record<string, number>;
  reconciliationIds: string[];
  policyIds: string[];
  settlementReview: PayrollSettlementReviewSnapshot;
  adjustmentSource: PayrollAdjustmentSourceSnapshot | null;
  sourceCutoff: string;
}

export const payrollEmployeeResults = sqliteTable(
  'payroll_employee_results',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    revisionId: text('revision_id')
      .notNull()
      .references(() => payrollRunRevisions.id),
    userId: text('user_id')
      .notNull()
      .references(() => users.id),
    payrollProfileId: text('payroll_profile_id')
      .notNull()
      .references(() => payrollEmployeeProfiles.id),
    employmentContractId: text('employment_contract_id')
      .notNull()
      .references(() => employmentContracts.id),
    sourceSnapshot: text('source_snapshot_json', { mode: 'json' })
      .$type<PayrollEmployeeSourceSnapshot>()
      .notNull(),
    status: text('status', { enum: payrollCalculationStatuses }).notNull(),
    currencyCode: text('currency_code')
      .notNull()
      .references(() => currencyCatalog.code),
    grossAmount: real('gross_amount').notNull(),
    deductionAmount: real('deduction_amount').notNull(),
    netAmount: real('net_amount').notNull(),
    employerContributionAmount: real('employer_contribution_amount').notNull(),
    blockers: text('blockers_json', { mode: 'json' }).$type<string[]>().notNull(),
    createdAt: text('created_at').notNull().default(sqliteNow),
  },
  table => [
    uniqueIndex('idx_payroll_employee_results_revision_user').on(
      table.tenantId,
      table.revisionId,
      table.userId
    ),
    index('idx_payroll_employee_results_user').on(table.tenantId, table.userId, table.id),
    check('chk_payroll_employee_results_source', sql`json_valid(${table.sourceSnapshot})`),
    check(
      'chk_payroll_employee_results_status',
      sql`${table.status} IN ('complete','blocked') AND CASE WHEN json_valid(${table.blockers}) AND json_type(${table.blockers}) = 'array' THEN (${table.status} = 'complete' AND json_array_length(${table.blockers}) = 0) OR (${table.status} = 'blocked' AND json_array_length(${table.blockers}) > 0) ELSE 0 END`
    ),
    ...moneyPositiveChecks('payroll_employee_results_gross', table.grossAmount),
    ...moneyPositiveChecks('payroll_employee_results_deduction', table.deductionAmount),
    ...moneyPositiveChecks('payroll_employee_results_net', table.netAmount),
    ...moneyPositiveChecks(
      'payroll_employee_results_employer_contribution',
      table.employerContributionAmount
    ),
    check(
      'chk_payroll_employee_results_totals',
      sql`round(${table.grossAmount} - ${table.deductionAmount}, 2) = ${table.netAmount}`
    ),
  ]
);

/**
 * Normalized immutable source link.
 *
 * The result keeps its primary profile and contract foreign keys for fast reads;
 * this table additionally freezes every attendance, correction, reconciliation,
 * policy, profile and contract source when a period spans multiple source rows.
 */
export const payrollResultSources = sqliteTable(
  'payroll_result_sources',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    employeeResultId: text('employee_result_id')
      .notNull()
      .references(() => payrollEmployeeResults.id),
    kind: text('kind', { enum: payrollResultSourceKinds }).notNull(),
    sourceId: text('source_id').notNull(),
    sourceVersion: integer('source_version'),
    sourceDigest: text('source_digest').notNull(),
    sourceSnapshot: text('source_snapshot_json', { mode: 'json' })
      .$type<Record<string, unknown>>()
      .notNull(),
    createdAt: text('created_at').notNull().default(sqliteNow),
  },
  table => [
    uniqueIndex('idx_payroll_result_sources_identity').on(
      table.tenantId,
      table.employeeResultId,
      table.kind,
      table.sourceId
    ),
    index('idx_payroll_result_sources_source').on(
      table.tenantId,
      table.kind,
      table.sourceId,
      table.employeeResultId
    ),
    check(
      'chk_payroll_result_sources_kind',
      sql`${table.kind} IN ('payroll_profile','employment_contract','attendance','attendance_correction','reconciliation','policy')`
    ),
    check(
      'chk_payroll_result_sources_version',
      sql`${table.sourceVersion} IS NULL OR (typeof(${table.sourceVersion}) = 'integer' AND ${table.sourceVersion} >= 1)`
    ),
    check(
      'chk_payroll_result_sources_digest',
      sql`length(${table.sourceDigest}) = 64 AND ${table.sourceDigest} NOT GLOB '*[^0-9a-f]*'`
    ),
    check('chk_payroll_result_sources_json', sql`json_valid(${table.sourceSnapshot})`),
  ]
);

export const payrollConceptLines = sqliteTable(
  'payroll_concept_lines',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    employeeResultId: text('employee_result_id')
      .notNull()
      .references(() => payrollEmployeeResults.id),
    category: text('category', { enum: payrollConceptCategories }).notNull(),
    code: text('code').notNull(),
    label: text('label').notNull(),
    origin: text('origin', { enum: payrollConceptOrigins }).notNull(),
    unit: text('unit', { enum: payrollConceptUnits }).notNull(),
    quantity: real('quantity'),
    rate: real('rate'),
    baseAmount: real('base_amount'),
    amount: real('amount').notNull(),
    sourceRefs: text('source_refs_json', { mode: 'json' }).$type<string[]>().notNull(),
    manualReason: text('manual_reason'),
    createdByUserId: text('created_by_user_id')
      .notNull()
      .references(() => users.id),
    createdAt: text('created_at').notNull().default(sqliteNow),
  },
  table => [
    uniqueIndex('idx_payroll_concept_lines_code').on(
      table.tenantId,
      table.employeeResultId,
      table.category,
      table.code
    ),
    index('idx_payroll_concept_lines_result').on(table.tenantId, table.employeeResultId, table.id),
    check(
      'chk_payroll_concept_lines_category',
      sql`${table.category} IN ('earning','deduction','employer_contribution')`
    ),
    check(
      'chk_payroll_concept_lines_origin',
      sql`${table.origin} IN ('contract','attendance','policy','manual','adjustment')`
    ),
    check(
      'chk_payroll_concept_lines_unit',
      sql`${table.unit} IN ('amount','seconds','days','units')`
    ),
    check(
      'chk_payroll_concept_lines_code_label',
      sql`length(trim(${table.code})) BETWEEN 1 AND 50 AND length(trim(${table.label})) BETWEEN 1 AND 120`
    ),
    check(
      'chk_payroll_concept_lines_numbers',
      sql`(${table.quantity} IS NULL OR (${table.quantity} >= 0 AND ${table.quantity} <= 1000000000000)) AND (${table.rate} IS NULL OR (${table.rate} >= 0 AND ${table.rate} <= 1000000000000)) AND (${table.baseAmount} IS NULL OR (${table.baseAmount} >= 0 AND ${table.baseAmount} <= 1000000000000))`
    ),
    check(
      'chk_payroll_concept_lines_sources',
      sql`json_valid(${table.sourceRefs}) AND json_type(${table.sourceRefs}) = 'array'`
    ),
    check(
      'chk_payroll_concept_lines_manual',
      sql`(${table.origin} = 'manual' AND ${table.manualReason} IS NOT NULL AND length(trim(${table.manualReason})) BETWEEN 10 AND 500) OR (${table.origin} != 'manual' AND ${table.manualReason} IS NULL)`
    ),
    check(
      'chk_payroll_concept_lines_rate_precision',
      sql`${table.rate} IS NULL OR round(${table.rate}, 8) = ${table.rate}`
    ),
    moneyTwoDecimalCheck('payroll_concept_lines_base', table.baseAmount),
    ...moneyPositiveChecks('payroll_concept_lines_amount', table.amount),
  ]
);

/** Private append-only lifecycle proof for review, approval and later adjustments. */
export interface PayrollRunEventSnapshot {
  status: PayrollRunStatus;
  currentRevision: number;
  reviewedRevision: number | null;
  approvedRevision: number | null;
  version: number;
}

export const payrollRunEvents = sqliteTable(
  'payroll_run_events',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    runId: text('run_id')
      .notNull()
      .references(() => payrollRuns.id),
    version: integer('version').notNull(),
    kind: text('kind', { enum: ['created', 'recalculated', 'reviewed', 'approved'] }).notNull(),
    revision: integer('revision').notNull(),
    actorId: text('actor_id')
      .notNull()
      .references(() => users.id),
    operationId: text('operation_id').notNull(),
    reason: text('reason'),
    snapshot: text('snapshot_json', { mode: 'json' }).$type<PayrollRunEventSnapshot>().notNull(),
    createdAt: text('created_at').notNull().default(sqliteNow),
  },
  table => [
    uniqueIndex('idx_payroll_run_events_version').on(table.tenantId, table.runId, table.version),
    index('idx_payroll_run_events_operation').on(table.tenantId, table.operationId),
    check(
      'chk_payroll_run_events_version',
      sql`typeof(${table.version}) = 'integer' AND ${table.version} >= 1 AND typeof(${table.revision}) = 'integer' AND ${table.revision} >= 0`
    ),
    check(
      'chk_payroll_run_events_kind',
      sql`${table.kind} IN ('created','recalculated','reviewed','approved')`
    ),
    check(
      'chk_payroll_run_events_reason',
      sql`(${table.kind} IN ('created','recalculated') AND (${table.reason} IS NULL OR length(trim(${table.reason})) BETWEEN 10 AND 500)) OR (${table.kind} IN ('reviewed','approved') AND ${table.reason} IS NOT NULL AND length(trim(${table.reason})) BETWEEN 10 AND 500)`
    ),
    check('chk_payroll_run_events_snapshot', sql`json_valid(${table.snapshot})`),
    check(
      'chk_payroll_run_events_shape',
      sql`(${table.kind} = 'created' AND ${table.version} = 1 AND ${table.revision} = 0) OR (${table.kind} != 'created' AND ${table.version} > 1 AND ${table.revision} >= 1)`
    ),
  ]
);

export const payrollProviderJobs = sqliteTable(
  'payroll_provider_jobs',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    runId: text('run_id')
      .notNull()
      .references(() => payrollRuns.id),
    revision: integer('revision').notNull(),
    employeeResultId: text('employee_result_id')
      .notNull()
      .references(() => payrollEmployeeResults.id),
    adapterId: text('adapter_id', { enum: ['sandbox_v1'] }).notNull(),
    status: text('status', { enum: ['queued', 'accepted', 'rejected'] })
      .notNull()
      .default('queued'),
    payload: text('payload_json', { mode: 'json' }).$type<Record<string, unknown>>().notNull(),
    response: text('response_json', { mode: 'json' }).$type<Record<string, unknown>>(),
    errorCode: text('error_code'),
    createdAt: text('created_at').notNull().default(sqliteNow),
    updatedAt: text('updated_at').notNull().default(sqliteNow),
  },
  table => [
    uniqueIndex('idx_payroll_provider_jobs_result').on(
      table.tenantId,
      table.employeeResultId,
      table.adapterId
    ),
    index('idx_payroll_provider_jobs_status').on(table.tenantId, table.status, table.createdAt),
    check('chk_payroll_provider_jobs_adapter', sql`${table.adapterId} = 'sandbox_v1'`),
    check(
      'chk_payroll_provider_jobs_revision',
      sql`typeof(${table.revision}) = 'integer' AND ${table.revision} >= 1`
    ),
    check(
      'chk_payroll_provider_jobs_status',
      sql`(${table.status} = 'queued' AND ${table.response} IS NULL AND ${table.errorCode} IS NULL) OR (${table.status} = 'accepted' AND ${table.response} IS NOT NULL AND ${table.errorCode} IS NULL) OR (${table.status} = 'rejected' AND ${table.response} IS NOT NULL AND ${table.errorCode} IS NOT NULL)`
    ),
    check(
      'chk_payroll_provider_jobs_json',
      sql`json_valid(${table.payload}) AND (${table.response} IS NULL OR json_valid(${table.response}))`
    ),
  ]
);

export type PayrollEmployeeProfile = typeof payrollEmployeeProfiles.$inferSelect;
export type PayrollPeriod = typeof payrollPeriods.$inferSelect;
export type PayrollRun = typeof payrollRuns.$inferSelect;
export type PayrollRunRevision = typeof payrollRunRevisions.$inferSelect;
export type PayrollEmployeeResult = typeof payrollEmployeeResults.$inferSelect;
export type PayrollResultSource = typeof payrollResultSources.$inferSelect;
export type PayrollConceptLine = typeof payrollConceptLines.$inferSelect;
export type PayrollRunEvent = typeof payrollRunEvents.$inferSelect;
export type PayrollProviderJob = typeof payrollProviderJobs.$inferSelect;
