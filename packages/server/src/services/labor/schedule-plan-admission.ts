/** Temporal preflight never holds the writer; publication verifies its complete read set again. */
import { createHash } from 'node:crypto';
import { setImmediate as yieldToEventLoop } from 'node:timers/promises';
import { and, asc, eq, gt, isNull, lt, or } from 'drizzle-orm';
import type { DatabaseInstance } from '../../db/index.js';
import {
  employeeAvailability,
  scheduledShifts,
  type SchedulePlanSnapshot,
} from '../../db/schema.js';
import { throwServerError } from '../../lib/errorCodes.js';
import { compileAvailability } from './availability.js';
import { expandScheduleRecurrence } from './schedule-recurrence.js';
import { assertNoApprovedTimeOff } from './time-off-conflicts.js';
import { throwOverlap } from './scheduled-shift-policy.js';

export function schedulePlanChanged(): never {
  throwServerError({
    trpcCode: 'CONFLICT',
    errorCode: 'SCHEDULE_PLAN_CHANGED',
    message: 'The draft or scheduling policy changed; reload before publishing',
  });
}
/** Includes unversioned external edits, membership changes and linkage, not only header version. */
export function schedulePlanDigest(snapshot: SchedulePlanSnapshot): string {
  return createHash('sha256').update(JSON.stringify(snapshot)).digest('hex');
}
function policies(
  db: DatabaseInstance,
  tenantId: string,
  row: SchedulePlanSnapshot['occurrences'][number]
) {
  const a = employeeAvailability;
  const rows = db
    .select({
      id: a.id,
      version: a.version,
      fromDate: a.fromDate,
      untilDate: a.untilDate,
      startsAt: a.startsAt,
      endsAt: a.endsAt,
      timeZone: a.timeZone,
      slots: a.slots,
    })
    .from(a)
    .where(
      and(
        eq(a.tenantId, tenantId),
        eq(a.userId, row.userId),
        eq(a.status, 'active'),
        lt(a.startsAt, row.endsAt),
        or(isNull(a.endsAt), gt(a.endsAt, row.startsAt))
      )
    )
    .orderBy(asc(a.id))
    .limit(101)
    .all();
  if (rows.length > 100) availabilityConflict();
  return rows;
}
function availabilityConflict(): never {
  throwServerError({
    trpcCode: 'CONFLICT',
    errorCode: 'SCHEDULE_AVAILABILITY_CONFLICT',
    message: 'A shift falls outside current employee availability',
  });
}
function assertNoConflict(
  db: DatabaseInstance,
  tenantId: string,
  row: SchedulePlanSnapshot['occurrences'][number]
) {
  assertNoApprovedTimeOff(db, {
    tenantId,
    userId: row.userId,
    startsAt: row.startsAt,
    endsAt: row.endsAt,
  });
  const s = scheduledShifts;
  const conflict = db
    .select({ id: s.id })
    .from(s)
    .where(
      and(
        eq(s.tenantId, tenantId),
        eq(s.userId, row.userId),
        eq(s.status, 'scheduled'),
        lt(s.startsAt, row.endsAt),
        gt(s.endsAt, row.startsAt)
      )
    )
    .get();
  if (conflict) throwOverlap(conflict.id);
}
/** Validate exact frozen generation; a timezone database change requires explicit draft regeneration. */
async function assertFrozenIntent(snapshot: SchedulePlanSnapshot) {
  const { plan, occurrences } = snapshot;
  const expected = await expandScheduleRecurrence(
    {
      siteId: plan.siteId,
      fromDate: plan.fromDate,
      untilDate: plan.untilDate,
      anchorWeekStart: plan.anchorWeekStart,
      rules: plan.rules,
    },
    plan.timeZone
  );
  const byIdentity = new Map(
    expected.map(row => [JSON.stringify([row.ruleId, row.startDate]), row])
  );
  if (expected.length !== occurrences.length) schedulePlanChanged();
  for (const row of occurrences) {
    const original = byIdentity.get(JSON.stringify([row.ruleId, row.startDate]));
    if (
      !original ||
      row.publishedShiftId !== null ||
      row.tenantId !== plan.tenantId ||
      row.planId !== plan.id
    )
      schedulePlanChanged();
    for (const key of [
      'userId',
      'endDate',
      'startTime',
      'endTime',
      'startsAt',
      'endsAt',
      'notes',
    ] as const) {
      if (row[key] !== original[key]) schedulePlanChanged();
    }
  }
}
/**
 * Validate all availability minutes outside the writer, with no shared verdict cache.
 * The digest covers full policy content per occurrence, not just policy versions.
 */
export async function preflightSchedulePlan(
  db: DatabaseInstance,
  snapshot: SchedulePlanSnapshot
): Promise<string> {
  await assertFrozenIntent(snapshot);
  const digest = createHash('sha256');
  for (const row of snapshot.occurrences) {
    await yieldToEventLoop();
    assertNoConflict(db, snapshot.plan.tenantId, row);
    const selected = policies(db, snapshot.plan.tenantId, row);
    digest.update(JSON.stringify([row.id, selected]));
    for (const policy of selected) {
      if (!compileAvailability(policy)(row.startsAt, row.endsAt)) availabilityConflict();
    }
  }
  return digest.digest('hex');
}
/** Run under BEGIN IMMEDIATE before any shift insert; no await or expensive minute evaluation. */
export function assertSchedulePlanPreflightCurrent(
  db: DatabaseInstance,
  snapshot: SchedulePlanSnapshot,
  expected: string
): void {
  const digest = createHash('sha256');
  for (const row of snapshot.occurrences) {
    assertNoConflict(db, snapshot.plan.tenantId, row);
    digest.update(JSON.stringify([row.id, policies(db, snapshot.plan.tenantId, row)]));
  }
  if (digest.digest('hex') !== expected) schedulePlanChanged();
}
