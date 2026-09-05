/** Explicit availability changes and private immutable evidence share command completion. */
import { and, eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import type { DatabaseInstance } from '../../db/index.js';
import {
  employeeAvailability,
  employeeAvailabilityEvents,
  users,
  type EmployeeAvailabilityRow,
  type AvailabilitySnapshot,
} from '../../db/schema.js';
import { throwServerError } from '../../lib/errorCodes.js';
import { assertVersionedWriteApplied } from '../../lib/optimisticVersion.js';
import { writeAuditLog } from '../../services/audit-logs.js';
import { enqueueSyncInTransaction } from '../../services/sync/enqueue.js';
import { managerCanTarget } from '../../services/labor/scheduled-shift-policy.js';
import {
  resolveAvailabilityWindow,
  type AvailabilityWindow,
} from '../../services/labor/availability.js';
import {
  assertNoAvailabilityOverlap,
  preflightAvailability,
  assertAvailabilityPreflightCurrent,
} from '../../services/labor/availability-conflicts.js';
import { resolveTenantBusinessClock } from '../../services/pharmacy/business-clock.js';
import {
  createAvailabilityInput,
  replaceAvailabilityInput,
  voidAvailabilityInput,
  type CreateAvailabilityInput,
  type ReplaceAvailabilityInput,
  type VoidAvailabilityInput,
} from '../../trpc/schemas/availability.js';
import { withWorkforceWriter, type WorkforceCommandContext } from './writer.js';

export function availabilityNotFound(): never {
  throwServerError({
    trpcCode: 'NOT_FOUND',
    errorCode: 'AVAILABILITY_NOT_FOUND',
    message: 'The availability policy or employee is not available',
  });
}
function target(
  db: DatabaseInstance,
  ctx: WorkforceCommandContext,
  userId: string,
  activeOnly = true
) {
  const employee = db
    .select({ role: users.role })
    .from(users)
    .where(
      and(
        eq(users.tenantId, ctx.tenantId),
        eq(users.id, userId),
        ...(activeOnly ? [eq(users.isActive, true)] : [])
      )
    )
    .get();
  if (!employee || !managerCanTarget(ctx.user.role, employee.role)) availabilityNotFound();
}
function get(
  db: DatabaseInstance,
  ctx: WorkforceCommandContext,
  id: string,
  expectedVersion: number,
  activeOnly = true
): EmployeeAvailabilityRow {
  const row = db
    .select()
    .from(employeeAvailability)
    .where(and(eq(employeeAvailability.tenantId, ctx.tenantId), eq(employeeAvailability.id, id)))
    .get();
  if (!row) availabilityNotFound();
  target(db, ctx, row.userId, activeOnly);
  assertVersionedWriteApplied(
    'availability',
    row.version === expectedVersion ? 1 : 0,
    expectedVersion
  );
  if (row.status !== 'active')
    throwServerError({
      trpcCode: 'CONFLICT',
      errorCode: 'AVAILABILITY_STATE_INVALID',
      message: 'The availability policy is no longer active',
    });
  return row;
}
function window(period: { fromDate: string; untilDate: string | null }, timeZone: string) {
  try {
    return resolveAvailabilityWindow(
      { fromDate: period.fromDate, untilDate: period.untilDate },
      timeZone
    );
  } catch {
    throwServerError({
      trpcCode: 'BAD_REQUEST',
      errorCode: 'AVAILABILITY_WINDOW_INVALID',
      message: 'The availability dates do not form a valid business period',
    });
  }
}
function snapshot(row: EmployeeAvailabilityRow): AvailabilitySnapshot {
  const {
    userId,
    status,
    version,
    replacesId,
    fromDate,
    untilDate,
    startsAt,
    endsAt,
    timeZone,
    slots,
  } = row;
  return {
    userId,
    status,
    version,
    replacesId,
    fromDate,
    untilDate,
    startsAt,
    endsAt,
    timeZone,
    slots,
  };
}
function record(
  tx: DatabaseInstance,
  ctx: WorkforceCommandContext,
  row: EmployeeAvailabilityRow,
  before: EmployeeAvailabilityRow | null,
  kind: typeof employeeAvailabilityEvents.$inferInsert.kind,
  reason: string
) {
  tx.insert(employeeAvailabilityEvents)
    .values({
      id: nanoid(),
      tenantId: ctx.tenantId,
      availabilityId: row.id,
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
  const result = { id: row.id, version: row.version, status: row.status };
  writeAuditLog({
    tx,
    tenantId: ctx.tenantId,
    actorId: ctx.user.id,
    operationId: ctx.envelope.operationId,
    action: 'availability.changed',
    resourceType: 'availability',
    resourceId: row.id,
    before: before ? { version: before.version } : null,
    after: result,
  });
  enqueueSyncInTransaction(
    { db: tx, tenantId: ctx.tenantId, deviceId: ctx.deviceId, envelope: ctx.envelope },
    {
      entityType: 'employee_availability',
      entityId: row.id,
      operation: before ? 'update' : 'create',
      data: result,
    }
  );
  return result;
}
function insert(
  tx: DatabaseInstance,
  ctx: WorkforceCommandContext,
  userId: string,
  period: AvailabilityWindow,
  slots: CreateAvailabilityInput['slots'],
  replacesId: string | null
) {
  return tx
    .insert(employeeAvailability)
    .values({
      id: nanoid(),
      tenantId: ctx.tenantId,
      userId,
      ...period,
      slots: [...slots].sort((a, b) => a.weekday - b.weekday || a.startMinute - b.startMinute),
      replacesId,
      createdByUserId: ctx.user.id,
      updatedByUserId: ctx.user.id,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    })
    .returning()
    .get();
}
export async function createAvailability(
  ctx: WorkforceCommandContext,
  value: CreateAvailabilityInput
) {
  const input = createAvailabilityInput.parse(value),
    clock = await resolveTenantBusinessClock(ctx.db, ctx.tenantId);
  target(ctx.db, ctx, input.userId);
  const period = window(input, clock.timezone);
  assertNoAvailabilityOverlap(ctx.db, { tenantId: ctx.tenantId, userId: input.userId, ...period });
  const fingerprint = await preflightAvailability(ctx.db, ctx.tenantId, input.userId, {
    ...period,
    slots: input.slots,
  });
  return withWorkforceWriter(
    ctx,
    tx => {
      target(tx, ctx, input.userId);
      assertNoAvailabilityOverlap(tx, { tenantId: ctx.tenantId, userId: input.userId, ...period });
      assertAvailabilityPreflightCurrent(tx, ctx.tenantId, input.userId, period, fingerprint);
      const row = insert(tx, ctx, input.userId, period, input.slots, null),
        result = record(tx, ctx, row, null, 'created', input.reason);
      ctx.completeInTransaction(tx, result);
      return result;
    },
    clock
  );
}
export async function replaceAvailability(
  ctx: WorkforceCommandContext,
  value: ReplaceAvailabilityInput
) {
  const input = replaceAvailabilityInput.parse(value),
    clock = await resolveTenantBusinessClock(ctx.db, ctx.tenantId);
  const original = get(ctx.db, ctx, input.id, input.expectedVersion);
  if (
    input.fromDate <= original.fromDate ||
    (original.untilDate !== null && input.fromDate >= original.untilDate)
  )
    throwServerError({
      trpcCode: 'BAD_REQUEST',
      errorCode: 'AVAILABILITY_WINDOW_INVALID',
      message: 'The successor must begin strictly inside the original policy period',
    });
  // A replacement is a split, not a timezone reinterpretation of an existing agreement.
  const period = window(
    { fromDate: input.fromDate, untilDate: original.untilDate },
    original.timeZone
  );
  const fingerprint = await preflightAvailability(ctx.db, ctx.tenantId, original.userId, {
    ...period,
    slots: input.slots,
  });
  return withWorkforceWriter(
    ctx,
    tx => {
      const current = get(tx, ctx, input.id, input.expectedVersion);
      assertNoAvailabilityOverlap(
        tx,
        { tenantId: ctx.tenantId, userId: current.userId, ...period },
        current.id
      );
      assertAvailabilityPreflightCurrent(tx, ctx.tenantId, current.userId, period, fingerprint);
      const ended = tx
        .update(employeeAvailability)
        .set({
          untilDate: input.fromDate,
          endsAt: period.startsAt,
          version: input.expectedVersion + 1,
          updatedAt: new Date().toISOString(),
          updatedByUserId: ctx.user.id,
        })
        .where(
          and(
            eq(employeeAvailability.tenantId, ctx.tenantId),
            eq(employeeAvailability.id, current.id),
            eq(employeeAvailability.version, input.expectedVersion),
            eq(employeeAvailability.status, 'active')
          )
        )
        .returning()
        .get();
      assertVersionedWriteApplied('availability', ended ? 1 : 0, input.expectedVersion);
      const previous = record(tx, ctx, ended!, current, 'ended', input.reason);
      const successor = insert(tx, ctx, current.userId, period, input.slots, current.id);
      const result = { ...record(tx, ctx, successor, null, 'created', input.reason), previous };
      ctx.completeInTransaction(tx, result);
      return result;
    },
    clock
  );
}
export async function voidAvailability(ctx: WorkforceCommandContext, value: VoidAvailabilityInput) {
  const input = voidAvailabilityInput.parse(value);
  return withWorkforceWriter(ctx, tx => {
    const before = get(tx, ctx, input.id, input.expectedVersion, false);
    const row = tx
      .update(employeeAvailability)
      .set({
        status: 'voided',
        version: input.expectedVersion + 1,
        updatedAt: new Date().toISOString(),
        updatedByUserId: ctx.user.id,
      })
      .where(
        and(
          eq(employeeAvailability.tenantId, ctx.tenantId),
          eq(employeeAvailability.id, before.id),
          eq(employeeAvailability.version, input.expectedVersion),
          eq(employeeAvailability.status, 'active')
        )
      )
      .returning()
      .get();
    assertVersionedWriteApplied('availability', row ? 1 : 0, input.expectedVersion);
    const result = record(tx, ctx, row!, before, 'voided', input.reason);
    ctx.completeInTransaction(tx, result);
    return result;
  });
}
