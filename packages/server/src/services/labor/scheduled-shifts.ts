import type { UserRole } from '@puntovivo/shared/roles';
import { and, asc, eq, gt, inArray, lt, ne } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import type { DatabaseInstance } from '../../db/index.js';
import { scheduledShifts, sites, users } from '../../db/schema.js';
import { throwServerError } from '../../lib/errorCodes.js';
import { assertVersionedWriteApplied } from '../../lib/optimisticVersion.js';
import { writeAuditLog } from '../audit-logs.js';
import { resolveTenantLocale } from '../tenant-locale.js';
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

interface ScheduleActor {
  id: string;
  role: UserRole;
}

interface ScheduleCommandContext {
  db: DatabaseInstance;
  tenantId: string;
  actor: ScheduleActor;
  operationId: string;
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

async function getSchedulableEmployee(
  db: DatabaseInstance,
  tenantId: string,
  actorRole: UserRole,
  userId: string
) {
  const employee = await db
    .select({ id: users.id, name: users.name, role: users.role, isActive: users.isActive })
    .from(users)
    .where(and(eq(users.id, userId), eq(users.tenantId, tenantId), eq(users.isActive, true)))
    .get();
  if (!employee || !managerCanTarget(actorRole, employee.role)) throwEmployeeNotFound();
  return employee;
}

async function getActiveSite(db: DatabaseInstance, tenantId: string, siteId: string) {
  const site = await db
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

async function reloadSchedule(db: DatabaseInstance, tenantId: string, id: string) {
  return db
    .select(scheduleSelection)
    .from(scheduledShifts)
    .innerJoin(users, and(eq(scheduledShifts.userId, users.id), eq(users.tenantId, tenantId)))
    .innerJoin(sites, and(eq(scheduledShifts.siteId, sites.id), eq(sites.tenantId, tenantId)))
    .where(and(eq(scheduledShifts.id, id), eq(scheduledShifts.tenantId, tenantId)))
    .get();
}

async function getManageableSchedule(
  db: DatabaseInstance,
  tenantId: string,
  actorRole: UserRole,
  id: string
) {
  const row = await reloadSchedule(db, tenantId, id);
  if (!row || !managerCanTarget(actorRole, row.userRole)) throwScheduleNotFound();
  return row;
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
  const roleFilter = actorRole === 'admin' ? SCHEDULE_ROLES : (['manager', 'cashier'] as const);
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
  if (input.siteId) await getActiveSite(db, tenantId, input.siteId);

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
    .select(scheduleSelection)
    .from(scheduledShifts)
    .innerJoin(users, and(eq(scheduledShifts.userId, users.id), eq(users.tenantId, tenantId)))
    .innerJoin(sites, and(eq(scheduledShifts.siteId, sites.id), eq(sites.tenantId, tenantId)))
    .where(and(...conditions))
    .orderBy(asc(scheduledShifts.startsAt), asc(users.name), asc(scheduledShifts.id))
    .all();

  return rows.filter(row => {
    const localStart = calendarDateInTimeZone(row.startsAt, row.timeZone);
    const inclusiveEnd = new Date(Date.parse(row.endsAt) - 1).toISOString();
    const localEnd = calendarDateInTimeZone(inclusiveEnd, row.timeZone);
    return localStart < input.toDate && localEnd >= input.fromDate;
  });
}

export async function createScheduledShift(
  context: ScheduleCommandContext,
  input: CreateScheduledShiftInput
) {
  const [employee, site, locale] = await Promise.all([
    getSchedulableEmployee(context.db, context.tenantId, context.actor.role, input.userId),
    getActiveSite(context.db, context.tenantId, input.siteId),
    resolveTenantLocale(context.db, context.tenantId),
  ]);
  const window = resolveWindow(input, locale.timezone);
  const id = nanoid();
  const now = new Date().toISOString();
  const notes = normalizeNotes(input.notes);

  try {
    context.db.transaction(
      tx => {
        assertNoOverlap(tx, { tenantId: context.tenantId, userId: employee.id, ...window });
        tx.insert(scheduledShifts)
          .values({
            id,
            tenantId: context.tenantId,
            userId: employee.id,
            siteId: site.id,
            ...window,
            timeZone: locale.timezone,
            status: 'scheduled',
            notes,
            version: 1,
            createdByUserId: context.actor.id,
            updatedByUserId: context.actor.id,
            createdAt: now,
            updatedAt: now,
          })
          .run();
        writeAuditLog({
          tx,
          tenantId: context.tenantId,
          actorId: context.actor.id,
          action: 'scheduled_shift.create',
          resourceType: 'scheduled_shift',
          resourceId: id,
          before: null,
          after: {
            userId: employee.id,
            siteId: site.id,
            ...window,
            timeZone: locale.timezone,
            notes,
          },
          metadata: { employeeName: employee.name, siteName: site.name },
          operationId: context.operationId,
        });
      },
      { behavior: 'immediate' }
    );
  } catch (error) {
    if (isOverlapTrigger(error)) throwOverlap();
    throw error;
  }
  const created = await reloadSchedule(context.db, context.tenantId, id);
  if (!created) throwScheduleNotFound();
  return created;
}

export async function updateScheduledShift(
  context: ScheduleCommandContext,
  input: UpdateScheduledShiftInput
) {
  const existing = await getManageableSchedule(
    context.db,
    context.tenantId,
    context.actor.role,
    input.id
  );
  if (existing.status !== 'scheduled') {
    throwServerError({
      trpcCode: 'CONFLICT',
      errorCode: 'SCHEDULE_SHIFT_CANCELLED',
      message: 'A cancelled scheduled shift cannot be edited.',
    });
  }
  const [employee, site, locale] = await Promise.all([
    getSchedulableEmployee(context.db, context.tenantId, context.actor.role, input.userId),
    getActiveSite(context.db, context.tenantId, input.siteId),
    resolveTenantLocale(context.db, context.tenantId),
  ]);
  const window = resolveWindow(input, locale.timezone);
  const notes = normalizeNotes(input.notes);
  const now = new Date().toISOString();

  try {
    context.db.transaction(
      tx => {
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
            timeZone: locale.timezone,
            notes,
            version: input.version + 1,
            updatedByUserId: context.actor.id,
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
          actorId: context.actor.id,
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
            timeZone: locale.timezone,
            notes,
            version: input.version + 1,
          },
          metadata: { employeeName: employee.name, siteName: site.name },
          operationId: context.operationId,
        });
      },
      { behavior: 'immediate' }
    );
  } catch (error) {
    if (isOverlapTrigger(error)) throwOverlap();
    throw error;
  }
  const updated = await reloadSchedule(context.db, context.tenantId, existing.id);
  if (!updated) throwScheduleNotFound();
  return updated;
}

export async function cancelScheduledShift(
  context: ScheduleCommandContext,
  input: CancelScheduledShiftInput
) {
  const existing = await getManageableSchedule(
    context.db,
    context.tenantId,
    context.actor.role,
    input.id
  );
  if (existing.status === 'cancelled') return existing;
  const now = new Date().toISOString();

  context.db.transaction(
    tx => {
      const result = tx
        .update(scheduledShifts)
        .set({
          status: 'cancelled',
          cancelledAt: now,
          cancelledByUserId: context.actor.id,
          version: input.version + 1,
          updatedByUserId: context.actor.id,
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
        actorId: context.actor.id,
        action: 'scheduled_shift.cancel',
        resourceType: 'scheduled_shift',
        resourceId: existing.id,
        before: { status: existing.status, version: existing.version },
        after: { status: 'cancelled', cancelledAt: now, version: input.version + 1 },
        metadata: { employeeName: existing.userName, siteName: existing.siteName },
        operationId: context.operationId,
      });
    },
    { behavior: 'immediate' }
  );
  const cancelled = await reloadSchedule(context.db, context.tenantId, existing.id);
  if (!cancelled) throwScheduleNotFound();
  return cancelled;
}
