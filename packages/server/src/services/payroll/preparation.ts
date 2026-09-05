/** Authoritative, bounded employee set used before a private pre-payroll calculation. */
import { and, eq, gt, inArray, isNull, lt, or } from 'drizzle-orm';
import type { DatabaseInstance } from '../../db/index.js';
import {
  employmentContracts,
  payrollEmployeeProfiles,
  payrollEmployeeResults,
  payrollPeriods,
  payrollResultSources,
  payrollRunRevisions,
  payrollRuns,
  sites,
  users,
} from '../../db/schema.js';
import { denyPayroll } from '../../application/payroll/errors.js';
import { hashCanonicalInput } from '../idempotency/keyHasher.js';
import { zonedWallTimeToIso } from '../labor/timezone.js';
import { resolveTenantBusinessClock } from '../pharmacy/business-clock.js';
import { loadPayrollAttendanceForUsers, type PayrollPreparedAttendance } from './attendance.js';
import { parsePayrollContractEvidence } from './contract-evidence.js';

export const payrollPreparationBlockers = [
  'missing_profile',
  'missing_contract',
  'ambiguous_profile',
  'ambiguous_contract',
  'profile_site_mismatch',
  'profile_contract_window_mismatch',
  'unsupported_country',
  'unsupported_currency',
  'time_zone_mismatch',
  'missing_employee',
  'missing_site',
  'employee_limit_exceeded',
] as const;
export type PayrollPreparationBlocker = (typeof payrollPreparationBlockers)[number];

export interface PayrollPreparationEmployee {
  userId: string;
  userName: string | null;
  userActive: boolean | null;
  siteId: string | null;
  siteName: string | null;
  siteActive: boolean | null;
  payBasis: 'hourly' | 'monthly' | null;
  derivedWorkedSeconds: number | null;
  attendanceBlockers: string[];
  configurationBlockers: PayrollPreparationBlocker[];
}

export interface PayrollRunPreparation {
  runId: string;
  runVersion: number;
  kind: 'regular' | 'adjustment';
  authorityToken: string;
  employees: PayrollPreparationEmployee[];
  blockers: PayrollPreparationBlocker[];
  ready: boolean;
}

/** Private transaction-local authority reused by calculation after the token check. */
export interface RegularPayrollEmployeeAuthority {
  profile: typeof payrollEmployeeProfiles.$inferSelect;
  contract: typeof employmentContracts.$inferSelect;
  attendance: PayrollPreparedAttendance;
}

export interface RegularPayrollRunAuthority {
  preparation: PayrollRunPreparation;
  employeesByUser: Map<string, RegularPayrollEmployeeAuthority>;
}

const EMPLOYEE_LIMIT = 500;

function groupByUser<T extends { userId: string }>(rows: T[]): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const row of rows) groups.set(row.userId, [...(groups.get(row.userId) ?? []), row]);
  return groups;
}

function relatedLabels(
  db: DatabaseInstance,
  tenantId: string,
  userIds: string[],
  siteIds: string[]
) {
  const userRows =
    userIds.length === 0
      ? []
      : db
          .select({ id: users.id, name: users.name, isActive: users.isActive })
          .from(users)
          .where(and(eq(users.tenantId, tenantId), inArray(users.id, userIds)))
          .all();
  const siteRows =
    siteIds.length === 0
      ? []
      : db
          .select({ id: sites.id, name: sites.name, isActive: sites.isActive })
          .from(sites)
          .where(and(eq(sites.tenantId, tenantId), inArray(sites.id, siteIds)))
          .all();
  return {
    users: new Map(userRows.map(row => [row.id, row])),
    sites: new Map(siteRows.map(row => [row.id, row])),
  };
}

function emptyAttendance(): PayrollPreparedAttendance {
  return {
    workedSeconds: 0,
    attendanceIds: [],
    correctionVersions: {},
    reconciliationIds: [],
    sources: [],
    blockers: [],
  };
}

