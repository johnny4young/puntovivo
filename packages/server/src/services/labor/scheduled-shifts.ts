import { MANAGER_OR_ADMIN_ROLES, type UserRole } from '@puntovivo/shared/roles';
import { and, asc, eq, gt, inArray, lt, ne } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import type { DatabaseInstance } from '../../db/index.js';
import {
  employeeShiftReconciliations,
  scheduledShifts,
  sites,
  tenants,
  users,
} from '../../db/schema.js';
import { throwServerError } from '../../lib/errorCodes.js';
import { assertVersionedWriteApplied } from '../../lib/optimisticVersion.js';
import { writeAuditLog } from '../audit-logs.js';
import { resolveTenantLocale } from '../tenant-locale.js';
import type { CriticalCommandContext } from '../../trpc/middleware/commandEnvelope.js';
import {
  resolveTenantBusinessClock,
  assertTenantBusinessClockCurrent,
} from '../pharmacy/business-clock.js';
import { enqueueSyncInTransaction } from '../sync/enqueue.js';
import type {
  CancelScheduledShiftInput,
  CreateScheduledShiftInput,
  ListScheduledShiftsInput,
  UpdateScheduledShiftInput,
} from '../../trpc/schemas/employeeShifts.js';
import {
  BROAD_QUERY_MARGIN_MS,
  managerCanTarget,
  MAX_LIST_DAYS,
  MAX_SHIFT_DURATION_MS,
  SCHEDULE_ROLES,
  throwEmployeeNotFound,
  throwOverlap,
  throwScheduleNotFound,
} from './scheduled-shift-policy.js';
import { addCalendarDays, calendarDateInTimeZone, zonedWallTimeToIso } from './timezone.js';
import { assertNoApprovedTimeOff } from './time-off-conflicts.js';
import { assertShiftAvailability } from './availability-conflicts.js';

/** Writer capability: the command result is completed inside the same SQLite transaction. */
export type ScheduleCommandContext = Pick<
  CriticalCommandContext,
  'db' | 'tenantId' | 'user' | 'envelope' | 'completeInTransaction' | 'deviceId'
>;

/** No await may occur after reserving the writer: authority, mutation and completion share one snapshot. */
async function withScheduleTransaction<T>(
  context: ScheduleCommandContext,
  action: (tx: DatabaseInstance, timeZone: string) => T
): Promise<T> {
  const clock = await resolveTenantBusinessClock(context.db, context.tenantId);
  return context.db.transaction(
    raw => {
      const tx = raw as unknown as DatabaseInstance;
      const actor = tx
        .select({ role: users.role })
        .from(users)
        .where(
          and(
            eq(users.tenantId, context.tenantId),
            eq(users.id, context.user.id),
            eq(users.isActive, true)
          )
        )
        .get();
      const tenant = tx
        .select({ id: tenants.id })
        .from(tenants)
        .where(and(eq(tenants.id, context.tenantId), eq(tenants.isActive, true)))
        .get();
      if (
        !tenant ||
        !actor ||
        actor.role !== context.user.role ||
        !MANAGER_OR_ADMIN_ROLES.some(role => role === actor.role)
      ) {
        throwServerError({
          trpcCode: 'FORBIDDEN',
          errorCode: 'AUTH_IDENTITY_CHANGED',
          message: 'Scheduling authority changed; sign in again',
        });
      }
      assertTenantBusinessClockCurrent(tx, context.tenantId, clock);
      return action(tx, clock.timezone);
    },
    { behavior: 'immediate' }
  );
}

const scheduleSelection = {
  id: scheduledShifts.id,
  tenantId: scheduledShifts.tenantId,
  userId: scheduledShifts.userId,
  userName: users.name,
  userRole: users.role,
  siteId: scheduledShifts.siteId,
  siteName: sites.name,
  startsAt: scheduledShifts.startsAt,
  endsAt: scheduledShifts.endsAt,
  timeZone: scheduledShifts.timeZone,
  status: scheduledShifts.status,
  notes: scheduledShifts.notes,
  version: scheduledShifts.version,
  createdByUserId: scheduledShifts.createdByUserId,
  updatedByUserId: scheduledShifts.updatedByUserId,
  cancelledAt: scheduledShifts.cancelledAt,
  cancelledByUserId: scheduledShifts.cancelledByUserId,
  createdAt: scheduledShifts.createdAt,
  updatedAt: scheduledShifts.updatedAt,
} as const;

