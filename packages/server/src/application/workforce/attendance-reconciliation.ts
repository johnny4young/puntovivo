/** Explicit plan-to-attendance decisions; raw clock and schedule evidence stay immutable. */
import { and, desc, eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import type { DatabaseInstance } from '../../db/index.js';
import {
  employeeShiftCorrections,
  employeeShiftReconciliationEvents,
  employeeShiftReconciliations,
  employeeShifts,
  scheduledShifts,
  users,
  type AttendanceReconciliationSnapshot,
  type EmployeeShiftReconciliation,
} from '../../db/schema.js';
import { throwServerError } from '../../lib/errorCodes.js';
import { assertVersionedWriteApplied } from '../../lib/optimisticVersion.js';
import { writeAuditLog } from '../../services/audit-logs.js';
import { managerCanTarget } from '../../services/labor/scheduled-shift-policy.js';
import { enqueueSyncInTransaction } from '../../services/sync/enqueue.js';
import {
  recordAttendanceReconciliationInput,
  type RecordAttendanceReconciliationInput,
} from '../../trpc/schemas/employeeShifts.js';
import { withWorkforceWriter, type WorkforceCommandContext } from './writer.js';

const RECONCILIATION_MARGIN_MS = 36 * 60 * 60_000;

function notFound(): never {
  throwServerError({
    trpcCode: 'NOT_FOUND',
    errorCode: 'ATTENDANCE_RECONCILIATION_NOT_FOUND',
    message: 'The scheduled or attendance shift is not available for reconciliation',
  });
}

function snapshot(row: EmployeeShiftReconciliation): AttendanceReconciliationSnapshot {
  return {
    scheduledShiftId: row.scheduledShiftId,
    employeeShiftId: row.employeeShiftId,
    outcome: row.outcome,
    scheduledShiftVersion: row.scheduledShiftVersion,
    userId: row.userId,
    siteId: row.siteId,
    plannedStartsAt: row.plannedStartsAt,
    plannedEndsAt: row.plannedEndsAt,
    plannedTimeZone: row.plannedTimeZone,
    version: row.version,
  };
}

function loadSchedule(
  tx: DatabaseInstance,
  ctx: WorkforceCommandContext,
  scheduledShiftId: string
) {
  const row = tx
    .select({
      id: scheduledShifts.id,
      userId: scheduledShifts.userId,
      userRole: users.role,
      siteId: scheduledShifts.siteId,
      startsAt: scheduledShifts.startsAt,
      endsAt: scheduledShifts.endsAt,
      timeZone: scheduledShifts.timeZone,
      status: scheduledShifts.status,
      version: scheduledShifts.version,
    })
    .from(scheduledShifts)
    .innerJoin(users, and(eq(users.tenantId, ctx.tenantId), eq(users.id, scheduledShifts.userId)))
    .where(
      and(eq(scheduledShifts.tenantId, ctx.tenantId), eq(scheduledShifts.id, scheduledShiftId))
    )
    .get();
  if (!row || !managerCanTarget(ctx.user.role, row.userRole)) notFound();
  return row;
}

function loadEffectiveAttendanceForDecision(
  tx: DatabaseInstance,
  ctx: WorkforceCommandContext,
  employeeShiftId: string
) {
  const row = tx
    .select({
      id: employeeShifts.id,
      userId: employeeShifts.userId,
      clockedInAt: employeeShifts.clockedInAt,
      clockedOutAt: employeeShifts.clockedOutAt,
    })
    .from(employeeShifts)
    .where(and(eq(employeeShifts.tenantId, ctx.tenantId), eq(employeeShifts.id, employeeShiftId)))
    .get();
  if (!row) notFound();
  const correction = tx
    .select({
      clockedInAt: employeeShiftCorrections.clockedInAt,
      clockedOutAt: employeeShiftCorrections.clockedOutAt,
    })
    .from(employeeShiftCorrections)
    .where(
      and(
        eq(employeeShiftCorrections.tenantId, ctx.tenantId),
        eq(employeeShiftCorrections.employeeShiftId, employeeShiftId)
      )
    )
    .orderBy(desc(employeeShiftCorrections.version))
    .get();
  return {
    ...row,
    clockedInAt: correction?.clockedInAt ?? row.clockedInAt,
    clockedOutAt: correction?.clockedOutAt ?? row.clockedOutAt,
  };
}

function assertAttendanceEligible(
  tx: DatabaseInstance,
  ctx: WorkforceCommandContext,
  schedule: ReturnType<typeof loadSchedule>,
  employeeShiftId: string,
  now: string
) {
  const attendance = loadEffectiveAttendanceForDecision(tx, ctx, employeeShiftId);
  const observedEnd = attendance.clockedOutAt ?? now;
  if (
    attendance.userId !== schedule.userId ||
    Date.parse(attendance.clockedInAt) >= Date.parse(schedule.endsAt) + RECONCILIATION_MARGIN_MS ||
    Date.parse(observedEnd) <= Date.parse(schedule.startsAt) - RECONCILIATION_MARGIN_MS
  )
    notFound();

  const claimed = tx
    .select({
      id: employeeShiftReconciliations.id,
      scheduledShiftId: employeeShiftReconciliations.scheduledShiftId,
    })
    .from(employeeShiftReconciliations)
    .where(
      and(
        eq(employeeShiftReconciliations.tenantId, ctx.tenantId),
        eq(employeeShiftReconciliations.employeeShiftId, employeeShiftId)
      )
    )
    .get();
  if (claimed && claimed.scheduledShiftId !== schedule.id) {
    throwServerError({
      trpcCode: 'CONFLICT',
      errorCode: 'ATTENDANCE_RECONCILIATION_ATTENDANCE_CLAIMED',
      message: 'This attendance shift is already reconciled to another planned shift',
    });
  }
  return attendance;
}

function persistEvidence(
  tx: DatabaseInstance,
  ctx: WorkforceCommandContext,
  row: EmployeeShiftReconciliation,
  before: EmployeeShiftReconciliation | null,
  reason: string
) {
  tx.insert(employeeShiftReconciliationEvents)
    .values({
      id: nanoid(),
      tenantId: ctx.tenantId,
      reconciliationId: row.id,
      version: row.version,
      kind: before ? 'revised' : 'created',
      actorId: ctx.user.id,
      operationId: ctx.envelope.operationId,
      reason,
      before: before ? snapshot(before) : null,
      after: snapshot(row),
      createdAt: row.updatedAt,
    })
    .run();
  writeAuditLog({
    tx,
    tenantId: ctx.tenantId,
    actorId: ctx.user.id,
    operationId: ctx.envelope.operationId,
    action: 'attendance_reconciliation.changed',
    resourceType: 'attendance_reconciliation',
    resourceId: row.id,
    before: before ? { version: before.version, outcome: before.outcome } : null,
    after: {
      version: row.version,
      outcome: row.outcome,
      scheduledShiftId: row.scheduledShiftId,
    },
  });
  const result = {
    id: row.id,
    scheduledShiftId: row.scheduledShiftId,
    outcome: row.outcome,
    version: row.version,
  };
  enqueueSyncInTransaction(
    { db: tx, tenantId: ctx.tenantId, deviceId: ctx.deviceId, envelope: ctx.envelope },
    {
      entityType: 'employee_shift_reconciliations',
      entityId: row.id,
      operation: before ? 'update' : 'create',
      data: result,
    }
  );
  ctx.completeInTransaction(tx, result);
  return result;
}

/** Record or revise one explicit manager decision without rewriting either source ledger. */
export async function recordAttendanceReconciliation(
  ctx: WorkforceCommandContext,
  value: RecordAttendanceReconciliationInput
) {
  const input = recordAttendanceReconciliationInput.parse(value);
  return withWorkforceWriter(ctx, tx => {
    const schedule = loadSchedule(tx, ctx, input.scheduledShiftId);
    const current = tx
      .select()
      .from(employeeShiftReconciliations)
      .where(
        and(
          eq(employeeShiftReconciliations.tenantId, ctx.tenantId),
          eq(employeeShiftReconciliations.scheduledShiftId, schedule.id)
        )
      )
      .get();
    assertVersionedWriteApplied(
      'attendanceReconciliation',
      (current?.version ?? 0) === input.expectedVersion ? 1 : 0,
      input.expectedVersion
    );
    if (current) {
      if (current.scheduledShiftVersion !== input.scheduledShiftVersion) notFound();
    } else if (
      schedule.status !== 'scheduled' ||
      schedule.version !== input.scheduledShiftVersion
    ) {
      throwServerError({
        trpcCode: 'CONFLICT',
        errorCode: 'ATTENDANCE_RECONCILIATION_PLAN_CHANGED',
        message: 'The planned shift changed before it could be reconciled',
      });
    }

    const now = new Date().toISOString();
    if (input.outcome === 'no_show' && schedule.endsAt > now) {
      throwServerError({
        trpcCode: 'CONFLICT',
        errorCode: 'ATTENDANCE_RECONCILIATION_NO_SHOW_EARLY',
        message: 'A no-show can only be confirmed after the planned shift ends',
      });
    }
    if (input.outcome === 'attended') {
      assertAttendanceEligible(tx, ctx, schedule, input.employeeShiftId, now);
    }

    if (
      current &&
      current.outcome === input.outcome &&
      current.employeeShiftId === input.employeeShiftId
    ) {
      const result = {
        id: current.id,
        scheduledShiftId: current.scheduledShiftId,
        outcome: current.outcome,
        version: current.version,
      };
      ctx.completeInTransaction(tx, result);
      return result;
    }

    if (!current) {
      const id = nanoid();
      tx.insert(employeeShiftReconciliations)
        .values({
          id,
          tenantId: ctx.tenantId,
          scheduledShiftId: schedule.id,
          employeeShiftId: input.employeeShiftId,
          outcome: input.outcome,
          scheduledShiftVersion: schedule.version,
          userId: schedule.userId,
          siteId: schedule.siteId,
          plannedStartsAt: schedule.startsAt,
          plannedEndsAt: schedule.endsAt,
          plannedTimeZone: schedule.timeZone,
          version: 1,
          createdByUserId: ctx.user.id,
          updatedByUserId: ctx.user.id,
          createdAt: now,
          updatedAt: now,
        })
        .run();
      const created = tx
        .select()
        .from(employeeShiftReconciliations)
        .where(
          and(
            eq(employeeShiftReconciliations.tenantId, ctx.tenantId),
            eq(employeeShiftReconciliations.id, id)
          )
        )
        .get();
      if (!created) notFound();
      return persistEvidence(tx, ctx, created, null, input.reason);
    }

    const result = tx
      .update(employeeShiftReconciliations)
      .set({
        employeeShiftId: input.employeeShiftId,
        outcome: input.outcome,
        version: input.expectedVersion + 1,
        updatedByUserId: ctx.user.id,
        updatedAt: now,
      })
      .where(
        and(
          eq(employeeShiftReconciliations.tenantId, ctx.tenantId),
          eq(employeeShiftReconciliations.id, current.id),
          eq(employeeShiftReconciliations.version, input.expectedVersion)
        )
      )
      .run();
    assertVersionedWriteApplied('attendanceReconciliation', result.changes, input.expectedVersion);
    const updated = tx
      .select()
      .from(employeeShiftReconciliations)
      .where(
        and(
          eq(employeeShiftReconciliations.tenantId, ctx.tenantId),
          eq(employeeShiftReconciliations.id, current.id)
        )
      )
      .get();
    if (!updated) notFound();
    return persistEvidence(tx, ctx, updated, current, input.reason);
  });
}
