import type { UserRole } from '@puntovivo/shared/roles';
import { throwServerError } from '../../lib/errorCodes.js';

export const SCHEDULE_ROLES = ['admin', 'manager', 'cashier'] as const;
export const MAX_LIST_DAYS = 31;
export const MAX_SHIFT_DURATION_MS = 24 * 60 * 60_000;
export const BROAD_QUERY_MARGIN_MS = 36 * 60 * 60_000;

/** ENG-140a — admins may target every labor role; managers never target admins. */
export function managerCanTarget(actorRole: UserRole, targetRole: UserRole): boolean {
  if (actorRole === 'admin') {
    return SCHEDULE_ROLES.includes(targetRole as (typeof SCHEDULE_ROLES)[number]);
  }
  return actorRole === 'manager' && (targetRole === 'manager' || targetRole === 'cashier');
}

export function throwEmployeeNotFound(): never {
  throwServerError({
    trpcCode: 'NOT_FOUND',
    errorCode: 'SCHEDULE_EMPLOYEE_NOT_FOUND',
    message: 'The employee is not available for scheduling.',
  });
}

export function throwScheduleNotFound(): never {
  throwServerError({
    trpcCode: 'NOT_FOUND',
    errorCode: 'SCHEDULE_SHIFT_NOT_FOUND',
    message: 'The scheduled shift was not found.',
  });
}

export function throwOverlap(conflictingShiftId?: string): never {
  throwServerError({
    trpcCode: 'CONFLICT',
    errorCode: 'SCHEDULE_SHIFT_OVERLAP',
    message: 'The employee already has a scheduled shift in this time window.',
    details: conflictingShiftId ? { conflictingShiftId } : undefined,
  });
}
