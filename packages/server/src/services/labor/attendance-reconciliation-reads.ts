/** Bounded manager-safe planned-vs-actual projections; compensation is intentionally absent. */
import type { UserRole } from '@puntovivo/shared/roles';
import { and, asc, eq, gt, inArray, lt, or } from 'drizzle-orm';
import type { DatabaseInstance } from '../../db/index.js';
import { employeeShiftReconciliations, scheduledShifts, sites, users } from '../../db/schema.js';
import { throwServerError } from '../../lib/errorCodes.js';
import type {
  ListAttendanceReconciliationCandidatesInput,
  ListPlanActualInput,
} from '../../trpc/schemas/employeeShifts.js';
import { resolveTenantLocale } from '../tenant-locale.js';
import {
  loadEffectiveAttendanceRows,
  loadEffectiveAttendanceRowsByIds,
} from './attendance-evidence.js';
import {
  BROAD_QUERY_MARGIN_MS,
  managerCanTarget,
  MAX_LIST_DAYS,
  SCHEDULE_ROLES,
} from './scheduled-shift-policy.js';
import { addCalendarDays, calendarDateInTimeZone } from './timezone.js';

const CANDIDATE_LIMIT = 20;
const QUERY_CHUNK = 200;

function assertRange(fromDate: string, toDate: string): void {
  try {
    if (addCalendarDays(fromDate, 0) !== fromDate || addCalendarDays(toDate, 0) !== toDate)
      throw new Error('Non-canonical date');
  } catch {
    throwServerError({
      trpcCode: 'BAD_REQUEST',
      errorCode: 'ATTENDANCE_RECONCILIATION_RANGE_INVALID',
      message: 'The planned-vs-actual date range is invalid',
    });
  }
  if (toDate <= fromDate || addCalendarDays(fromDate, MAX_LIST_DAYS) < toDate)
    throwServerError({
      trpcCode: 'BAD_REQUEST',
      errorCode: 'ATTENDANCE_RECONCILIATION_RANGE_INVALID',
      message: `Planned-vs-actual ranges must span 1 to ${MAX_LIST_DAYS} days`,
    });
}

function durationSeconds(start: string, end: string): number {
  return Math.max(0, Math.floor((Date.parse(end) - Date.parse(start)) / 1_000));
}

function effectiveDurations(
  row: Awaited<ReturnType<typeof loadEffectiveAttendanceRowsByIds>>[number],
  generatedAt: string
) {
  const observedEnd = row.clockedOutAt ?? generatedAt;
  const breakSeconds = row.breaks.reduce(
    (sum, item) => sum + durationSeconds(item.startedAt, item.endedAt ?? observedEnd),
    0
  );
  const elapsedSeconds = durationSeconds(row.clockedInAt, observedEnd);
  return {
    observedEnd,
    elapsedSeconds,
    breakSeconds,
    workedSeconds: Math.max(0, elapsedSeconds - breakSeconds),
  };
}

const planSelection = {
  id: scheduledShifts.id,
  userId: scheduledShifts.userId,
  userName: users.name,
  userRole: users.role,
  siteId: scheduledShifts.siteId,
  siteName: sites.name,
  startsAt: scheduledShifts.startsAt,
  endsAt: scheduledShifts.endsAt,
  timeZone: scheduledShifts.timeZone,
  scheduleVersion: scheduledShifts.version,
  reconciliationId: employeeShiftReconciliations.id,
  reconciliationVersion: employeeShiftReconciliations.version,
  outcome: employeeShiftReconciliations.outcome,
  employeeShiftId: employeeShiftReconciliations.employeeShiftId,
  plannedStartsAt: employeeShiftReconciliations.plannedStartsAt,
  plannedEndsAt: employeeShiftReconciliations.plannedEndsAt,
  plannedTimeZone: employeeShiftReconciliations.plannedTimeZone,
} as const;

function visibleRoles(actorRole: UserRole) {
  return SCHEDULE_ROLES.filter(role => managerCanTarget(actorRole, role));
}

function exactLocalOverlap(
  row: {
    startsAt: string;
    endsAt: string;
    timeZone: string;
  },
  fromDate: string,
  toDate: string
) {
  const start = calendarDateInTimeZone(row.startsAt, row.timeZone);
  const inclusiveEnd = new Date(Date.parse(row.endsAt) - 1).toISOString();
  const end = calendarDateInTimeZone(inclusiveEnd, row.timeZone);
  return start < toDate && end >= fromDate;
}