const scheduleListSelection = {
  ...scheduleSelection,
  reconciliationId: employeeShiftReconciliations.id,
} as const;

function normalizeNotes(notes: string | null | undefined): string | null {
  const value = notes?.trim() ?? '';
  return value.length > 0 ? value : null;
}

function assertCalendarRange(fromDate: string, toDate: string): void {
  try {
    if (addCalendarDays(fromDate, 0) !== fromDate || addCalendarDays(toDate, 0) !== toDate) {
      throw new Error('Non-canonical date');
    }
  } catch {
    throwServerError({
      trpcCode: 'BAD_REQUEST',
      errorCode: 'SCHEDULE_DATE_RANGE_INVALID',
      message: 'The schedule date range is invalid.',
    });
  }
  if (toDate <= fromDate || addCalendarDays(fromDate, MAX_LIST_DAYS) < toDate) {
    throwServerError({
      trpcCode: 'BAD_REQUEST',
      errorCode: 'SCHEDULE_DATE_RANGE_INVALID',
      message: `Schedule ranges must span 1 to ${MAX_LIST_DAYS} days.`,
    });
  }
}

function resolveWindow(
  input: Pick<CreateScheduledShiftInput, 'startDate' | 'startTime' | 'endDate' | 'endTime'>,
  timeZone: string
): { startsAt: string; endsAt: string } {
  try {
    const startsAt = zonedWallTimeToIso(input.startDate, input.startTime, timeZone);
    const endsAt = zonedWallTimeToIso(input.endDate, input.endTime, timeZone);
    const duration = Date.parse(endsAt) - Date.parse(startsAt);
    if (duration <= 0 || duration > MAX_SHIFT_DURATION_MS) throw new Error('Invalid duration');
    return { startsAt, endsAt };
  } catch {
    throwServerError({
      trpcCode: 'BAD_REQUEST',
      errorCode: 'SCHEDULE_WINDOW_INVALID',
      message: 'The scheduled shift must be a valid local-time interval of at most 24 hours.',
    });
  }
}

function getSchedulableEmployee(
  db: DatabaseInstance,
  tenantId: string,
  actorRole: UserRole,
  userId: string
) {
  const employee = db
    .select({ id: users.id, name: users.name, role: users.role, isActive: users.isActive })
    .from(users)
    .where(and(eq(users.id, userId), eq(users.tenantId, tenantId), eq(users.isActive, true)))
    .get();
  if (!employee || !managerCanTarget(actorRole, employee.role)) throwEmployeeNotFound();
  return employee;
}

function getActiveSite(db: DatabaseInstance, tenantId: string, siteId: string) {
  const site = db
    .select({ id: sites.id, name: sites.name })
    .from(sites)
    .where(and(eq(sites.id, siteId), eq(sites.tenantId, tenantId), eq(sites.isActive, true)))
    .get();
  if (!site) {
    throwServerError({
      trpcCode: 'NOT_FOUND',
      errorCode: 'SCHEDULE_SITE_NOT_FOUND',
      message: 'The active schedule site was not found.',
    });
  }
  return site;
}

function assertNoOverlap(
  db: DatabaseInstance,
  args: {
    tenantId: string;
    userId: string;
    startsAt: string;
    endsAt: string;
    excludeId?: string;
  }
): void {
  assertNoApprovedTimeOff(db, args);
  assertShiftAvailability(db, args);
  const conditions = [
    eq(scheduledShifts.tenantId, args.tenantId),
    eq(scheduledShifts.userId, args.userId),
    eq(scheduledShifts.status, 'scheduled'),
    lt(scheduledShifts.startsAt, args.endsAt),
    gt(scheduledShifts.endsAt, args.startsAt),
  ];
  if (args.excludeId) conditions.push(ne(scheduledShifts.id, args.excludeId));
  const conflict = db
    .select({ id: scheduledShifts.id })
    .from(scheduledShifts)
    .where(and(...conditions))
    .get();
  if (conflict) throwOverlap(conflict.id);
}

