import type { UserRole } from '@puntovivo/shared/roles';
import { and, eq } from 'drizzle-orm';
import type { DatabaseInstance } from '../../db/index.js';
import { sites, users } from '../../db/schema.js';
import { throwServerError } from '../../lib/errorCodes.js';
import type {
  ExportEmployeeAttendanceInput,
  ListEmployeeAttendanceInput,
} from '../../trpc/schemas/employeeShifts.js';
import { resolveTenantLocale } from '../tenant-locale.js';
import { loadEffectiveAttendanceRows } from './attendance-evidence.js';
import { managerCanTarget, MAX_LIST_DAYS } from './scheduled-shift-policy.js';
import {
  calculateOvertime,
  laborWeekStartDate,
  type OvertimeShiftAllocation,
  type OvertimeShiftInput,
} from './overtime-calculator.js';
import {
  isOvertimeCountry,
  resolveOvertimePolicy,
  type OvertimePolicyProfile,
} from './overtime-policy.js';
import { addCalendarDays, zonedWallTimeToIso } from './timezone.js';

function assertAttendanceRange(fromDate: string, toDate: string): void {
  try {
    if (addCalendarDays(fromDate, 0) !== fromDate || addCalendarDays(toDate, 0) !== toDate) {
      throw new Error('Non-canonical date');
    }
  } catch {
    throwServerError({
      trpcCode: 'BAD_REQUEST',
      errorCode: 'EMPLOYEE_SHIFT_ATTENDANCE_RANGE_INVALID',
      message: 'The attendance date range is invalid.',
    });
  }
  if (toDate <= fromDate || addCalendarDays(fromDate, MAX_LIST_DAYS) < toDate) {
    throwServerError({
      trpcCode: 'BAD_REQUEST',
      errorCode: 'EMPLOYEE_SHIFT_ATTENDANCE_RANGE_INVALID',
      message: `Attendance ranges must span 1 to ${MAX_LIST_DAYS} days.`,
    });
  }
}

async function assertAttendanceFilters(
  db: DatabaseInstance,
  tenantId: string,
  actorRole: UserRole,
  input: Pick<ListEmployeeAttendanceInput, 'siteId' | 'userId'>
) {
  if (input.siteId) {
    const site = await db
      .select({ id: sites.id })
      .from(sites)
      .where(and(eq(sites.id, input.siteId), eq(sites.tenantId, tenantId)))
      .get();
    if (!site) {
      throwServerError({
        trpcCode: 'NOT_FOUND',
        errorCode: 'EMPLOYEE_SHIFT_ATTENDANCE_SITE_NOT_FOUND',
        message: 'The attendance site was not found.',
      });
    }
  }
  if (input.userId) {
    const employee = await db
      .select({ id: users.id, role: users.role })
      .from(users)
      .where(and(eq(users.id, input.userId), eq(users.tenantId, tenantId)))
      .get();
    if (!employee || !managerCanTarget(actorRole, employee.role)) {
      throwServerError({
        trpcCode: 'NOT_FOUND',
        errorCode: 'EMPLOYEE_SHIFT_ATTENDANCE_EMPLOYEE_NOT_FOUND',
        message: 'The attendance employee was not found.',
      });
    }
  }
}

function durationSeconds(start: string, end: string): number {
  return Math.max(0, Math.floor((Date.parse(end) - Date.parse(start)) / 1_000));
}

function profilesInRange(
  countryCode: string,
  fromDate: string,
  toDate: string
): OvertimePolicyProfile[] {
  const profiles = new Map<string, OvertimePolicyProfile>();
  for (let date = fromDate; date < toDate; date = addCalendarDays(date, 1)) {
    const profile = resolveOvertimePolicy(countryCode, date);
    if (profile) profiles.set(profile.id, profile);
  }
  return [...profiles.values()];
}

