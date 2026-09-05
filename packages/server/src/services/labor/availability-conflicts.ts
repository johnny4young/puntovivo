/** Reciprocal admission: new shifts and new availability must both respect existing evidence. */
import { createHash } from 'node:crypto';
import { setImmediate as yieldEventLoop } from 'node:timers/promises';
import { and, asc, eq, gt, isNull, lt, ne, or } from 'drizzle-orm';
import type { DatabaseInstance } from '../../db/index.js';
import { employeeAvailability, scheduledShifts } from '../../db/schema.js';
import { throwServerError } from '../../lib/errorCodes.js';
import {
  compileAvailability,
  type AvailabilityPolicy,
  type AvailabilityWindow,
} from './availability.js';

/** Tenant-scoped employee capability interval, independent of the site assigning a shift. */
export interface AvailabilityScope {
  tenantId: string;
  userId: string;
  startsAt: string;
  endsAt: string | null;
}
export function assertNoAvailabilityOverlap(
  db: DatabaseInstance,
  scope: AvailabilityScope,
  excludeId?: string
): void {
  const existing = db
    .select({ id: employeeAvailability.id })
    .from(employeeAvailability)
    .where(
      and(
        eq(employeeAvailability.tenantId, scope.tenantId),
        eq(employeeAvailability.userId, scope.userId),
        eq(employeeAvailability.status, 'active'),
        or(isNull(employeeAvailability.endsAt), gt(employeeAvailability.endsAt, scope.startsAt)),
        ...(scope.endsAt ? [lt(employeeAvailability.startsAt, scope.endsAt)] : []),
        ...(excludeId ? [ne(employeeAvailability.id, excludeId)] : [])
      )
    )
    .get();
  if (existing)
    throwServerError({
      trpcCode: 'CONFLICT',
      errorCode: 'AVAILABILITY_OVERLAP',
      message: 'An effective availability policy already overlaps this period',
    });
}
export function assertShiftAvailability(
  db: DatabaseInstance,
  scope: AvailabilityScope & { endsAt: string }
): void {
  const policies = db
    .select({
      fromDate: employeeAvailability.fromDate,
      untilDate: employeeAvailability.untilDate,
      startsAt: employeeAvailability.startsAt,
      endsAt: employeeAvailability.endsAt,
      timeZone: employeeAvailability.timeZone,
      slots: employeeAvailability.slots,
    })
    .from(employeeAvailability)
    .where(
      and(
        eq(employeeAvailability.tenantId, scope.tenantId),
        eq(employeeAvailability.userId, scope.userId),
        eq(employeeAvailability.status, 'active'),
        lt(employeeAvailability.startsAt, scope.endsAt),
        or(isNull(employeeAvailability.endsAt), gt(employeeAvailability.endsAt, scope.startsAt))
      )
    )
    .limit(101)
    .all();
  // A malformed/implausibly dense history must not bypass admission or materialize unbounded rows.
  if (
    policies.length > 100 ||
    policies.some(policy => !compileAvailability(policy)(scope.startsAt, scope.endsAt))
  )
    throwServerError({
      trpcCode: 'CONFLICT',
      errorCode: 'SCHEDULE_AVAILABILITY_CONFLICT',
      message: 'The shift falls outside the employee availability',
    });
}

function page(db: DatabaseInstance, scope: AvailabilityScope, cursor?: string) {
  return db
    .select({
      id: scheduledShifts.id,
      startsAt: scheduledShifts.startsAt,
      endsAt: scheduledShifts.endsAt,
      version: scheduledShifts.version,
    })
    .from(scheduledShifts)
    .where(
      and(
        eq(scheduledShifts.tenantId, scope.tenantId),
        eq(scheduledShifts.userId, scope.userId),
        eq(scheduledShifts.status, 'scheduled'),
        gt(scheduledShifts.endsAt, scope.startsAt),
        ...(scope.endsAt ? [lt(scheduledShifts.startsAt, scope.endsAt)] : []),
        ...(cursor ? [gt(scheduledShifts.id, cursor)] : [])
      )
    )
    .orderBy(asc(scheduledShifts.id))
    .limit(50)
    .all();
}
/**
 * CPU-heavy wall-clock validation yields between bounded pages outside the SQLite writer.
 * The digest covers exactly the rows validated (including versions); the writer recomputes it.
 * Concurrent insertion/deletion/update, even behind a keyset cursor, then fails closed.
 */
export async function preflightAvailability(
  db: DatabaseInstance,
  tenantId: string,
  userId: string,
  policy: AvailabilityPolicy
): Promise<string> {
  const scope = { tenantId, userId, ...policy },
    allows = compileAvailability(policy),
    hash = createHash('sha256');
  let cursor: string | undefined;
  for (;;) {
    await yieldEventLoop();
    const rows = page(db, scope, cursor);
    for (const row of rows) {
      if (!allows(row.startsAt, row.endsAt))
        throwServerError({
          trpcCode: 'CONFLICT',
          errorCode: 'AVAILABILITY_SCHEDULE_CONFLICT',
          message: 'Resolve scheduled shifts outside this availability before saving',
        });
      hash.update(JSON.stringify(row) + '\n');
      await yieldEventLoop();
    }
    if (rows.length < 50) return hash.digest('hex');
    cursor = rows.at(-1)!.id;
  }
}
/** Cheap synchronous fingerprint only: no wall-time expansion and no await under the writer. */
export function assertAvailabilityPreflightCurrent(
  db: DatabaseInstance,
  tenantId: string,
  userId: string,
  window: AvailabilityWindow,
  expected: string
): void {
  const scope = { tenantId, userId, ...window },
    hash = createHash('sha256');
  let cursor: string | undefined;
  for (;;) {
    const rows = page(db, scope, cursor);
    for (const row of rows) hash.update(JSON.stringify(row) + '\n');
    if (rows.length < 50) break;
    cursor = rows.at(-1)!.id;
  }
  if (hash.digest('hex') !== expected)
    throwServerError({
      trpcCode: 'CONFLICT',
      errorCode: 'AVAILABILITY_SCHEDULE_CHANGED',
      message: 'Scheduled shifts changed during validation; refresh and retry',
    });
}