function reloadSchedule(db: DatabaseInstance, tenantId: string, id: string) {
  return db
    .select(scheduleSelection)
    .from(scheduledShifts)
    .innerJoin(users, and(eq(scheduledShifts.userId, users.id), eq(users.tenantId, tenantId)))
    .innerJoin(sites, and(eq(scheduledShifts.siteId, sites.id), eq(sites.tenantId, tenantId)))
    .where(and(eq(scheduledShifts.id, id), eq(scheduledShifts.tenantId, tenantId)))
    .get();
}

function getManageableSchedule(
  db: DatabaseInstance,
  tenantId: string,
  actorRole: UserRole,
  id: string
) {
  const row = reloadSchedule(db, tenantId, id);
  if (!row || !managerCanTarget(actorRole, row.userRole)) throwScheduleNotFound();
  return row;
}

function assertScheduleNotReconciled(
  db: DatabaseInstance,
  tenantId: string,
  scheduledShiftId: string
): void {
  const frozen = db
    .select({ id: employeeShiftReconciliations.id })
    .from(employeeShiftReconciliations)
    .where(
      and(
        eq(employeeShiftReconciliations.tenantId, tenantId),
        eq(employeeShiftReconciliations.scheduledShiftId, scheduledShiftId)
      )
    )
    .get();
  if (frozen)
    throwServerError({
      trpcCode: 'CONFLICT',
      errorCode: 'SCHEDULE_SHIFT_RECONCILED',
      message: 'A reconciled scheduled shift is frozen as historical labor evidence',
    });
}

function isOverlapTrigger(error: unknown): boolean {
  return error instanceof Error && /SCHEDULE_SHIFT_OVERLAP/i.test(error.message);
}

export async function getScheduleContext(
  db: DatabaseInstance,
  tenantId: string,
  actorRole: UserRole
) {
  const locale = await resolveTenantLocale(db, tenantId);
  const roleFilter = SCHEDULE_ROLES.filter(role => managerCanTarget(actorRole, role));
  const [employees, activeSites] = await Promise.all([
    db
      .select({ id: users.id, name: users.name, role: users.role })
      .from(users)
      .where(
        and(eq(users.tenantId, tenantId), eq(users.isActive, true), inArray(users.role, roleFilter))
      )
      .orderBy(asc(users.name), asc(users.id))
      .all(),
    db
      .select({ id: sites.id, name: sites.name })
      .from(sites)
      .where(and(eq(sites.tenantId, tenantId), eq(sites.isActive, true)))
      .orderBy(asc(sites.name), asc(sites.id))
      .all(),
  ]);
  return {
    employees,
    sites: activeSites,
    locale: locale.locale,
    timeZone: locale.timezone,
    firstDayOfWeek: locale.firstDayOfWeek,
  };
}