export function prepareRegularPayrollRunAuthority(
  db: DatabaseInstance,
  tenantId: string,
  run: typeof payrollRuns.$inferSelect,
  period: { fromDate: string; untilDate: string; currencyCode: string },
  timeZone: string
): RegularPayrollRunAuthority {
  const profiles = db
    .select()
    .from(payrollEmployeeProfiles)
    .where(
      and(
        eq(payrollEmployeeProfiles.tenantId, tenantId),
        isNull(payrollEmployeeProfiles.voidedAt),
        lt(payrollEmployeeProfiles.effectiveFrom, period.untilDate),
        or(
          isNull(payrollEmployeeProfiles.effectiveUntil),
          gt(payrollEmployeeProfiles.effectiveUntil, period.fromDate)
        )
      )
    )
    .limit(EMPLOYEE_LIMIT + 1)
    .all();
  const contracts = db
    .select()
    .from(employmentContracts)
    .where(
      and(
        eq(employmentContracts.tenantId, tenantId),
        isNull(employmentContracts.voidedAt),
        lt(employmentContracts.effectiveFrom, period.untilDate),
        or(
          isNull(employmentContracts.effectiveUntil),
          gt(employmentContracts.effectiveUntil, period.fromDate)
        )
      )
    )
    .limit(EMPLOYEE_LIMIT + 1)
    .all();
  const globalBlockers = new Set<PayrollPreparationBlocker>();
  if (profiles.length > EMPLOYEE_LIMIT || contracts.length > EMPLOYEE_LIMIT) {
    globalBlockers.add('employee_limit_exceeded');
  }
  const profileGroups = groupByUser(profiles.slice(0, EMPLOYEE_LIMIT));
  const contractGroups = groupByUser(contracts.slice(0, EMPLOYEE_LIMIT));
  const userIds = [...new Set([...profileGroups.keys(), ...contractGroups.keys()])]
    .sort()
    .slice(0, EMPLOYEE_LIMIT);
  if (new Set([...profileGroups.keys(), ...contractGroups.keys()]).size > EMPLOYEE_LIMIT) {
    globalBlockers.add('employee_limit_exceeded');
  }
  const siteIds = [
    ...new Set([...profiles.map(row => row.siteId), ...contracts.map(row => row.siteId)]),
  ];
  const labels = relatedLabels(db, tenantId, userIds, siteIds);
  const baseEmployees = userIds.map(userId => {
    const profileRows = profileGroups.get(userId) ?? [];
    const contractRows = contractGroups.get(userId) ?? [];
    const profile = profileRows[0] ?? null;
    const contract = contractRows[0] ?? null;
    const blockers = new Set<PayrollPreparationBlocker>();
    if (!profile) blockers.add('missing_profile');
    if (!contract) blockers.add('missing_contract');
    if (profileRows.length > 1) blockers.add('ambiguous_profile');
    if (contractRows.length > 1) blockers.add('ambiguous_contract');
    if (profile?.countryCode !== undefined && profile.countryCode !== 'CO') {
      blockers.add('unsupported_country');
    }
    if (contract?.currencyCode !== undefined && contract.currencyCode !== period.currencyCode) {
      blockers.add('unsupported_currency');
    }
    if (contract?.timeZone !== undefined && contract.timeZone !== timeZone) {
      blockers.add('time_zone_mismatch');
    }
    if (profile && contract && profile.siteId !== contract.siteId) {
      blockers.add('profile_site_mismatch');
    }
    const activeFrom =
      profile && contract
        ? [period.fromDate, profile.effectiveFrom, contract.effectiveFrom].sort().at(-1)!
        : period.fromDate;
    const activeUntil =
      profile && contract
        ? [
            period.untilDate,
            profile.effectiveUntil ?? period.untilDate,
            contract.effectiveUntil ?? period.untilDate,
          ].sort()[0]!
        : period.untilDate;
    if (profile && contract && activeFrom >= activeUntil) {
      blockers.add('profile_contract_window_mismatch');
    }
    const user = labels.users.get(userId) ?? null;
    if (!user) blockers.add('missing_employee');
    const siteId = profile?.siteId ?? contract?.siteId ?? null;
    const site = siteId === null ? null : (labels.sites.get(siteId) ?? null);
    if (!site) blockers.add('missing_site');
    for (const blocker of blockers) globalBlockers.add(blocker);
    return { userId, profile, contract, user, siteId, site, activeFrom, activeUntil, blockers };
  });
  const attendanceByUser = loadPayrollAttendanceForUsers(
    db,
    tenantId,
    baseEmployees.flatMap(employee =>
      employee.blockers.size === 0 &&
      employee.contract?.payBasis === 'hourly' &&
      employee.activeFrom < employee.activeUntil
        ? [
            {
              userId: employee.userId,
              from: zonedWallTimeToIso(employee.activeFrom, '00:00', timeZone),
              until: zonedWallTimeToIso(employee.activeUntil, '00:00', timeZone),
            },
          ]
        : []
    )
  );
  const employeesByUser = new Map<string, RegularPayrollEmployeeAuthority>();
  const tokenEmployees: Array<Record<string, unknown>> = [];
  const employees = baseEmployees.map(employee => {
    const { userId, profile, contract, user, siteId, site, activeFrom, activeUntil, blockers } =
      employee;
    const attendance =
      contract?.payBasis === 'hourly' ? (attendanceByUser.get(userId) ?? null) : null;
    if (blockers.size === 0 && profile && contract) {
      employeesByUser.set(userId, {
        profile,
        contract,
        attendance: attendance ?? emptyAttendance(),
      });
    }
    tokenEmployees.push({
      userId,
      profile: profile
        ? { id: profile.id, version: profile.version, digest: hashCanonicalInput(profile) }
        : null,
      contract: contract
        ? { id: contract.id, version: contract.version, digest: hashCanonicalInput(contract) }
        : null,
      activeFrom,
      activeUntil,
      attendance:
        attendance === null
          ? null
          : {
              workedSeconds: attendance.workedSeconds,
              blockers: attendance.blockers,
              sources: attendance.sources.map(source => ({
                kind: source.kind,
                sourceId: source.sourceId,
                sourceVersion: source.sourceVersion,
                sourceDigest: source.sourceDigest,
              })),
            },
      configurationBlockers: [...blockers].sort(),
    });
    return {
      userId,
      userName: user?.name ?? null,
      userActive: user?.isActive ?? null,
      siteId,
      siteName: site?.name ?? null,
      siteActive: site?.isActive ?? null,
      payBasis: contract?.payBasis ?? null,
      derivedWorkedSeconds: attendance?.workedSeconds ?? null,
      attendanceBlockers: attendance?.blockers ?? [],
      configurationBlockers: [...blockers].sort(),
    } satisfies PayrollPreparationEmployee;
  });
  return {
    preparation: {
      runId: run.id,
      runVersion: run.version,
      kind: run.kind,
      authorityToken: hashCanonicalInput({
        runId: run.id,
        runVersion: run.version,
        kind: run.kind,
        employees: tokenEmployees,
      }),
      employees,
      blockers: [...globalBlockers].sort(),
      ready: globalBlockers.size === 0 && employees.length > 0,
    },
    employeesByUser,
  };
}

