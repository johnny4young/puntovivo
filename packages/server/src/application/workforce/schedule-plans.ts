/** One plan decision, one writer and one command completion; never a loop of shift commands. */
import { and, eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import type { DatabaseInstance } from '../../db/index.js';
import {
  employeeScheduleOccurrences,
  employeeSchedulePlanEvents,
  employeeSchedulePlans,
  scheduledShifts,
  type SchedulePlanSnapshot,
} from '../../db/schema.js';
import { throwServerError } from '../../lib/errorCodes.js';
import { assertVersionedWriteApplied } from '../../lib/optimisticVersion.js';
import { writeAuditLog } from '../../services/audit-logs.js';
import { enqueueSyncInTransaction } from '../../services/sync/enqueue.js';
import { resolveTenantBusinessClock } from '../../services/pharmacy/business-clock.js';
import {
  expandScheduleRecurrence,
  ScheduleRecurrenceError,
  type ScheduleOccurrence,
} from '../../services/labor/schedule-recurrence.js';
import {
  assertSchedulePlanTargets,
  getSchedulePlan,
} from '../../services/labor/schedule-plan-reads.js';
import {
  assertSchedulePlanPreflightCurrent,
  preflightSchedulePlan,
  schedulePlanChanged,
  schedulePlanDigest,
} from '../../services/labor/schedule-plan-admission.js';
import {
  createSchedulePlanInput,
  decideSchedulePlanInput,
  discardSchedulePlanInput,
  regenerateSchedulePlanInput,
  type CreateSchedulePlanInput,
  type DecideSchedulePlanInput,
  type DiscardSchedulePlanInput,
  type RegenerateSchedulePlanInput,
} from '../../trpc/schemas/schedulePlans.js';
import { withWorkforceWriter, type WorkforceCommandContext } from './writer.js';

function assertDraft(snapshot: SchedulePlanSnapshot, expectedVersion: number) {
  assertVersionedWriteApplied(
    'schedule_plan',
    snapshot.plan.version === expectedVersion ? 1 : 0,
    expectedVersion
  );
  if (snapshot.plan.status !== 'draft')
    throwServerError({
      trpcCode: 'CONFLICT',
      errorCode: 'SCHEDULE_PLAN_STATE_INVALID',
      message: 'Only a draft schedule can be changed or published',
    });
}
function usersIn(snapshot: SchedulePlanSnapshot) {
  return [
    ...snapshot.plan.rules.map(rule => rule.userId),
    ...snapshot.occurrences.map(row => row.userId),
  ];
}
async function expand(input: CreateSchedulePlanInput['recurrence'], timeZone: string) {
  try {
    return await expandScheduleRecurrence(input, timeZone);
  } catch (error) {
    if (error instanceof ScheduleRecurrenceError)
      throwServerError({
        trpcCode: 'BAD_REQUEST',
        errorCode: 'SCHEDULE_RECURRENCE_INVALID',
        message: 'The recurring schedule cannot form a complete valid draft',
      });
    throw error;
  }
}
function insertOccurrences(
  tx: DatabaseInstance,
  ctx: WorkforceCommandContext,
  planId: string,
  rows: ScheduleOccurrence[]
) {
  for (const row of rows) {
    tx.insert(employeeScheduleOccurrences)
      .values({
        id: nanoid(),
        tenantId: ctx.tenantId,
        planId,
        ruleId: row.ruleId,
        userId: row.userId,
        startDate: row.startDate,
        startTime: row.startTime,
        endDate: row.endDate,
        endTime: row.endTime,
        startsAt: row.startsAt,
        endsAt: row.endsAt,
        notes: row.notes,
      })
      .run();
  }
}
function record(
  tx: DatabaseInstance,
  ctx: WorkforceCommandContext,
  snapshot: SchedulePlanSnapshot,
  kind: typeof employeeSchedulePlanEvents.$inferInsert.kind,
  reason: string | null
) {
  const { plan } = snapshot;
  tx.insert(employeeSchedulePlanEvents)
    .values({
      id: nanoid(),
      tenantId: ctx.tenantId,
      planId: plan.id,
      version: plan.version,
      kind,
      actorId: ctx.user.id,
      operationId: ctx.envelope.operationId,
      reason,
      snapshot,
      createdAt: plan.updatedAt,
    })
    .run();
  const result = {
    id: plan.id,
    version: plan.version,
    status: plan.status,
    occurrenceCount: plan.occurrenceCount,
  };
  writeAuditLog({
    tx,
    tenantId: ctx.tenantId,
    actorId: ctx.user.id,
    operationId: ctx.envelope.operationId,
    action: 'schedule_plan.changed',
    resourceType: 'schedule_plan',
    resourceId: plan.id,
    before: null,
    after: result,
  });
  enqueueSyncInTransaction(
    { db: tx, tenantId: ctx.tenantId, deviceId: ctx.deviceId, envelope: ctx.envelope },
    {
      entityType: 'employee_schedule_plans',
      entityId: plan.id,
      operation: kind === 'created' ? 'create' : 'update',
      data: result,
    }
  );
  ctx.completeInTransaction(tx, result);
  return result;
}
export async function createSchedulePlan(
  ctx: WorkforceCommandContext,
  value: CreateSchedulePlanInput
) {
  const input = createSchedulePlanInput.parse(value);
  const clock = await resolveTenantBusinessClock(ctx.db, ctx.tenantId);
  assertSchedulePlanTargets(
    ctx.db,
    ctx.tenantId,
    ctx.user.role,
    input.recurrence.siteId,
    input.recurrence.rules.map(rule => rule.userId),
    true
  );
  const rows = await expand(input.recurrence, clock.timezone);
  return withWorkforceWriter(
    ctx,
    tx => {
      assertSchedulePlanTargets(
        tx,
        ctx.tenantId,
        ctx.user.role,
        input.recurrence.siteId,
        input.recurrence.rules.map(rule => rule.userId),
        true
      );
      const id = nanoid(),
        now = new Date().toISOString();
      tx.insert(employeeSchedulePlans)
        .values({
          id,
          tenantId: ctx.tenantId,
          title: input.title,
          ...input.recurrence,
          timeZone: clock.timezone,
          occurrenceCount: rows.length,
          createdByUserId: ctx.user.id,
          updatedByUserId: ctx.user.id,
          createdAt: now,
          updatedAt: now,
        })
        .run();
      insertOccurrences(tx, ctx, id, rows);
      return record(tx, ctx, getSchedulePlan(tx, ctx.tenantId, ctx.user.role, id), 'created', null);
    },
    clock
  );
}
export async function regenerateSchedulePlan(
  ctx: WorkforceCommandContext,
  value: RegenerateSchedulePlanInput
) {
  const input = regenerateSchedulePlanInput.parse(value),
    clock = await resolveTenantBusinessClock(ctx.db, ctx.tenantId);
  const before = getSchedulePlan(ctx.db, ctx.tenantId, ctx.user.role, input.id);
  assertDraft(before, input.expectedVersion);
  const digest = schedulePlanDigest(before);
  assertSchedulePlanTargets(
    ctx.db,
    ctx.tenantId,
    ctx.user.role,
    input.recurrence.siteId,
    input.recurrence.rules.map(rule => rule.userId),
    true
  );
  // Regeneration is explicit but preserves the plan's frozen zone, never the host zone.
  const rows = await expand(input.recurrence, before.plan.timeZone);
  return withWorkforceWriter(
    ctx,
    tx => {
      const current = getSchedulePlan(tx, ctx.tenantId, ctx.user.role, input.id);
      assertDraft(current, input.expectedVersion);
      if (schedulePlanDigest(current) !== digest) schedulePlanChanged();
      assertSchedulePlanTargets(
        tx,
        ctx.tenantId,
        ctx.user.role,
        input.recurrence.siteId,
        input.recurrence.rules.map(rule => rule.userId),
        true
      );
      tx.delete(employeeScheduleOccurrences)
        .where(
          and(
            eq(employeeScheduleOccurrences.tenantId, ctx.tenantId),
            eq(employeeScheduleOccurrences.planId, input.id)
          )
        )
        .run();
      const updated = tx
        .update(employeeSchedulePlans)
        .set({
          title: input.title,
          ...input.recurrence,
          occurrenceCount: rows.length,
          version: input.expectedVersion + 1,
          updatedAt: new Date().toISOString(),
          updatedByUserId: ctx.user.id,
        })
        .where(
          and(
            eq(employeeSchedulePlans.tenantId, ctx.tenantId),
            eq(employeeSchedulePlans.id, input.id),
            eq(employeeSchedulePlans.status, 'draft'),
            eq(employeeSchedulePlans.version, input.expectedVersion)
          )
        )
        .run();
      assertVersionedWriteApplied('schedule_plan', updated.changes, input.expectedVersion);
      insertOccurrences(tx, ctx, input.id, rows);
      return record(
        tx,
        ctx,
        getSchedulePlan(tx, ctx.tenantId, ctx.user.role, input.id),
        'regenerated',
        input.reason
      );
    },
    clock
  );
}
export async function discardSchedulePlan(
  ctx: WorkforceCommandContext,
  value: DiscardSchedulePlanInput
) {
  const input = discardSchedulePlanInput.parse(value);
  return withWorkforceWriter(ctx, tx => {
    const current = getSchedulePlan(tx, ctx.tenantId, ctx.user.role, input.id);
    assertDraft(current, input.expectedVersion);
    const now = new Date().toISOString();
    const updated = tx
      .update(employeeSchedulePlans)
      .set({
        status: 'discarded',
        version: input.expectedVersion + 1,
        decidedAt: now,
        updatedAt: now,
        updatedByUserId: ctx.user.id,
      })
      .where(
        and(
          eq(employeeSchedulePlans.tenantId, ctx.tenantId),
          eq(employeeSchedulePlans.id, input.id),
          eq(employeeSchedulePlans.version, input.expectedVersion),
          eq(employeeSchedulePlans.status, 'draft')
        )
      )
      .run();
    assertVersionedWriteApplied('schedule_plan', updated.changes, input.expectedVersion);
    return record(
      tx,
      ctx,
      getSchedulePlan(tx, ctx.tenantId, ctx.user.role, input.id),
      'discarded',
      input.reason
    );
  });
}
export async function publishSchedulePlan(
  ctx: WorkforceCommandContext,
  value: DecideSchedulePlanInput
) {
  const input = decideSchedulePlanInput.parse(value),
    clock = await resolveTenantBusinessClock(ctx.db, ctx.tenantId);
  const before = getSchedulePlan(ctx.db, ctx.tenantId, ctx.user.role, input.id);
  assertDraft(before, input.expectedVersion);
  assertSchedulePlanTargets(
    ctx.db,
    ctx.tenantId,
    ctx.user.role,
    before.plan.siteId,
    usersIn(before),
    true
  );
  const digest = schedulePlanDigest(before),
    policies = await preflightSchedulePlan(ctx.db, before);
  return withWorkforceWriter(
    ctx,
    tx => {
      const current = getSchedulePlan(tx, ctx.tenantId, ctx.user.role, input.id);
      assertDraft(current, input.expectedVersion);
      if (schedulePlanDigest(current) !== digest) schedulePlanChanged();
      assertSchedulePlanTargets(
        tx,
        ctx.tenantId,
        ctx.user.role,
        current.plan.siteId,
        usersIn(current),
        true
      );
      assertSchedulePlanPreflightCurrent(tx, current, policies);
      const now = new Date().toISOString();
      for (const row of current.occurrences) {
        const shiftId = nanoid();
        tx.insert(scheduledShifts)
          .values({
            id: shiftId,
            tenantId: ctx.tenantId,
            userId: row.userId,
            siteId: current.plan.siteId,
            startsAt: row.startsAt,
            endsAt: row.endsAt,
            timeZone: current.plan.timeZone,
            notes: row.notes,
            createdByUserId: ctx.user.id,
            updatedByUserId: ctx.user.id,
            createdAt: now,
            updatedAt: now,
          })
          .run();
        tx.update(employeeScheduleOccurrences)
          .set({ publishedShiftId: shiftId })
          .where(
            and(
              eq(employeeScheduleOccurrences.tenantId, ctx.tenantId),
              eq(employeeScheduleOccurrences.id, row.id),
              eq(employeeScheduleOccurrences.planId, input.id)
            )
          )
          .run();
        enqueueSyncInTransaction(
          { db: tx, tenantId: ctx.tenantId, deviceId: ctx.deviceId, envelope: ctx.envelope },
          {
            entityType: 'scheduled_shifts',
            entityId: shiftId,
            operation: 'create',
            data: { id: shiftId, siteId: current.plan.siteId, version: 1, status: 'scheduled' },
          }
        );
      }
      const updated = tx
        .update(employeeSchedulePlans)
        .set({
          status: 'published',
          version: input.expectedVersion + 1,
          decidedAt: now,
          updatedAt: now,
          updatedByUserId: ctx.user.id,
        })
        .where(
          and(
            eq(employeeSchedulePlans.tenantId, ctx.tenantId),
            eq(employeeSchedulePlans.id, input.id),
            eq(employeeSchedulePlans.version, input.expectedVersion),
            eq(employeeSchedulePlans.status, 'draft')
          )
        )
        .run();
      assertVersionedWriteApplied('schedule_plan', updated.changes, input.expectedVersion);
      return record(
        tx,
        ctx,
        getSchedulePlan(tx, ctx.tenantId, ctx.user.role, input.id),
        'published',
        null
      );
    },
    clock
  );
}
