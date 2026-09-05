import { createHash } from 'node:crypto';
import { and, eq, gt, lt, notInArray } from 'drizzle-orm';
import type { DatabaseInstance } from '../../db/index.js';
import {
  employeeShiftSwaps,
  scheduledShifts,
  sites,
  users,
  type EmployeeShiftSwap,
  type ScheduledShift,
  type SwapShiftIntent,
} from '../../db/schema.js';
import { throwServerError } from '../../lib/errorCodes.js';
import type { UserRole } from '@puntovivo/shared/roles';
import { assertNoApprovedTimeOff } from './time-off-conflicts.js';
import { assertShiftAvailability } from './availability-conflicts.js';

export function swapNotFound(): never {
  throwServerError({
    trpcCode: 'NOT_FOUND',
    errorCode: 'SHIFT_SWAP_NOT_FOUND',
    message: 'The shift exchange is not available',
  });
}
export function swapChanged(): never {
  throwServerError({
    trpcCode: 'CONFLICT',
    errorCode: 'SHIFT_SWAP_CHANGED',
    message: 'The shifts changed or started; cancel this request and create a new one',
  });
}
export function swapStateInvalid(): never {
  throwServerError({
    trpcCode: 'CONFLICT',
    errorCode: 'SHIFT_SWAP_STATE_INVALID',
    message: 'This shift exchange decision is not available',
  });
}
export function getSwap(db: DatabaseInstance, tenantId: string, id: string): EmployeeShiftSwap {
  const row = db
    .select()
    .from(employeeShiftSwaps)
    .where(and(eq(employeeShiftSwaps.tenantId, tenantId), eq(employeeShiftSwaps.id, id)))
    .get();
  if (!row) swapNotFound();
  return row;
}
/** Tenant-local participants only; archived actors remain resolvable for explicit cleanup. */
export function swapEmployee(db: DatabaseInstance, tenantId: string, id: string) {
  const row = db
    .select({ id: users.id, role: users.role, isActive: users.isActive })
    .from(users)
    .where(and(eq(users.tenantId, tenantId), eq(users.id, id)))
    .get();
  if (!row) swapNotFound();
  return row;
}
export function canManageSwap(
  db: DatabaseInstance,
  tenantId: string,
  role: UserRole,
  row: EmployeeShiftSwap
): boolean {
  return (
    role === 'admin' ||
    (role === 'manager' &&
      [row.requesterId, row.recipientId].every(
        id => swapEmployee(db, tenantId, id).role !== 'admin'
      ))
  );
}
export function getSwapShift(db: DatabaseInstance, tenantId: string, id: string): ScheduledShift {
  const row = db
    .select()
    .from(scheduledShifts)
    .where(and(eq(scheduledShifts.tenantId, tenantId), eq(scheduledShifts.id, id)))
    .get();
  if (!row) swapNotFound();
  return row;
}
export function shiftIntent(row: ScheduledShift): SwapShiftIntent {
  const intent = {
    id: row.id,
    userId: row.userId,
    siteId: row.siteId,
    startsAt: row.startsAt,
    endsAt: row.endsAt,
    timeZone: row.timeZone,
    version: row.version,
  };
  return {
    ...intent,
    fingerprint: createHash('sha256')
      .update(JSON.stringify({ ...intent, notes: row.notes, status: row.status }))
      .digest('hex'),
  };
}
/** No transfer of elapsed work; approval cannot rewrite attendance or already-started assignments. */
export function assertSwappable(
  db: DatabaseInstance,
  tenantId: string,
  row: ScheduledShift,
  now: string
): void {
  const start = Date.parse(row.startsAt),
    end = Date.parse(row.endsAt);
  if (
    !Number.isSafeInteger(row.version) ||
    row.version < 1 ||
    row.version >= Number.MAX_SAFE_INTEGER ||
    row.status !== 'scheduled' ||
    !Number.isFinite(start) ||
    !Number.isFinite(end) ||
    start <= Date.parse(now) ||
    end <= start ||
    end - start > 86400000
  )
    swapChanged();
  if (new Date(start).toISOString() !== row.startsAt || new Date(end).toISOString() !== row.endsAt)
    swapChanged();
  try {
    new Intl.DateTimeFormat('en', { timeZone: row.timeZone }).format(start);
  } catch {
    swapChanged();
  }
  const site = db
    .select({ id: sites.id })
    .from(sites)
    .where(and(eq(sites.tenantId, tenantId), eq(sites.id, row.siteId), eq(sites.isActive, true)))
    .get();
  if (!site || !swapEmployee(db, tenantId, row.userId).isActive) swapChanged();
}
/** Recheck both captured intents, even when only one participant is acting. */
export function currentSwapPair(
  db: DatabaseInstance,
  tenantId: string,
  swap: EmployeeShiftSwap,
  now: string
) {
  const offered = getSwapShift(db, tenantId, swap.offeredShiftId),
    requested = getSwapShift(db, tenantId, swap.requestedShiftId);
  for (const [row, intent] of [
    [offered, swap.intent.offered],
    [requested, swap.intent.requested],
  ] as const) {
    assertSwappable(db, tenantId, row, now);
    if (JSON.stringify(shiftIntent(row)) !== JSON.stringify(intent)) swapChanged();
  }
  return { offered, requested };
}
/** Existing assignments being replaced are excluded, but every other site still participates. */
export function assertSwapAssignment(
  db: DatabaseInstance,
  tenantId: string,
  userId: string,
  shift: ScheduledShift,
  originalIds: string[]
): void {
  const window = { tenantId, userId, startsAt: shift.startsAt, endsAt: shift.endsAt };
  assertNoApprovedTimeOff(db, window);
  assertShiftAvailability(db, window);
  const conflict = db
    .select({ id: scheduledShifts.id })
    .from(scheduledShifts)
    .where(
      and(
        eq(scheduledShifts.tenantId, tenantId),
        eq(scheduledShifts.userId, userId),
        eq(scheduledShifts.status, 'scheduled'),
        lt(scheduledShifts.startsAt, shift.endsAt),
        gt(scheduledShifts.endsAt, shift.startsAt),
        notInArray(scheduledShifts.id, originalIds)
      )
    )
    .get();
  // Never expose a coworker's unrelated assignment ID through an employee-facing error.
  if (conflict)
    throwServerError({
      trpcCode: 'CONFLICT',
      errorCode: 'SCHEDULE_SHIFT_OVERLAP',
      message: 'The exchange conflicts with another scheduled shift',
    });
}
