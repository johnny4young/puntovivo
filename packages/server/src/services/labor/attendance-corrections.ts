import type { UserRole } from '@puntovivo/shared/roles';
import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import type { DatabaseInstance } from '../../db/index.js';
import {
  employeeShiftBreaks,
  employeeShiftCorrections,
  employeeShifts,
  sites,
  users,
  type EmployeeShiftCorrectionBreak,
} from '../../db/schema.js';
import { throwServerError } from '../../lib/errorCodes.js';
import type {
  CreateEmployeeAttendanceCorrectionInput,
  ListEmployeeAttendanceCorrectionsInput,
} from '../../trpc/schemas/employeeShifts.js';
import { writeAuditLog } from '../audit-logs.js';
import { resolveTenantLocale } from '../tenant-locale.js';
import { managerCanTarget, MAX_SHIFT_DURATION_MS } from './scheduled-shift-policy.js';
import { zonedWallTimeToIso } from './timezone.js';

interface CorrectionActor {
  id: string;
  role: UserRole;
}

interface CorrectionCommandContext {
  db: DatabaseInstance;
  tenantId: string;
  actor: CorrectionActor;
  operationId: string;
}

const shiftSelection = {
  id: employeeShifts.id,
  userId: employeeShifts.userId,
  userName: users.name,
  userRole: users.role,
  siteId: employeeShifts.siteId,
  siteName: sites.name,
  clockedInAt: employeeShifts.clockedInAt,
  clockedOutAt: employeeShifts.clockedOutAt,
} as const;

function throwCorrectionNotFound(): never {
  throwServerError({
    trpcCode: 'NOT_FOUND',
    errorCode: 'EMPLOYEE_SHIFT_CORRECTION_NOT_FOUND',
    message: 'The attendance shift is not available for correction.',
  });
}

function getManageableShift(
  db: DatabaseInstance,
  tenantId: string,
  actorRole: UserRole,
  shiftId: string
) {
  const row = db
    .select(shiftSelection)
    .from(employeeShifts)
    .innerJoin(users, and(eq(employeeShifts.userId, users.id), eq(users.tenantId, tenantId)))
    .innerJoin(sites, and(eq(employeeShifts.siteId, sites.id), eq(sites.tenantId, tenantId)))
    .where(and(eq(employeeShifts.id, shiftId), eq(employeeShifts.tenantId, tenantId)))
    .get();
  if (!row || !managerCanTarget(actorRole, row.userRole)) throwCorrectionNotFound();
  return row;
}

function latestCorrection(db: DatabaseInstance, tenantId: string, shiftId: string) {
  return db
    .select({
      id: employeeShiftCorrections.id,
      version: employeeShiftCorrections.version,
      clockedInAt: employeeShiftCorrections.clockedInAt,
      clockedOutAt: employeeShiftCorrections.clockedOutAt,
      breaks: employeeShiftCorrections.breaks,
      reason: employeeShiftCorrections.reason,
      createdByUserId: employeeShiftCorrections.createdByUserId,
      createdAt: employeeShiftCorrections.createdAt,
    })
    .from(employeeShiftCorrections)
    .where(
      and(
        eq(employeeShiftCorrections.tenantId, tenantId),
        eq(employeeShiftCorrections.employeeShiftId, shiftId)
      )
    )
    .orderBy(desc(employeeShiftCorrections.version))
    .get();
}

function rawBreaks(db: DatabaseInstance, tenantId: string, shiftId: string) {
  return db
    .select({
      id: employeeShiftBreaks.id,
      startedAt: employeeShiftBreaks.startedAt,
      endedAt: employeeShiftBreaks.endedAt,
    })
    .from(employeeShiftBreaks)
    .where(
      and(
        eq(employeeShiftBreaks.tenantId, tenantId),
        eq(employeeShiftBreaks.employeeShiftId, shiftId)
      )
    )
    .orderBy(asc(employeeShiftBreaks.startedAt), asc(employeeShiftBreaks.id))
    .all();
}