/** List frozen plan outcomes with correction-aware actual evidence and keyset pagination. */
export async function listPlanActual(
  db: DatabaseInstance,
  tenantId: string,
  actorRole: UserRole,
  input: ListPlanActualInput
) {
  assertRange(input.fromDate, input.toDate);
  const locale = await resolveTenantLocale(db, tenantId);
  const lower = new Date(
    Date.parse(`${input.fromDate}T00:00:00.000Z`) - BROAD_QUERY_MARGIN_MS
  ).toISOString();
  const upper = new Date(
    Date.parse(`${input.toDate}T00:00:00.000Z`) + BROAD_QUERY_MARGIN_MS
  ).toISOString();
  const collected: Array<Awaited<ReturnType<typeof queryPlanChunk>>[number]> = [];
  let cursor = input.cursor;
  while (collected.length <= input.limit) {
    const chunk = await queryPlanChunk(db, tenantId, actorRole, input, lower, upper, cursor);
    if (chunk.length === 0) break;
    for (const row of chunk) {
      if (exactLocalOverlap(row, input.fromDate, input.toDate)) collected.push(row);
      if (collected.length > input.limit) break;
    }
    const last = chunk.at(-1)!;
    cursor = { startsAt: last.startsAt, id: last.id };
    if (chunk.length < QUERY_CHUNK) break;
    await new Promise<void>(resolve => setTimeout(resolve, 0));
  }

  const visible = collected.slice(0, input.limit);
  const actualIds = visible.flatMap(row => (row.employeeShiftId ? [row.employeeShiftId] : []));
  const actualRows = await loadEffectiveAttendanceRowsByIds(db, tenantId, actorRole, actualIds);
  const actualById = new Map(actualRows.map(row => [row.id, row]));
  const generatedAt = new Date().toISOString();
  const items = visible.map(row => {
    const plannedStartsAt = row.plannedStartsAt ?? row.startsAt;
    const plannedEndsAt = row.plannedEndsAt ?? row.endsAt;
    const plannedTimeZone = row.plannedTimeZone ?? row.timeZone;
    const actual = row.employeeShiftId ? (actualById.get(row.employeeShiftId) ?? null) : null;
    const timing = actual ? effectiveDurations(actual, generatedAt) : null;
    const state = row.reconciliationId
      ? row.outcome === 'no_show'
        ? ('no_show' as const)
        : actual?.clockedOutAt
          ? ('attended' as const)
          : ('in_progress' as const)
      : plannedEndsAt <= generatedAt
        ? ('needs_review' as const)
        : ('scheduled' as const);
    return {
      scheduledShiftId: row.id,
      scheduledShiftVersion: row.scheduleVersion,
      userId: row.userId,
      userName: row.userName,
      plannedSiteId: row.siteId,
      plannedSiteName: row.siteName,
      plannedStartsAt,
      plannedEndsAt,
      plannedTimeZone,
      plannedSeconds: durationSeconds(plannedStartsAt, plannedEndsAt),
      canConfirmNoShow: plannedEndsAt <= generatedAt,
      state,
      reconciliation: row.reconciliationId
        ? {
            id: row.reconciliationId,
            version: row.reconciliationVersion!,
            outcome: row.outcome!,
          }
        : null,
      actual:
        actual && timing
          ? {
              id: actual.id,
              siteId: actual.siteId,
              siteName: actual.siteName,
              clockedInAt: actual.clockedInAt,
              clockedOutAt: actual.clockedOutAt,
              breakSeconds: timing.breakSeconds,
              workedSeconds: timing.workedSeconds,
              correctionVersion: actual.correction?.version ?? null,
              siteMismatch: actual.siteId !== row.siteId,
              lateSeconds: Math.max(0, durationSeconds(plannedStartsAt, actual.clockedInAt)),
              earlyDepartureSeconds: actual.clockedOutAt
                ? Math.max(0, durationSeconds(actual.clockedOutAt, plannedEndsAt))
                : null,
              overrunSeconds: actual.clockedOutAt
                ? Math.max(0, durationSeconds(plannedEndsAt, actual.clockedOutAt))
                : 0,
              varianceSeconds:
                timing.workedSeconds - durationSeconds(plannedStartsAt, plannedEndsAt),
            }
          : null,
    };
  });
  const last = items.at(-1);
  return {
    timeZone: locale.timezone,
    generatedAt,
    items,
    nextCursor:
      collected.length > input.limit && last
        ? { startsAt: last.plannedStartsAt, id: last.scheduledShiftId }
        : null,
  };
}

