/** Explicit time-off decisions, private evidence and completion share one synchronous writer. */
import { and, eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import type { DatabaseInstance } from '../../db/index.js';
import {
  employeeTimeOff,
  employeeTimeOffEvents,
  sites,
  users,
  type EmployeeTimeOffRow,
  type TimeOffSnapshot,
} from '../../db/schema.js';
import { throwServerError } from '../../lib/errorCodes.js';
import { assertVersionedWriteApplied } from '../../lib/optimisticVersion.js';
import { managerCanTarget } from '../../services/labor/scheduled-shift-policy.js';
import { canAdvanceTimeOff, resolveTimeOffWindow } from '../../services/labor/time-off.js';
import {
  assertNoActiveTimeOff,
  assertNoScheduledShiftDuringTimeOff,
} from '../../services/labor/time-off-conflicts.js';
import { withWorkforceWriter } from './writer.js';
import { writeAuditLog } from '../../services/audit-logs.js';
import { enqueueSyncInTransaction } from '../../services/sync/enqueue.js';
import type { CriticalCommandContext } from '../../trpc/middleware/commandEnvelope.js';
import {
  createTimeOffInput,
  advanceTimeOffInput,
  type CreateTimeOffInput,
  type AdvanceTimeOffInput,
} from '../../trpc/schemas/timeOff.js';

/** Capability provided only after role authorization, device identity and command reservation. */
export type TimeOffCommandContext = Pick<
  CriticalCommandContext,
  'db' | 'tenantId' | 'user' | 'deviceId' | 'envelope' | 'completeInTransaction'
>;

function notFound(): never {
  throwServerError({
    trpcCode: 'NOT_FOUND',
    errorCode: 'TIME_OFF_NOT_FOUND',
    message: 'The time-off request, employee or site is not available',
  });
}

function assertTarget(
  tx: DatabaseInstance,
  ctx: TimeOffCommandContext,
  target: { userId: string; siteId: string },
  activeOnly: boolean
) {
  const user = tx
    .select({ role: users.role })
    .from(users)
    .where(
      and(
        eq(users.tenantId, ctx.tenantId),
        eq(users.id, target.userId),
        ...(activeOnly ? [eq(users.isActive, true)] : [])
      )
    )
    .get();
  const site = tx
    .select({ id: sites.id })
    .from(sites)
    .where(
      and(
        eq(sites.tenantId, ctx.tenantId),
        eq(sites.id, target.siteId),
        ...(activeOnly ? [eq(sites.isActive, true)] : [])
      )
    )
    .get();
  if (!user || !site || !managerCanTarget(ctx.user.role, user.role)) notFound();
}

function snapshot(row: EmployeeTimeOffRow): TimeOffSnapshot {
  return {
    userId: row.userId,
    siteId: row.siteId,
    kind: row.kind,
    status: row.status,
    fromDate: row.fromDate,
    untilDate: row.untilDate,
    startsAt: row.startsAt,
    endsAt: row.endsAt,
    timeZone: row.timeZone,
    version: row.version,
    approvedByUserId: row.approvedByUserId,
    approvedAt: row.approvedAt,
  };
}

function finish(
  tx: DatabaseInstance,
  ctx: TimeOffCommandContext,
  id: string,
  before: EmployeeTimeOffRow | null,
  kind: typeof employeeTimeOffEvents.$inferInsert.kind,
  reason: string
) {
  const row = tx
    .select()
    .from(employeeTimeOff)
    .where(and(eq(employeeTimeOff.tenantId, ctx.tenantId), eq(employeeTimeOff.id, id)))
    .get();
  if (!row) notFound();
  tx.insert(employeeTimeOffEvents)
    .values({
      id: nanoid(),
      tenantId: ctx.tenantId,
      siteId: row.siteId,
      requestId: row.id,
      version: row.version,
      kind,
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
    action: 'time_off.changed',
    resourceType: 'time_off',
    resourceId: row.id,
    before: before ? { version: before.version } : null,
    after: { version: row.version, siteId: row.siteId, status: row.status },
  });
  // Do not place the absence classification, dates or explanation in generic transports.
  const result = { id: row.id, siteId: row.siteId, version: row.version, status: row.status };
  enqueueSyncInTransaction(
    { db: tx, tenantId: ctx.tenantId, deviceId: ctx.deviceId, envelope: ctx.envelope },
    {
      entityType: 'employee_time_off',
      entityId: row.id,
      operation: before ? 'update' : 'create',
      data: result,
    }
  );
  ctx.completeInTransaction(tx, result);
  return result;
}

export async function createTimeOff(ctx: TimeOffCommandContext, value: CreateTimeOffInput) {
  const input = createTimeOffInput.parse(value);
  return withWorkforceWriter(ctx, (tx, timeZone) => {
    assertTarget(tx, ctx, input, true);
    let window;
    try {
      window = resolveTimeOffWindow(
        { fromDate: input.fromDate, untilDate: input.untilDate },
        timeZone
      );
    } catch {
      throwServerError({
        trpcCode: 'BAD_REQUEST',
        errorCode: 'TIME_OFF_WINDOW_INVALID',
        message: 'The time-off dates are not valid in the business timezone',
      });
    }
    assertNoActiveTimeOff(tx, { tenantId: ctx.tenantId, userId: input.userId, ...window });
    const id = nanoid(),
      now = new Date().toISOString();
    tx.insert(employeeTimeOff)
      .values({
        id,
        tenantId: ctx.tenantId,
        userId: input.userId,
        siteId: input.siteId,
        kind: input.kind,
        status: 'pending',
        ...window,
        version: 1,
        createdByUserId: ctx.user.id,
        updatedByUserId: ctx.user.id,
        createdAt: now,
        updatedAt: now,
      })
      .run();
    return finish(tx, ctx, id, null, 'requested', input.reason);
  });
}

export async function advanceTimeOff(ctx: TimeOffCommandContext, value: AdvanceTimeOffInput) {
  const input = advanceTimeOffInput.parse(value);
  return withWorkforceWriter(ctx, tx => {
    const row = tx
      .select()
      .from(employeeTimeOff)
      .where(
        and(
          eq(employeeTimeOff.tenantId, ctx.tenantId),
          eq(employeeTimeOff.siteId, input.siteId),
          eq(employeeTimeOff.id, input.id)
        )
      )
      .get();
    if (!row) notFound();
    assertTarget(tx, ctx, row, input.status === 'approved');
    assertVersionedWriteApplied(
      'timeOff',
      row.version === input.expectedVersion ? 1 : 0,
      input.expectedVersion
    );
    if (!canAdvanceTimeOff(row.status, input.status))
      throwServerError({
        trpcCode: 'CONFLICT',
        errorCode: 'TIME_OFF_STATE_INVALID',
        message: 'This time-off transition is not valid for the current request',
      });
    if (input.status === 'approved') {
      if (row.userId === ctx.user.id)
        throwServerError({
          trpcCode: 'FORBIDDEN',
          errorCode: 'TIME_OFF_SELF_APPROVAL',
          message: 'Another authorized person must approve your time off',
        });
      // The stored zone/instants are authoritative after locale changes; never reinterpret a request.
      assertNoActiveTimeOff(tx, row, row.id);
      assertNoScheduledShiftDuringTimeOff(tx, row);
    }
    const now = new Date().toISOString();
    const result = tx
      .update(employeeTimeOff)
      .set({
        status: input.status,
        version: input.expectedVersion + 1,
        updatedAt: now,
        updatedByUserId: ctx.user.id,
        ...(input.status === 'approved' ? { approvedAt: now, approvedByUserId: ctx.user.id } : {}),
      })
      .where(
        and(
          eq(employeeTimeOff.tenantId, ctx.tenantId),
          eq(employeeTimeOff.id, row.id),
          eq(employeeTimeOff.version, input.expectedVersion),
          eq(employeeTimeOff.status, row.status)
        )
      )
      .run();
    assertVersionedWriteApplied('timeOff', result.changes, input.expectedVersion);
    return finish(tx, ctx, row.id, row, input.status, input.reason);
  });
}