function throwStaleCorrection(suppliedVersion: number): never {
  throwServerError({
    trpcCode: 'CONFLICT',
    errorCode: 'STALE_VERSION',
    message: `Stale attendance correction version: expected ${suppliedVersion}.`,
    details: { entity: 'employeeShiftCorrection', suppliedVersion },
  });
}

function resolveWindow(
  input: Pick<
    CreateEmployeeAttendanceCorrectionInput,
    'startDate' | 'startTime' | 'endDate' | 'endTime'
  >,
  timeZone: string
) {
  try {
    const clockedInAt = zonedWallTimeToIso(input.startDate, input.startTime, timeZone);
    const clockedOutAt = zonedWallTimeToIso(input.endDate, input.endTime, timeZone);
    const duration = Date.parse(clockedOutAt) - Date.parse(clockedInAt);
    if (duration <= 0 || duration > MAX_SHIFT_DURATION_MS) throw new Error('Invalid duration');
    return { clockedInAt, clockedOutAt };
  } catch {
    throwServerError({
      trpcCode: 'BAD_REQUEST',
      errorCode: 'EMPLOYEE_SHIFT_CORRECTION_WINDOW_INVALID',
      message: 'The corrected shift must be a valid local-time interval of at most 24 hours.',
    });
  }
}

function resolveBreaks(
  input: CreateEmployeeAttendanceCorrectionInput,
  timeZone: string,
  window: { clockedInAt: string; clockedOutAt: string },
  allowedIds: Set<string>
): EmployeeShiftCorrectionBreak[] {
  try {
    const breaks = input.breaks.map(item => {
      const startedAt = zonedWallTimeToIso(item.startDate, item.startTime, timeZone);
      const endedAt = zonedWallTimeToIso(item.endDate, item.endTime, timeZone);
      if (startedAt < window.clockedInAt || endedAt > window.clockedOutAt || endedAt <= startedAt) {
        throw new Error('Break outside shift');
      }
      return {
        id: item.id && allowedIds.has(item.id) ? item.id : nanoid(),
        startedAt,
        endedAt,
      };
    });
    breaks.sort(
      (left, right) =>
        left.startedAt.localeCompare(right.startedAt) || left.id.localeCompare(right.id)
    );
    if (new Set(breaks.map(item => item.id)).size !== breaks.length) {
      throw new Error('Duplicate break id');
    }
    for (let index = 1; index < breaks.length; index += 1) {
      if (breaks[index]!.startedAt < breaks[index - 1]!.endedAt) {
        throw new Error('Overlapping breaks');
      }
    }
    return breaks;
  } catch {
    throwServerError({
      trpcCode: 'BAD_REQUEST',
      errorCode: 'EMPLOYEE_SHIFT_CORRECTION_BREAKS_INVALID',
      message: 'Corrected breaks must be valid, non-overlapping intervals inside the shift.',
    });
  }
}

function isVersionConstraint(error: unknown): boolean {
  return (
    error instanceof Error &&
    /idx_employee_shift_corrections_tenant_shift_version|EMPLOYEE_SHIFT_CORRECTION_VERSION/i.test(
      error.message
    )
  );
}