async function buildEmployeeAttendanceReport(
  db: DatabaseInstance,
  tenantId: string,
  actorRole: UserRole,
  input: ExportEmployeeAttendanceInput,
  pagination: { page: number; perPage: number } | null
) {
  assertAttendanceRange(input.fromDate, input.toDate);
  await assertAttendanceFilters(db, tenantId, actorRole, input);
  const locale = await resolveTenantLocale(db, tenantId);
  const generatedAt = new Date().toISOString();
  const from = zonedWallTimeToIso(input.fromDate, '00:00', locale.timezone);
  const to = zonedWallTimeToIso(input.toDate, '00:00', locale.timezone);
  const effectiveRows = await loadEffectiveAttendanceRows(db, tenantId, actorRole, {
    from,
    to,
    ...(input.siteId ? { siteId: input.siteId } : {}),
    ...(input.userId ? { userId: input.userId } : {}),
  });
  const total = effectiveRows.length;
  const rows = pagination
    ? effectiveRows.slice(
        (pagination.page - 1) * pagination.perPage,
        pagination.page * pagination.perPage
      )
    : effectiveRows;

  const visibleUserIds = [...new Set(rows.map(row => row.userId))];
  const overtimeCountry = isOvertimeCountry(locale.countryCode) ? locale.countryCode : null;
  const supportedCountry = overtimeCountry !== null;
  const calculationFromDate = laborWeekStartDate(input.fromDate, locale.firstDayOfWeek);
  const calculationToDate = addCalendarDays(
    laborWeekStartDate(addCalendarDays(input.toDate, -1), locale.firstDayOfWeek),
    7
  );
  const calculationFrom = zonedWallTimeToIso(calculationFromDate, '00:00', locale.timezone);
  const calculationTo = zonedWallTimeToIso(calculationToDate, '00:00', locale.timezone);
  const calculationRows =
    supportedCountry && visibleUserIds.length > 0
      ? await loadEffectiveAttendanceRows(db, tenantId, actorRole, {
          from: calculationFrom,
          to: calculationTo,
          userIds: visibleUserIds,
        })
      : [];

  const overtimeShifts: OvertimeShiftInput[] = calculationRows.flatMap(row => {
    const startedAt = row.clockedInAt < calculationFrom ? calculationFrom : row.clockedInAt;
    const observedEnd = row.clockedOutAt ?? generatedAt;
    const endedAt = observedEnd > calculationTo ? calculationTo : observedEnd;
    if (endedAt <= startedAt) return [];
    return [
      {
        id: row.id,
        userId: row.userId,
        startedAt,
        endedAt,
        breaks: row.breaks.map(item => ({
          startedAt: item.startedAt,
          endedAt: item.endedAt,
        })),
      },
    ];
  });
  const overtimeByShift = overtimeCountry
    ? calculateOvertime({
        countryCode: overtimeCountry,
        timeZone: locale.timezone,
        firstDayOfWeek: locale.firstDayOfWeek,
        shifts: overtimeShifts,
      })
    : new Map<string, OvertimeShiftAllocation>();
  const policyProfiles = profilesInRange(
    locale.countryCode,
    calculationFromDate,
    calculationToDate
  );
  return {
    timeZone: locale.timezone,
    generatedAt,
    overtimePolicy: {
      supported: supportedCountry,
      countryCode: locale.countryCode,
      calculationFromDate,
      calculationToDate,
      profiles: policyProfiles.map(profile => ({
        id: profile.id,
        effectiveFrom: profile.effectiveFrom === '0001-01-01' ? null : profile.effectiveFrom,
        weeklyRegularSeconds: profile.weeklyRegularSeconds,
        dailyRegularSeconds: profile.dailyRegularSeconds,
      })),
      limitations: [...new Set(policyProfiles.flatMap(profile => profile.limitations))],
      sourceUrls: [...new Set(policyProfiles.flatMap(profile => profile.sourceUrls))],
    },
    ...(pagination ? { page: pagination.page, perPage: pagination.perPage } : {}),
    total,
    rows: rows.map(row => {
      const observedEnd = row.clockedOutAt ?? generatedAt;
      const breakSeconds = row.breaks.reduce(
        (sum, breakRow) =>
          sum + durationSeconds(breakRow.startedAt, breakRow.endedAt ?? observedEnd),
        0
      );
      const elapsedSeconds = durationSeconds(row.clockedInAt, observedEnd);
      return {
        ...row,
        status: row.clockedOutAt ? ('closed' as const) : ('active' as const),
        elapsedSeconds,
        breakSeconds,
        workedSeconds: Math.max(0, elapsedSeconds - breakSeconds),
        overtime: overtimeByShift.get(row.id) ?? null,
      };
    }),
  };
}

/** ENG-140b/c/e — effective attendance evidence with country overtime classification. */
export async function listEmployeeAttendance(
  db: DatabaseInstance,
  tenantId: string,
  actorRole: UserRole,
  input: ListEmployeeAttendanceInput
) {
  return buildEmployeeAttendanceReport(db, tenantId, actorRole, input, {
    page: input.page,
    perPage: input.perPage,
  });
}

/**
 * ENG-140f — one complete, 31-day-bounded evidence snapshot for browser-side
 * CSV/XLSX construction. The server owns filtering, role visibility, timezone,
 * corrections, and overtime; the renderer only serializes these canonical rows.
 */
export async function exportEmployeeAttendance(
  db: DatabaseInstance,
  tenantId: string,
  actorRole: UserRole,
  input: ExportEmployeeAttendanceInput
) {
  return buildEmployeeAttendanceReport(db, tenantId, actorRole, input, null);
}
