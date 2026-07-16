import type { UserRole } from '@puntovivo/shared/roles';
import { and, asc, count, eq, gt, inArray, isNull, lt, or } from 'drizzle-orm';
import type { DatabaseInstance } from '../../db/index.js';
import { employeeShiftBreaks, employeeShifts, sites, users } from '../../db/schema.js';
import { throwServerError } from '../../lib/errorCodes.js';
import type { ListEmployeeAttendanceInput } from '../../trpc/schemas/employeeShifts.js';
import { resolveTenantLocale } from '../tenant-locale.js';
import { managerCanTarget, MAX_LIST_DAYS, SCHEDULE_ROLES } from './scheduled-shift-policy.js';
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

const attendanceSelection = {
  id: employeeShifts.id,
  userId: employeeShifts.userId,
  userName: users.name,
  userRole: users.role,
  siteId: employeeShifts.siteId,
  siteName: sites.name,
  clockedInAt: employeeShifts.clockedInAt,
  clockedOutAt: employeeShifts.clockedOutAt,
} as const;

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

/** ENG-140b — manager/admin view of actual shifts and explicit break evidence. */
export async function listEmployeeAttendance(
  db: DatabaseInstance,
  tenantId: string,
  actorRole: UserRole,
  input: ListEmployeeAttendanceInput
) {
  assertAttendanceRange(input.fromDate, input.toDate);
  await assertAttendanceFilters(db, tenantId, actorRole, input);
  const locale = await resolveTenantLocale(db, tenantId);
  const generatedAt = new Date().toISOString();
  const from = zonedWallTimeToIso(input.fromDate, '00:00', locale.timezone);
  const to = zonedWallTimeToIso(input.toDate, '00:00', locale.timezone);
  const conditions = [
    eq(employeeShifts.tenantId, tenantId),
    lt(employeeShifts.clockedInAt, to),
    or(isNull(employeeShifts.clockedOutAt), gt(employeeShifts.clockedOutAt, from))!,
  ];
  if (input.siteId) conditions.push(eq(employeeShifts.siteId, input.siteId));
  if (input.userId) conditions.push(eq(employeeShifts.userId, input.userId));
  conditions.push(
    inArray(users.role, actorRole === 'admin' ? [...SCHEDULE_ROLES] : ['manager', 'cashier'])
  );

  const totalRow = await db
    .select({ total: count() })
    .from(employeeShifts)
    .innerJoin(users, and(eq(employeeShifts.userId, users.id), eq(users.tenantId, tenantId)))
    // Keep the count query on the exact same tenant-safe join set as the
    // paginated row query. Legacy/corrupt rows with a foreign-tenant site
    // must not inflate totals while being excluded from the visible page.
    .innerJoin(sites, and(eq(employeeShifts.siteId, sites.id), eq(sites.tenantId, tenantId)))
    .where(and(...conditions))
    .get();
  const total = totalRow?.total ?? 0;
  const rows = await db
    .select(attendanceSelection)
    .from(employeeShifts)
    .innerJoin(users, and(eq(employeeShifts.userId, users.id), eq(users.tenantId, tenantId)))
    .innerJoin(sites, and(eq(employeeShifts.siteId, sites.id), eq(sites.tenantId, tenantId)))
    .where(and(...conditions))
    .orderBy(asc(employeeShifts.clockedInAt), asc(users.name), asc(employeeShifts.id))
    .limit(input.perPage)
    .offset((input.page - 1) * input.perPage)
    .all();

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
      ? await db
          .select({
            id: employeeShifts.id,
            userId: employeeShifts.userId,
            clockedInAt: employeeShifts.clockedInAt,
            clockedOutAt: employeeShifts.clockedOutAt,
          })
          .from(employeeShifts)
          .innerJoin(users, and(eq(employeeShifts.userId, users.id), eq(users.tenantId, tenantId)))
          .innerJoin(sites, and(eq(employeeShifts.siteId, sites.id), eq(sites.tenantId, tenantId)))
          .where(
            and(
              eq(employeeShifts.tenantId, tenantId),
              inArray(employeeShifts.userId, visibleUserIds),
              lt(employeeShifts.clockedInAt, calculationTo),
              or(
                isNull(employeeShifts.clockedOutAt),
                gt(employeeShifts.clockedOutAt, calculationFrom)
              )
            )
          )
          .orderBy(asc(employeeShifts.clockedInAt), asc(employeeShifts.id))
          .all()
      : [];
  const shiftIds = [
    ...new Set([...rows.map(row => row.id), ...calculationRows.map(row => row.id)]),
  ];
  const breakRows =
    shiftIds.length === 0
      ? []
      : await db
          .select({
            id: employeeShiftBreaks.id,
            employeeShiftId: employeeShiftBreaks.employeeShiftId,
            startedAt: employeeShiftBreaks.startedAt,
            endedAt: employeeShiftBreaks.endedAt,
          })
          .from(employeeShiftBreaks)
          .where(
            and(
              eq(employeeShiftBreaks.tenantId, tenantId),
              inArray(employeeShiftBreaks.employeeShiftId, shiftIds)
            )
          )
          .orderBy(asc(employeeShiftBreaks.startedAt), asc(employeeShiftBreaks.id))
          .all();
  const breaksByShift = new Map<string, typeof breakRows>();
  for (const breakRow of breakRows) {
    const grouped = breaksByShift.get(breakRow.employeeShiftId) ?? [];
    grouped.push(breakRow);
    breaksByShift.set(breakRow.employeeShiftId, grouped);
  }

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
        breaks: (breaksByShift.get(row.id) ?? []).map(item => ({
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
    page: input.page,
    perPage: input.perPage,
    total,
    rows: rows.map(row => {
      const observedEnd = row.clockedOutAt ?? generatedAt;
      const breaks = breaksByShift.get(row.id) ?? [];
      const breakSeconds = breaks.reduce(
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
        breaks,
      };
    }),
  };
}