export async function listScheduledShifts(
  db: DatabaseInstance,
  tenantId: string,
  actorRole: UserRole,
  input: ListScheduledShiftsInput
) {
  assertCalendarRange(input.fromDate, input.toDate);
  if (input.siteId) getActiveSite(db, tenantId, input.siteId);

  const lower = new Date(
    Date.parse(`${input.fromDate}T00:00:00.000Z`) - BROAD_QUERY_MARGIN_MS
  ).toISOString();
  const upper = new Date(
    Date.parse(`${input.toDate}T00:00:00.000Z`) + BROAD_QUERY_MARGIN_MS
  ).toISOString();
  const conditions = [
    eq(scheduledShifts.tenantId, tenantId),
    lt(scheduledShifts.startsAt, upper),
    gt(scheduledShifts.endsAt, lower),
  ];
  if (!input.includeCancelled) conditions.push(eq(scheduledShifts.status, 'scheduled'));
  if (input.siteId) conditions.push(eq(scheduledShifts.siteId, input.siteId));
  if (actorRole === 'manager') conditions.push(ne(users.role, 'admin'));

  const rows = await db
    .select(scheduleListSelection)
    .from(scheduledShifts)
    .innerJoin(users, and(eq(scheduledShifts.userId, users.id), eq(users.tenantId, tenantId)))
    .innerJoin(sites, and(eq(scheduledShifts.siteId, sites.id), eq(sites.tenantId, tenantId)))
    .leftJoin(
      employeeShiftReconciliations,
      and(
        eq(employeeShiftReconciliations.tenantId, tenantId),
        eq(employeeShiftReconciliations.scheduledShiftId, scheduledShifts.id)
      )
    )
    .where(and(...conditions))
    .orderBy(asc(scheduledShifts.startsAt), asc(users.name), asc(scheduledShifts.id))
    .all();

  return rows
    .filter(row => {
      const localStart = calendarDateInTimeZone(row.startsAt, row.timeZone);
      const inclusiveEnd = new Date(Date.parse(row.endsAt) - 1).toISOString();
      const localEnd = calendarDateInTimeZone(inclusiveEnd, row.timeZone);
      return localStart < input.toDate && localEnd >= input.fromDate;
    })
    .map(({ reconciliationId, ...row }) => ({
      ...row,
      isReconciled: reconciliationId !== null,
    }));
}

/** Preserve the existing response contract, but freeze it before releasing the writer. */
function finishSchedule(
  context: ScheduleCommandContext,
  tx: DatabaseInstance,
  id: string,
  operation?: 'create' | 'update'
) {
  const row = reloadSchedule(tx, context.tenantId, id);
  if (!row) throwScheduleNotFound();
  if (operation)
    enqueueSyncInTransaction(
      {
        db: tx,
        tenantId: context.tenantId,
        deviceId: context.deviceId,
        envelope: context.envelope,
      },
      {
        entityType: 'scheduled_shifts',
        entityId: row.id,
        operation,
        data: { id: row.id, siteId: row.siteId, version: row.version, status: row.status },
      }
    );
  context.completeInTransaction(tx, row);
  return row;
}

export async function createScheduledShift(
  context: ScheduleCommandContext,
  input: CreateScheduledShiftInput
) {
  try {
    return await withScheduleTransaction(context, (tx, timeZone) => {
      const employee = getSchedulableEmployee(
        tx,
        context.tenantId,
        context.user.role,
        input.userId
      );
      const site = getActiveSite(tx, context.tenantId, input.siteId);
      const window = resolveWindow(input, timeZone);
      const id = nanoid(),
        now = new Date().toISOString(),
        notes = normalizeNotes(input.notes);
      assertNoOverlap(tx, { tenantId: context.tenantId, userId: employee.id, ...window });
      tx.insert(scheduledShifts)
        .values({
          id,
          tenantId: context.tenantId,
          userId: employee.id,
          siteId: site.id,
          ...window,
          timeZone,
          status: 'scheduled',
          notes,
          version: 1,
          createdByUserId: context.user.id,
          updatedByUserId: context.user.id,
          createdAt: now,
          updatedAt: now,
        })
        .run();
      writeAuditLog({
        tx,
        tenantId: context.tenantId,
        actorId: context.user.id,
        action: 'scheduled_shift.create',
        resourceType: 'scheduled_shift',
        resourceId: id,
        before: null,
        after: { userId: employee.id, siteId: site.id, ...window, timeZone, notes },
        metadata: { employeeName: employee.name, siteName: site.name },
        operationId: context.envelope.operationId,
      });
      return finishSchedule(context, tx, id, 'create');
    });
  } catch (error) {
    if (isOverlapTrigger(error)) throwOverlap();
    throw error;
  }
}

