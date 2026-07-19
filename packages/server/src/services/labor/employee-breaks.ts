import { and, eq, isNull } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import type { DatabaseInstance } from '../../db/index.js';
import { employeeShiftBreaks } from '../../db/schema.js';
import { throwServerError } from '../../lib/errorCodes.js';
import { writeAuditLog } from '../audit-logs.js';
import {
  employeeBreakSelection,
  getOpenEmployeeBreak,
  getOpenEmployeeShift,
  throwBreakAlreadyActive,
  throwBreakNotActive,
  throwNotClockedIn,
} from './attendance-state.js';

interface EmployeeBreakCommandContext {
  db: DatabaseInstance;
  tenantId: string;
  actorId: string;
  operationId: string;
}

function reloadBreak(db: DatabaseInstance, tenantId: string, userId: string, id: string) {
  return db
    .select(employeeBreakSelection)
    .from(employeeShiftBreaks)
    .where(
      and(
        eq(employeeShiftBreaks.id, id),
        eq(employeeShiftBreaks.tenantId, tenantId),
        eq(employeeShiftBreaks.userId, userId)
      )
    )
    .get();
}

function throwBreakPersistFailed(id: string, operation: 'start' | 'end'): never {
  throwServerError({
    trpcCode: 'INTERNAL_SERVER_ERROR',
    errorCode: 'EMPLOYEE_SHIFT_BREAK_PERSIST_FAILED',
    message: 'The employee break record could not be reloaded.',
    details: { breakId: id, operation },
  });
}

function isOpenBreakConstraint(error: unknown): boolean {
  return (
    error instanceof Error &&
    /idx_employee_shift_breaks_tenant_user_open|employee_shift_breaks\.tenant_id, employee_shift_breaks\.user_id/i.test(
      error.message
    )
  );
}

function isClosedParentConstraint(error: unknown): boolean {
  return error instanceof Error && /EMPLOYEE_SHIFT_BREAK_OUTSIDE_SHIFT/i.test(error.message);
}

/** ENG-140b — start one explicit self-service rest interval. */
export function startEmployeeBreak(context: EmployeeBreakCommandContext) {
  const id = nanoid();

  try {
    context.db.transaction(
      tx => {
        const shift = getOpenEmployeeShift(tx, context.tenantId, context.actorId);
        if (!shift) throwNotClockedIn();
        const activeBreak = getOpenEmployeeBreak(tx, context.tenantId, context.actorId);
        if (activeBreak) throwBreakAlreadyActive(activeBreak);
        const startedAt = new Date().toISOString();

        tx.insert(employeeShiftBreaks)
          .values({
            id,
            tenantId: context.tenantId,
            employeeShiftId: shift.id,
            userId: context.actorId,
            startedAt,
            endedAt: null,
            startedByUserId: context.actorId,
            endedByUserId: null,
            createdAt: startedAt,
            updatedAt: startedAt,
          })
          .run();
        writeAuditLog({
          tx,
          tenantId: context.tenantId,
          actorId: context.actorId,
          action: 'employee_shift_break.start',
          resourceType: 'employee_shift_break',
          resourceId: id,
          before: null,
          after: {
            employeeShiftId: shift.id,
            userId: context.actorId,
            startedAt,
            endedAt: null,
          },
          metadata: { siteId: shift.siteId, siteName: shift.siteName },
          operationId: context.operationId,
        });
      },
      { behavior: 'immediate' }
    );
  } catch (error) {
    if (isOpenBreakConstraint(error)) {
      const activeBreak = getOpenEmployeeBreak(context.db, context.tenantId, context.actorId);
      if (activeBreak) throwBreakAlreadyActive(activeBreak);
    }
    if (isClosedParentConstraint(error)) throwNotClockedIn();
    throw error;
  }

  const created = reloadBreak(context.db, context.tenantId, context.actorId, id);
  if (!created) throwBreakPersistFailed(id, 'start');
  return created;
}

/** ENG-140b — finish the current rest interval without rewriting its start. */
export function endEmployeeBreak(context: EmployeeBreakCommandContext) {
  let endedBreakId = '';

  context.db.transaction(
    tx => {
      const shift = getOpenEmployeeShift(tx, context.tenantId, context.actorId);
      if (!shift) throwNotClockedIn();
      const activeBreak = getOpenEmployeeBreak(tx, context.tenantId, context.actorId);
      if (!activeBreak) throwBreakNotActive();
      if (activeBreak.employeeShiftId !== shift.id) throwBreakNotActive();

      const endedAt = new Date(
        Math.max(Date.now(), Date.parse(activeBreak.startedAt) + 1)
      ).toISOString();
      const result = tx
        .update(employeeShiftBreaks)
        .set({
          endedAt,
          endedByUserId: context.actorId,
          updatedAt: endedAt,
        })
        .where(
          and(
            eq(employeeShiftBreaks.id, activeBreak.id),
            eq(employeeShiftBreaks.tenantId, context.tenantId),
            eq(employeeShiftBreaks.userId, context.actorId),
            isNull(employeeShiftBreaks.endedAt)
          )
        )
        .run();
      if (result.changes !== 1) throwBreakNotActive();
      endedBreakId = activeBreak.id;

      writeAuditLog({
        tx,
        tenantId: context.tenantId,
        actorId: context.actorId,
        action: 'employee_shift_break.end',
        resourceType: 'employee_shift_break',
        resourceId: activeBreak.id,
        before: {
          employeeShiftId: shift.id,
          userId: context.actorId,
          startedAt: activeBreak.startedAt,
          endedAt: null,
        },
        after: {
          employeeShiftId: shift.id,
          userId: context.actorId,
          startedAt: activeBreak.startedAt,
          endedAt,
        },
        metadata: { siteId: shift.siteId, siteName: shift.siteName },
        operationId: context.operationId,
      });
    },
    { behavior: 'immediate' }
  );

  if (!endedBreakId) throwBreakNotActive();
  const ended = reloadBreak(context.db, context.tenantId, context.actorId, endedBreakId);
  if (!ended?.endedAt) throwBreakPersistFailed(endedBreakId, 'end');
  return ended;
}