async function queryPlanChunk(
  db: DatabaseInstance,
  tenantId: string,
  actorRole: UserRole,
  input: ListPlanActualInput,
  lower: string,
  upper: string,
  cursor: ListPlanActualInput['cursor']
) {
  return db
    .select(planSelection)
    .from(scheduledShifts)
    .innerJoin(users, and(eq(users.tenantId, tenantId), eq(users.id, scheduledShifts.userId)))
    .innerJoin(sites, and(eq(sites.tenantId, tenantId), eq(sites.id, scheduledShifts.siteId)))
    .leftJoin(
      employeeShiftReconciliations,
      and(
        eq(employeeShiftReconciliations.tenantId, tenantId),
        eq(employeeShiftReconciliations.scheduledShiftId, scheduledShifts.id)
      )
    )
    .where(
      and(
        eq(scheduledShifts.tenantId, tenantId),
        eq(scheduledShifts.status, 'scheduled'),
        inArray(users.role, visibleRoles(actorRole)),
        lt(scheduledShifts.startsAt, upper),
        gt(scheduledShifts.endsAt, lower),
        ...(input.siteId ? [eq(scheduledShifts.siteId, input.siteId)] : []),
        ...(input.userId ? [eq(scheduledShifts.userId, input.userId)] : []),
        ...(cursor
          ? [
              or(
                gt(scheduledShifts.startsAt, cursor.startsAt),
                and(
                  eq(scheduledShifts.startsAt, cursor.startsAt),
                  gt(scheduledShifts.id, cursor.id)
                )
              )!,
            ]
          : [])
      )
    )
    .orderBy(asc(scheduledShifts.startsAt), asc(scheduledShifts.id))
    .limit(QUERY_CHUNK)
    .all();
}

/** Candidate attendance is same-employee, near the frozen plan, unclaimed and bounded to 20 rows. */
export async function listAttendanceReconciliationCandidates(
  db: DatabaseInstance,
  tenantId: string,
  actorRole: UserRole,
  input: ListAttendanceReconciliationCandidatesInput
) {
  const schedule = await db
    .select({
      id: scheduledShifts.id,
      userId: scheduledShifts.userId,
      userRole: users.role,
      startsAt: scheduledShifts.startsAt,
      endsAt: scheduledShifts.endsAt,
      status: scheduledShifts.status,
      currentEmployeeShiftId: employeeShiftReconciliations.employeeShiftId,
    })
    .from(scheduledShifts)
    .innerJoin(users, and(eq(users.tenantId, tenantId), eq(users.id, scheduledShifts.userId)))
    .leftJoin(
      employeeShiftReconciliations,
      and(
        eq(employeeShiftReconciliations.tenantId, tenantId),
        eq(employeeShiftReconciliations.scheduledShiftId, scheduledShifts.id)
      )
    )
    .where(
      and(eq(scheduledShifts.tenantId, tenantId), eq(scheduledShifts.id, input.scheduledShiftId))
    )
    .get();
  if (
    !schedule ||
    schedule.status !== 'scheduled' ||
    !managerCanTarget(actorRole, schedule.userRole)
  )
    throwServerError({
      trpcCode: 'NOT_FOUND',
      errorCode: 'ATTENDANCE_RECONCILIATION_NOT_FOUND',
      message: 'The scheduled shift is not available for reconciliation',
    });

  const from = new Date(Date.parse(schedule.startsAt) - BROAD_QUERY_MARGIN_MS).toISOString();
  const to = new Date(Date.parse(schedule.endsAt) + BROAD_QUERY_MARGIN_MS).toISOString();
  const rows = await loadEffectiveAttendanceRows(db, tenantId, actorRole, {
    from,
    to,
    userId: schedule.userId,
  });
  const ids = rows.map(row => row.id);
  const claims =
    ids.length === 0
      ? []
      : await db
          .select({
            employeeShiftId: employeeShiftReconciliations.employeeShiftId,
            scheduledShiftId: employeeShiftReconciliations.scheduledShiftId,
          })
          .from(employeeShiftReconciliations)
          .where(
            and(
              eq(employeeShiftReconciliations.tenantId, tenantId),
              inArray(employeeShiftReconciliations.employeeShiftId, ids)
            )
          )
          .all();
  const claimByAttendance = new Map(claims.map(row => [row.employeeShiftId, row.scheduledShiftId]));
  const generatedAt = new Date().toISOString();
  return rows
    .filter(row => {
      const claim = claimByAttendance.get(row.id);
      return !claim || claim === schedule.id;
    })
    .slice(0, CANDIDATE_LIMIT)
    .map(row => {
      const timing = effectiveDurations(row, generatedAt);
      return {
        id: row.id,
        siteId: row.siteId,
        siteName: row.siteName,
        clockedInAt: row.clockedInAt,
        clockedOutAt: row.clockedOutAt,
        breakSeconds: timing.breakSeconds,
        workedSeconds: timing.workedSeconds,
        correctionVersion: row.correction?.version ?? null,
        currentlyLinked: row.id === schedule.currentEmployeeShiftId,
      };
    });
}