export function getRegularPayrollRunPreparation(
  db: DatabaseInstance,
  tenantId: string,
  run: typeof payrollRuns.$inferSelect,
  period: { fromDate: string; untilDate: string; currencyCode: string },
  timeZone: string
): PayrollRunPreparation {
  return prepareRegularPayrollRunAuthority(db, tenantId, run, period, timeZone).preparation;
}

export function getAdjustmentPayrollRunPreparation(
  db: DatabaseInstance,
  tenantId: string,
  run: typeof payrollRuns.$inferSelect
): PayrollRunPreparation {
  if (run.originalRunId === null) denyPayroll('adjustment');
  const original = db
    .select()
    .from(payrollRuns)
    .where(
      and(
        eq(payrollRuns.tenantId, tenantId),
        eq(payrollRuns.id, run.originalRunId),
        eq(payrollRuns.status, 'approved')
      )
    )
    .get();
  if (!original || original.approvedRevision === null) denyPayroll('adjustment');
  const revision = db
    .select({ id: payrollRunRevisions.id })
    .from(payrollRunRevisions)
    .where(
      and(
        eq(payrollRunRevisions.tenantId, tenantId),
        eq(payrollRunRevisions.runId, original.id),
        eq(payrollRunRevisions.revision, original.approvedRevision),
        eq(payrollRunRevisions.status, 'complete')
      )
    )
    .get();
  if (!revision) denyPayroll('adjustment');
  const resultRows = db
    .select()
    .from(payrollEmployeeResults)
    .where(
      and(
        eq(payrollEmployeeResults.tenantId, tenantId),
        eq(payrollEmployeeResults.revisionId, revision.id),
        eq(payrollEmployeeResults.status, 'complete')
      )
    )
    .limit(EMPLOYEE_LIMIT + 1)
    .all();
  const globalBlockers = new Set<PayrollPreparationBlocker>();
  if (resultRows.length > EMPLOYEE_LIMIT) globalBlockers.add('employee_limit_exceeded');
  const results = resultRows.slice(0, EMPLOYEE_LIMIT);
  const resultIds = results.map(row => row.id);
  const contractSources =
    resultIds.length === 0
      ? []
      : db
          .select()
          .from(payrollResultSources)
          .where(
            and(
              eq(payrollResultSources.tenantId, tenantId),
              inArray(payrollResultSources.employeeResultId, resultIds),
              eq(payrollResultSources.kind, 'employment_contract')
            )
          )
          .all();
  const contractSourceByResult = new Map(contractSources.map(row => [row.employeeResultId, row]));
  const labels = relatedLabels(
    db,
    tenantId,
    results.map(row => row.userId),
    [...new Set(results.map(row => row.sourceSnapshot.payrollProfile.siteId))]
  );
  const employees = results
    .sort((left, right) => left.userId.localeCompare(right.userId))
    .map(result => {
      const profile = result.sourceSnapshot.payrollProfile;
      const contractSource = contractSourceByResult.get(result.id) ?? null;
      const contract = parsePayrollContractEvidence(contractSource?.sourceSnapshot);
      const user = labels.users.get(result.userId) ?? null;
      const site = labels.sites.get(profile.siteId) ?? null;
      const blockers = new Set<PayrollPreparationBlocker>();
      if (profile.userId !== result.userId || profile.version < 1 || profile.countryCode !== 'CO') {
        blockers.add('missing_profile');
      }
      if (
        !contract ||
        !contractSource ||
        contractSource.sourceId !== result.employmentContractId ||
        contractSource.sourceVersion !== contract?.version ||
        hashCanonicalInput(contractSource.sourceSnapshot) !== contractSource.sourceDigest ||
        contract?.terms.userId !== result.userId ||
        contract?.terms.siteId !== profile.siteId
      ) {
        blockers.add('missing_contract');
      }
      if (!user) blockers.add('missing_employee');
      if (!site) blockers.add('missing_site');
      for (const blocker of blockers) globalBlockers.add(blocker);
      return {
        userId: result.userId,
        userName: user?.name ?? null,
        userActive: user?.isActive ?? null,
        siteId: profile.siteId,
        siteName: site?.name ?? null,
        siteActive: site?.isActive ?? null,
        payBasis: contract?.terms.pay.basis ?? null,
        derivedWorkedSeconds: null,
        attendanceBlockers: [],
        configurationBlockers: [...blockers].sort(),
      } satisfies PayrollPreparationEmployee;
    });
  return {
    runId: run.id,
    runVersion: run.version,
    kind: run.kind,
    authorityToken: hashCanonicalInput({
      runId: run.id,
      runVersion: run.version,
      kind: run.kind,
      originalRunId: original.id,
      originalRevision: original.approvedRevision,
      employees: results.map(result => ({
        id: result.id,
        userId: result.userId,
        sourceSnapshot: result.sourceSnapshot,
        contractSource: contractSourceByResult.get(result.id)
          ? {
              sourceId: contractSourceByResult.get(result.id)!.sourceId,
              sourceVersion: contractSourceByResult.get(result.id)!.sourceVersion,
              sourceDigest: contractSourceByResult.get(result.id)!.sourceDigest,
            }
          : null,
      })),
    }),
    employees,
    blockers: [...globalBlockers].sort(),
    ready: globalBlockers.size === 0 && employees.length > 0,
  };
}