export async function updateScheduledShift(
  context: ScheduleCommandContext,
  input: UpdateScheduledShiftInput
) {
  try {
    return await withScheduleTransaction(context, (tx, timeZone) => {
      const existing = getManageableSchedule(tx, context.tenantId, context.user.role, input.id);
      assertScheduleNotReconciled(tx, context.tenantId, existing.id);
      assertVersionedWriteApplied(
        'scheduledShift',
        existing.version === input.version ? 1 : 0,
        input.version
      );
      if (existing.status !== 'scheduled')
        throwServerError({
          trpcCode: 'CONFLICT',
          errorCode: 'SCHEDULE_SHIFT_CANCELLED',
          message: 'A cancelled scheduled shift cannot be edited.',
        });
      const employee = getSchedulableEmployee(
        tx,
        context.tenantId,
        context.user.role,
        input.userId
      );
      const site = getActiveSite(tx, context.tenantId, input.siteId);
      const window = resolveWindow(input, timeZone),
        notes = normalizeNotes(input.notes);
      assertNoOverlap(tx, {
        tenantId: context.tenantId,
        userId: employee.id,
        ...window,
        excludeId: existing.id,
      });
      const result = tx
        .update(scheduledShifts)
        .set({
          userId: employee.id,
          siteId: site.id,
          ...window,
          timeZone,
          notes,
          version: input.version + 1,
          updatedByUserId: context.user.id,
          updatedAt: new Date().toISOString(),
        })
        .where(
          and(
            eq(scheduledShifts.id, existing.id),
            eq(scheduledShifts.tenantId, context.tenantId),
            eq(scheduledShifts.status, 'scheduled'),
            eq(scheduledShifts.version, input.version)
          )
        )
        .run();
      assertVersionedWriteApplied('scheduledShift', result.changes, input.version);
      writeAuditLog({
        tx,
        tenantId: context.tenantId,
        actorId: context.user.id,
        action: 'scheduled_shift.update',
        resourceType: 'scheduled_shift',
        resourceId: existing.id,
        before: {
          userId: existing.userId,
          siteId: existing.siteId,
          startsAt: existing.startsAt,
          endsAt: existing.endsAt,
          timeZone: existing.timeZone,
          notes: existing.notes,
          version: existing.version,
        },
        after: {
          userId: employee.id,
          siteId: site.id,
          ...window,
          timeZone,
          notes,
          version: input.version + 1,
        },
        metadata: { employeeName: employee.name, siteName: site.name },
        operationId: context.envelope.operationId,
      });
      return finishSchedule(context, tx, existing.id, 'update');
    });
  } catch (error) {
    if (isOverlapTrigger(error)) throwOverlap();
    throw error;
  }
}

export async function cancelScheduledShift(
  context: ScheduleCommandContext,
  input: CancelScheduledShiftInput
) {
  return withScheduleTransaction(context, tx => {
    // Cancelling historical assignments remains possible after an employee/site is archived.
    // Manager targeting still uses the employee's current role, including on no-op requests.
    const existing = getManageableSchedule(tx, context.tenantId, context.user.role, input.id);
    assertScheduleNotReconciled(tx, context.tenantId, existing.id);
    assertVersionedWriteApplied(
      'scheduledShift',
      existing.version === input.version ? 1 : 0,
      input.version
    );
    if (existing.status === 'cancelled') return finishSchedule(context, tx, existing.id);
    const now = new Date().toISOString();
    const result = tx
      .update(scheduledShifts)
      .set({
        status: 'cancelled',
        cancelledAt: now,
        cancelledByUserId: context.user.id,
        version: input.version + 1,
        updatedByUserId: context.user.id,
        updatedAt: now,
      })
      .where(
        and(
          eq(scheduledShifts.id, existing.id),
          eq(scheduledShifts.tenantId, context.tenantId),
          eq(scheduledShifts.status, 'scheduled'),
          eq(scheduledShifts.version, input.version)
        )
      )
      .run();
    assertVersionedWriteApplied('scheduledShift', result.changes, input.version);
    writeAuditLog({
      tx,
      tenantId: context.tenantId,
      actorId: context.user.id,
      action: 'scheduled_shift.cancel',
      resourceType: 'scheduled_shift',
      resourceId: existing.id,
      before: { status: existing.status, version: existing.version },
      after: { status: 'cancelled', cancelledAt: now, version: input.version + 1 },
      metadata: { employeeName: existing.userName, siteName: existing.siteName },
      operationId: context.envelope.operationId,
    });
    return finishSchedule(context, tx, existing.id, 'update');
  });
}
