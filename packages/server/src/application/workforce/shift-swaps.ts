/** Explicit consent and replacement lineage are committed with the command result in one writer. */
import { and, eq, inArray } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import type { DatabaseInstance } from '../../db/index.js';
import {
  employeeShiftSwapClaims,
  employeeShiftSwapEvents,
  employeeShiftSwaps,
  scheduledShifts,
  type EmployeeShiftSwap,
  type ScheduledShift,
} from '../../db/schema.js';
import { assertVersionedWriteApplied } from '../../lib/optimisticVersion.js';
import { throwServerError } from '../../lib/errorCodes.js';
import { writeAuditLog } from '../../services/audit-logs.js';
import { enqueueSyncInTransaction } from '../../services/sync/enqueue.js';
import {
  assertSwappable,
  assertSwapAssignment,
  canManageSwap,
  currentSwapPair,
  getSwap,
  getSwapShift,
  shiftIntent,
  swapChanged,
  swapEmployee,
  swapNotFound,
  swapStateInvalid,
} from '../../services/labor/shift-swap-policy.js';
import {
  advanceShiftSwapInput,
  createShiftSwapInput,
  type AdvanceShiftSwapInput,
  type CreateShiftSwapInput,
} from '../../trpc/schemas/shiftSwaps.js';
import { withEmployeeWriter, type WorkforceCommandContext } from './writer.js';

