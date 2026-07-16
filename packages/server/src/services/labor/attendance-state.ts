import { and, desc, eq, isNull } from 'drizzle-orm';
import type { DatabaseInstance } from '../../db/index.js';
import { cashSessions, employeeShiftBreaks, employeeShifts, sites } from '../../db/schema.js';
import { throwServerError } from '../../lib/errorCodes.js';

export const employeeShiftSelection = {
  id: employeeShifts.id,
  tenantId: employeeShifts.tenantId,
  userId: employeeShifts.userId,
  siteId: employeeShifts.siteId,
  siteName: sites.name,
  clockedInAt: employeeShifts.clockedInAt,
  clockedOutAt: employeeShifts.clockedOutAt,
  createdAt: employeeShifts.createdAt,
  updatedAt: employeeShifts.updatedAt,
} as const;

export const employeeBreakSelection = {
  id: employeeShiftBreaks.id,
  tenantId: employeeShiftBreaks.tenantId,
  employeeShiftId: employeeShiftBreaks.employeeShiftId,
  userId: employeeShiftBreaks.userId,
  startedAt: employeeShiftBreaks.startedAt,
  endedAt: employeeShiftBreaks.endedAt,
  startedByUserId: employeeShiftBreaks.startedByUserId,
  endedByUserId: employeeShiftBreaks.endedByUserId,
  createdAt: employeeShiftBreaks.createdAt,
  updatedAt: employeeShiftBreaks.updatedAt,
} as const;

export const cashSessionForEmployeeSelection = {
  id: cashSessions.id,
  siteId: cashSessions.siteId,
  siteName: sites.name,
  registerName: cashSessions.registerName,
  employeeShiftId: cashSessions.employeeShiftId,
  openedAt: cashSessions.openedAt,
} as const;

export function getOpenEmployeeShift(db: DatabaseInstance, tenantId: string, userId: string) {
  return db
    .select(employeeShiftSelection)
    .from(employeeShifts)
    .innerJoin(sites, and(eq(employeeShifts.siteId, sites.id), eq(sites.tenantId, tenantId)))
    .where(
      and(
        eq(employeeShifts.tenantId, tenantId),
        eq(employeeShifts.userId, userId),
        isNull(employeeShifts.clockedOutAt)
      )
    )
    .orderBy(desc(employeeShifts.clockedInAt))
    .get();
}

export function getOpenEmployeeBreak(db: DatabaseInstance, tenantId: string, userId: string) {
  return db
    .select(employeeBreakSelection)
    .from(employeeShiftBreaks)
    .where(
      and(
        eq(employeeShiftBreaks.tenantId, tenantId),
        eq(employeeShiftBreaks.userId, userId),
        isNull(employeeShiftBreaks.endedAt)
      )
    )
    .orderBy(desc(employeeShiftBreaks.startedAt))
    .get();
}

/**
 * ENG-140d — locate any open drawer owned by the employee, independent of
 * the currently selected UI site. Legacy sessions may have a null labor link,
 * so the cashier identity remains the fail-closed source for clock-out.
 */
export function getOpenCashSessionForEmployee(
  db: DatabaseInstance,
  tenantId: string,
  userId: string
) {
  return db
    .select(cashSessionForEmployeeSelection)
    .from(cashSessions)
    .leftJoin(sites, and(eq(cashSessions.siteId, sites.id), eq(sites.tenantId, tenantId)))
    .where(
      and(
        eq(cashSessions.tenantId, tenantId),
        eq(cashSessions.cashierId, userId),
        eq(cashSessions.status, 'open')
      )
    )
    .orderBy(desc(cashSessions.openedAt))
    .get();
}

export function throwAlreadyClockedIn(
  shift: NonNullable<ReturnType<typeof getOpenEmployeeShift>>
): never {
  throwServerError({
    trpcCode: 'CONFLICT',
    errorCode: 'EMPLOYEE_SHIFT_ALREADY_CLOCKED_IN',
    message: 'The employee already has an open shift.',
    details: {
      shiftId: shift.id,
      siteId: shift.siteId,
      clockedInAt: shift.clockedInAt,
    },
  });
}

export function throwNotClockedIn(): never {
  throwServerError({
    trpcCode: 'CONFLICT',
    errorCode: 'EMPLOYEE_SHIFT_NOT_CLOCKED_IN',
    message: 'The employee does not have an open shift.',
  });
}

export function throwBreakAlreadyActive(
  activeBreak: NonNullable<ReturnType<typeof getOpenEmployeeBreak>>
): never {
  throwServerError({
    trpcCode: 'CONFLICT',
    errorCode: 'EMPLOYEE_SHIFT_BREAK_ALREADY_ACTIVE',
    message: 'The employee already has an active break.',
    details: {
      breakId: activeBreak.id,
      shiftId: activeBreak.employeeShiftId,
      startedAt: activeBreak.startedAt,
    },
  });
}

export function throwBreakNotActive(): never {
  throwServerError({
    trpcCode: 'CONFLICT',
    errorCode: 'EMPLOYEE_SHIFT_BREAK_NOT_ACTIVE',
    message: 'The employee does not have an active break.',
  });
}

export function throwBreakActive(): never {
  throwServerError({
    trpcCode: 'CONFLICT',
    errorCode: 'EMPLOYEE_SHIFT_BREAK_ACTIVE',
    message: 'End the active break before clocking out.',
  });
}

export function throwCashSessionOpen(
  session: NonNullable<ReturnType<typeof getOpenCashSessionForEmployee>>
): never {
  throwServerError({
    trpcCode: 'CONFLICT',
    errorCode: 'EMPLOYEE_SHIFT_CASH_SESSION_OPEN',
    message: 'Close the open register before clocking out.',
    details: {
      cashSessionId: session.id,
      siteId: session.siteId,
      registerName: session.registerName,
      openedAt: session.openedAt,
    },
  });
}