/** Read the complete authoritative employee universe without trusting client-side joins. */
export async function getPayrollRunPreparation(
  db: DatabaseInstance,
  tenantId: string,
  runId: string
): Promise<PayrollRunPreparation> {
  const run = db
    .select()
    .from(payrollRuns)
    .where(and(eq(payrollRuns.tenantId, tenantId), eq(payrollRuns.id, runId)))
    .get();
  if (!run) denyPayroll('not_found');
  if (run.status !== 'draft') denyPayroll('state');
  const period = db
    .select({
      fromDate: payrollPeriods.fromDate,
      untilDate: payrollPeriods.untilDate,
      currencyCode: payrollPeriods.currencyCode,
      countryCode: payrollPeriods.countryCode,
      status: payrollPeriods.status,
    })
    .from(payrollPeriods)
    .where(and(eq(payrollPeriods.tenantId, tenantId), eq(payrollPeriods.id, run.periodId)))
    .get();
  if (!period) denyPayroll('not_found');
  if (period.status !== 'open') denyPayroll('state');
  const clock = await resolveTenantBusinessClock(db, tenantId);
  if (clock.countryCode !== 'CO' || period.countryCode !== 'CO') denyPayroll('country');
  if (period.currencyCode !== 'COP') denyPayroll('currency');
  if (run.kind === 'adjustment') return getAdjustmentPayrollRunPreparation(db, tenantId, run);
  return getRegularPayrollRunPreparation(db, tenantId, run, period, clock.timezone);
}