function record(
  tx: DatabaseInstance,
  ctx: WorkforceCommandContext,
  row: EmployeeShiftSwap,
  reason: string | null
) {
  tx.insert(employeeShiftSwapEvents)
    .values({
      id: nanoid(),
      tenantId: ctx.tenantId,
      requestId: row.id,
      version: row.version,
      status: row.status,
      actorId: ctx.user.id,
      operationId: ctx.envelope.operationId,
      reason,
      snapshot: row,
      createdAt: row.updatedAt,
    })
    .run();
  const result = { id: row.id, version: row.version, status: row.status };
  writeAuditLog({
    tx,
    tenantId: ctx.tenantId,
    actorId: ctx.user.id,
    operationId: ctx.envelope.operationId,
    action: 'shift_swap.changed',
    resourceType: 'shift_swap',
    resourceId: row.id,
    before: null,
    after: result,
  });
  enqueueSyncInTransaction(
    { db: tx, tenantId: ctx.tenantId, deviceId: ctx.deviceId, envelope: ctx.envelope },
    {
      entityType: 'employee_shift_swaps',
      entityId: row.id,
      operation: row.version === 1 ? 'create' : 'update',
      data: result,
    }
  );
  ctx.completeInTransaction(tx, result);
  return result;
}
function assertClaims(tx: DatabaseInstance, tenantId: string, row: EmployeeShiftSwap): void {
  const claims = tx
    .select({ shiftId: employeeShiftSwapClaims.shiftId })
    .from(employeeShiftSwapClaims)
    .where(
      and(
        eq(employeeShiftSwapClaims.tenantId, tenantId),
        eq(employeeShiftSwapClaims.requestId, row.id)
      )
    )
    .all();
  if (
    claims.length !== 2 ||
    ![row.offeredShiftId, row.requestedShiftId].every(id => claims.some(c => c.shiftId === id))
  )
    swapChanged();
}
export async function createShiftSwap(ctx: WorkforceCommandContext, value: CreateShiftSwapInput) {
  const input = createShiftSwapInput.parse(value);
  return withEmployeeWriter(ctx, tx => {
    const now = new Date().toISOString(),
      offered = getSwapShift(tx, ctx.tenantId, input.offeredShiftId),
      requested = getSwapShift(tx, ctx.tenantId, input.requestedShiftId);
    if (offered.userId !== ctx.user.id || requested.userId === ctx.user.id) swapNotFound();
    // Non-administrators cannot discover or request an administrator's assignment.
    if (
      ctx.user.role !== 'admin' &&
      swapEmployee(tx, ctx.tenantId, requested.userId).role === 'admin'
    )
      swapNotFound();
    assertSwappable(tx, ctx.tenantId, offered, now);
    assertSwappable(tx, ctx.tenantId, requested, now);
    if (offered.version !== input.offeredVersion || requested.version !== input.requestedVersion)
      swapChanged();
    const claimed = tx
      .select({ shiftId: employeeShiftSwapClaims.shiftId })
      .from(employeeShiftSwapClaims)
      .where(
        and(
          eq(employeeShiftSwapClaims.tenantId, ctx.tenantId),
          inArray(employeeShiftSwapClaims.shiftId, [offered.id, requested.id])
        )
      )
      .get();
    if (claimed)
      throwServerError({
        trpcCode: 'CONFLICT',
        errorCode: 'SHIFT_SWAP_CLAIMED',
        message: 'One of the shifts already has an active exchange request',
      });
    const id = nanoid();
    tx.insert(employeeShiftSwaps)
      .values({
        id,
        tenantId: ctx.tenantId,
        requesterId: offered.userId,
        recipientId: requested.userId,
        offeredShiftId: offered.id,
        requestedShiftId: requested.id,
        intent: { offered: shiftIntent(offered), requested: shiftIntent(requested) },
        updatedByUserId: ctx.user.id,
        createdAt: now,
        updatedAt: now,
      })
      .run();
    tx.insert(employeeShiftSwapClaims)
      .values(
        [offered.id, requested.id].map(shiftId => ({
          tenantId: ctx.tenantId,
          shiftId,
          requestId: id,
        }))
      )
      .run();
    return record(tx, ctx, getSwap(tx, ctx.tenantId, id), input.reason);
  });
}
function replaceShift(
  tx: DatabaseInstance,
  ctx: WorkforceCommandContext,
  original: ScheduledShift,
  userId: string,
  now: string
) {
  const id = nanoid();
  tx.insert(scheduledShifts)
    .values({
      id,
      tenantId: ctx.tenantId,
      userId,
      siteId: original.siteId,
      startsAt: original.startsAt,
      endsAt: original.endsAt,
      timeZone: original.timeZone,
      notes: original.notes,
      createdByUserId: ctx.user.id,
      updatedByUserId: ctx.user.id,
      createdAt: now,
      updatedAt: now,
    })
    .run();
  enqueueSyncInTransaction(
    { db: tx, tenantId: ctx.tenantId, deviceId: ctx.deviceId, envelope: ctx.envelope },
    {
      entityType: 'scheduled_shifts',
      entityId: id,
      operation: 'create',
      data: { id, siteId: original.siteId, status: 'scheduled', version: 1 },
    }
  );
  return id;
}
function approve(
  tx: DatabaseInstance,
  ctx: WorkforceCommandContext,
  row: EmployeeShiftSwap,
  now: string
) {
  const { offered, requested } = currentSwapPair(tx, ctx.tenantId, row, now),
    ids = [offered.id, requested.id];
  assertSwapAssignment(tx, ctx.tenantId, requested.userId, offered, ids);
  assertSwapAssignment(tx, ctx.tenantId, offered.userId, requested, ids);
  // Cancelling both before inserting replacements preserves per-row overlap triggers without a gap outside this writer.
  for (const shift of [offered, requested]) {
    const result = tx
      .update(scheduledShifts)
      .set({
        status: 'cancelled',
        cancelledAt: now,
        cancelledByUserId: ctx.user.id,
        updatedByUserId: ctx.user.id,
        updatedAt: now,
        version: shift.version + 1,
      })
      .where(
        and(
          eq(scheduledShifts.tenantId, ctx.tenantId),
          eq(scheduledShifts.id, shift.id),
          eq(scheduledShifts.version, shift.version),
          eq(scheduledShifts.status, 'scheduled')
        )
      )
      .run();
    assertVersionedWriteApplied('scheduledShift', result.changes, shift.version);
    enqueueSyncInTransaction(
      { db: tx, tenantId: ctx.tenantId, deviceId: ctx.deviceId, envelope: ctx.envelope },
      {
        entityType: 'scheduled_shifts',
        entityId: shift.id,
        operation: 'update',
        data: {
          id: shift.id,
          siteId: shift.siteId,
          status: 'cancelled',
          version: shift.version + 1,
        },
      }
    );
  }
  return {
    offeredReplacementId: replaceShift(tx, ctx, offered, requested.userId, now),
    requestedReplacementId: replaceShift(tx, ctx, requested, offered.userId, now),
  };
}
export async function advanceShiftSwap(ctx: WorkforceCommandContext, value: AdvanceShiftSwapInput) {
  const input = advanceShiftSwapInput.parse(value);
  return withEmployeeWriter(ctx, tx => {
    const row = getSwap(tx, ctx.tenantId, input.id),
      participant = [row.requesterId, row.recipientId].includes(ctx.user.id),
      manager = canManageSwap(tx, ctx.tenantId, ctx.user.role, row);
    if (!participant && !manager) swapNotFound();
    assertVersionedWriteApplied(
      'shift_swap',
      row.version === input.expectedVersion ? 1 : 0,
      input.expectedVersion
    );
    if (!['requested', 'accepted'].includes(row.status)) swapStateInvalid();
    if (
      input.status === 'accepted' &&
      (ctx.user.id !== row.recipientId || row.status !== 'requested')
    )
      swapStateInvalid();
    if (
      input.status === 'cancelled' &&
      !(
        ctx.user.id === row.requesterId ||
        (ctx.user.id === row.recipientId && row.status === 'accepted')
      )
    )
      swapStateInvalid();
    if (input.status === 'approved' && (!manager || participant || row.status !== 'accepted'))
      swapStateInvalid();
    if (
      input.status === 'rejected' &&
      !(manager || (ctx.user.id === row.recipientId && row.status === 'requested'))
    )
      swapStateInvalid();
    const now = new Date().toISOString();
    let replacements = {};
    if (input.status === 'accepted' || input.status === 'approved') {
      assertClaims(tx, ctx.tenantId, row);
      if (input.status === 'accepted') currentSwapPair(tx, ctx.tenantId, row, now);
      if (input.status === 'approved') replacements = approve(tx, ctx, row, now);
    }
    // Cleanup deliberately does not demand active sites/participants or unchanged shifts.
    const updated = tx
      .update(employeeShiftSwaps)
      .set({
        ...replacements,
        status: input.status,
        version: input.expectedVersion + 1,
        updatedAt: now,
        updatedByUserId: ctx.user.id,
      })
      .where(
        and(
          eq(employeeShiftSwaps.tenantId, ctx.tenantId),
          eq(employeeShiftSwaps.id, row.id),
          eq(employeeShiftSwaps.version, input.expectedVersion),
          eq(employeeShiftSwaps.status, row.status)
        )
      )
      .run();
    assertVersionedWriteApplied('shift_swap', updated.changes, input.expectedVersion);
    if (input.status !== 'accepted')
      tx.delete(employeeShiftSwapClaims)
        .where(
          and(
            eq(employeeShiftSwapClaims.tenantId, ctx.tenantId),
            eq(employeeShiftSwapClaims.requestId, row.id)
          )
        )
        .run();
    return record(
      tx,
      ctx,
      getSwap(tx, ctx.tenantId, row.id),
      'reason' in input ? input.reason : null
    );
  });
}