export async function createEmployeeAttendanceCorrection(
  context: CorrectionCommandContext,
  input: CreateEmployeeAttendanceCorrectionInput
) {
  const locale = await resolveTenantLocale(context.db, context.tenantId);
  const window = resolveWindow(input, locale.timezone);
  const reason = input.reason.trim();
  const correctionId = nanoid();
  let createdVersion = 0;

  try {
    context.db.transaction(
      tx => {
        const shift = getManageableShift(
          tx,
          context.tenantId,
          context.actor.role,
          input.employeeShiftId
        );
        if (!shift.clockedOutAt) {
          throwServerError({
            trpcCode: 'CONFLICT',
            errorCode: 'EMPLOYEE_SHIFT_CORRECTION_ACTIVE',
            message: 'An active attendance shift cannot be corrected.',
          });
        }
        const current = latestCorrection(tx, context.tenantId, shift.id);
        const currentVersion = current?.version ?? 0;
        if (currentVersion !== input.expectedVersion) throwStaleCorrection(input.expectedVersion);
        const originalBreakRows = rawBreaks(tx, context.tenantId, shift.id);
        const currentBreaks =
          current?.breaks ??
          originalBreakRows.flatMap(item =>
            item.endedAt ? [{ id: item.id, startedAt: item.startedAt, endedAt: item.endedAt }] : []
          );
        const breaks = resolveBreaks(
          input,
          locale.timezone,
          window,
          new Set(currentBreaks.map(item => item.id))
        );
        createdVersion = currentVersion + 1;
        const createdAt = new Date().toISOString();

        tx.insert(employeeShiftCorrections)
          .values({
            id: correctionId,
            tenantId: context.tenantId,
            employeeShiftId: shift.id,
            version: createdVersion,
            ...window,
            breaks,
            reason,
            createdByUserId: context.actor.id,
            createdAt,
          })
          .run();
        writeAuditLog({
          tx,
          tenantId: context.tenantId,
          actorId: context.actor.id,
          action: 'employee_shift.correct',
          resourceType: 'employee_shift',
          resourceId: shift.id,
          before: {
            version: currentVersion,
            clockedInAt: current?.clockedInAt ?? shift.clockedInAt,
            clockedOutAt: current?.clockedOutAt ?? shift.clockedOutAt,
            breaks: currentBreaks,
          },
          after: { version: createdVersion, ...window, breaks, reason },
          metadata: {
            correctionId,
            employeeName: shift.userName,
            siteId: shift.siteId,
            siteName: shift.siteName,
          },
          operationId: context.operationId,
        });
      },
      { behavior: 'immediate' }
    );
  } catch (error) {
    if (isVersionConstraint(error)) throwStaleCorrection(input.expectedVersion);
    throw error;
  }

  const created = context.db
    .select()
    .from(employeeShiftCorrections)
    .where(
      and(
        eq(employeeShiftCorrections.id, correctionId),
        eq(employeeShiftCorrections.tenantId, context.tenantId)
      )
    )
    .get();
  if (!created || created.version !== createdVersion) {
    throwServerError({
      trpcCode: 'INTERNAL_SERVER_ERROR',
      errorCode: 'EMPLOYEE_SHIFT_CORRECTION_PERSIST_FAILED',
      message: 'The attendance correction could not be reloaded.',
    });
  }
  return created;
}

export function listEmployeeAttendanceCorrections(
  db: DatabaseInstance,
  tenantId: string,
  actorRole: UserRole,
  input: ListEmployeeAttendanceCorrectionsInput
) {
  getManageableShift(db, tenantId, actorRole, input.employeeShiftId);
  const rows = db
    .select({
      id: employeeShiftCorrections.id,
      version: employeeShiftCorrections.version,
      clockedInAt: employeeShiftCorrections.clockedInAt,
      clockedOutAt: employeeShiftCorrections.clockedOutAt,
      breaks: employeeShiftCorrections.breaks,
      reason: employeeShiftCorrections.reason,
      createdByUserId: employeeShiftCorrections.createdByUserId,
      createdAt: employeeShiftCorrections.createdAt,
    })
    .from(employeeShiftCorrections)
    .where(
      and(
        eq(employeeShiftCorrections.tenantId, tenantId),
        eq(employeeShiftCorrections.employeeShiftId, input.employeeShiftId)
      )
    )
    .orderBy(desc(employeeShiftCorrections.version))
    .all();
  const creatorIds = [...new Set(rows.map(row => row.createdByUserId))];
  const creatorNames = new Map(
    creatorIds.length === 0
      ? []
      : db
          .select({ id: users.id, name: users.name })
          .from(users)
          .where(and(eq(users.tenantId, tenantId), inArray(users.id, creatorIds)))
          .all()
          .map(row => [row.id, row.name] as const)
  );
  return rows.map(row => ({
    ...row,
    createdByName: creatorNames.get(row.createdByUserId) ?? row.createdByUserId,
  }));
}
