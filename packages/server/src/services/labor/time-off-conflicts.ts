import { and, eq, gt, inArray, lt, ne } from 'drizzle-orm';
import type { DatabaseInstance } from '../../db/index.js';
import { employeeTimeOff, scheduledShifts } from '../../db/schema.js';
import { throwServerError } from '../../lib/errorCodes.js';

/** One employee's real UTC interval across every site; callers already hold the SQLite writer. */
export interface TimeOffConflictWindow {
  tenantId: string;
  userId: string;
  startsAt: string;
  endsAt: string;
}

/** Pending requests do not block shifts. Approved requests always do, including another site. */
export function assertNoApprovedTimeOff(db: DatabaseInstance, window: TimeOffConflictWindow): void {
  const row = db
    .select({ id: employeeTimeOff.id })
    .from(employeeTimeOff)
    .where(
      and(
        eq(employeeTimeOff.tenantId, window.tenantId),
        eq(employeeTimeOff.userId, window.userId),
        eq(employeeTimeOff.status, 'approved'),
        lt(employeeTimeOff.startsAt, window.endsAt),
        gt(employeeTimeOff.endsAt, window.startsAt)
      )
    )
    .get();
  if (row)
    throwServerError({
      trpcCode: 'CONFLICT',
      errorCode: 'SCHEDULE_TIME_OFF_CONFLICT',
      message: 'The employee has approved time off in this interval',
    });
}

/** Two active requests cannot claim the same interval, even with different operation identities. */
export function assertNoActiveTimeOff(
  db: DatabaseInstance,
  window: TimeOffConflictWindow,
  excludeId?: string
): void {
  const row = db
    .select({ id: employeeTimeOff.id })
    .from(employeeTimeOff)
    .where(
      and(
        eq(employeeTimeOff.tenantId, window.tenantId),
        eq(employeeTimeOff.userId, window.userId),
        inArray(employeeTimeOff.status, ['pending', 'approved']),
        lt(employeeTimeOff.startsAt, window.endsAt),
        gt(employeeTimeOff.endsAt, window.startsAt),
        ...(excludeId ? [ne(employeeTimeOff.id, excludeId)] : [])
      )
    )
    .get();
  if (row)
    throwServerError({
      trpcCode: 'CONFLICT',
      errorCode: 'TIME_OFF_OVERLAP',
      message: 'Another active time-off request overlaps this interval',
    });
}

/** Approval never silently cancels a schedule. Resolve conflicting shifts explicitly first. */
export function assertNoScheduledShiftDuringTimeOff(
  db: DatabaseInstance,
  window: TimeOffConflictWindow
): void {
  const row = db
    .select({ id: scheduledShifts.id })
    .from(scheduledShifts)
    .where(
      and(
        eq(scheduledShifts.tenantId, window.tenantId),
        eq(scheduledShifts.userId, window.userId),
        eq(scheduledShifts.status, 'scheduled'),
        lt(scheduledShifts.startsAt, window.endsAt),
        gt(scheduledShifts.endsAt, window.startsAt)
      )
    )
    .get();
  if (row)
    throwServerError({
      trpcCode: 'CONFLICT',
      errorCode: 'TIME_OFF_SCHEDULE_CONFLICT',
      message: 'Resolve scheduled shifts in this period before approving time off',
    });
}
