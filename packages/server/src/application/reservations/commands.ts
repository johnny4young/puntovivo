/** Versioned, idempotent reservation commands; every effect commits with the completion fence. */
import { and, eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import type { DatabaseInstance } from '../../db/index.js';
import { restaurantReservations, sites, tenants, type ReservationRow } from '../../db/schema.js';
import { throwServerError } from '../../lib/errorCodes.js';
import { isModuleActiveInSettings } from '../../services/modules/manifest.js';
import type { CriticalCommandContext } from '../../trpc/middleware/commandEnvelope.js';
import type {
  AdvanceReservationInput,
  CreateReservationInput,
  UpdateReservationInput,
} from '../../trpc/schemas/reservations.js';
import {
  assertReservationSlot,
  assertReservationTableEmpty,
  findReservationHold,
  reservationError,
} from './invariants.js';
import { recordReservationEvidence } from './evidence.js';

function withReservation<T>(
  ctx: CriticalCommandContext,
  siteId: string,
  action: (tx: DatabaseInstance) => T
): T {
  return ctx.db.transaction(
    raw => {
      const tx = raw as unknown as DatabaseInstance;
      const site = tx
        .select({ id: sites.id })
        .from(sites)
        .where(
          and(eq(sites.tenantId, ctx.tenantId), eq(sites.id, siteId), eq(sites.isActive, true))
        )
        .get();
      if (!site) reservationError('missing');
      const tenant = tx
        .select({ settings: tenants.settings })
        .from(tenants)
        .where(eq(tenants.id, ctx.tenantId))
        .get();
      if (!tenant || !isModuleActiveInSettings(tenant.settings, 'dine-in'))
        throwServerError({
          trpcCode: 'FORBIDDEN',
          errorCode: 'MODULE_NOT_ACTIVATED',
          message: 'Dine-in is not active',
          details: { moduleId: 'dine-in' },
        });
      return action(tx);
    },
    { behavior: 'immediate' }
  );
}
function finish(
  ctx: CriticalCommandContext,
  tx: DatabaseInstance,
  row: ReservationRow,
  before: ReservationRow | null,
  kind: Parameters<typeof recordReservationEvidence>[4]
) {
  recordReservationEvidence(
    tx,
    {
      tenantId: ctx.tenantId,
      actorId: ctx.user.id,
      deviceId: ctx.deviceId,
      envelope: ctx.envelope,
    },
    row,
    before,
    kind
  );
  const result = { id: row.id, status: row.status, version: row.version };
  ctx.completeInTransaction(tx, result);
  return result;
}
function requireReservation(
  tx: DatabaseInstance,
  ctx: CriticalCommandContext,
  input: { id: string; siteId: string; expectedVersion: number }
) {
  const row = tx
    .select()
    .from(restaurantReservations)
    .where(
      and(
        eq(restaurantReservations.tenantId, ctx.tenantId),
        eq(restaurantReservations.siteId, input.siteId),
        eq(restaurantReservations.id, input.id)
      )
    )
    .get();
  if (!row) reservationError('missing');
  if (row.version !== input.expectedVersion) reservationError('version');
  return row;
}
function updateRow(tx: DatabaseInstance, before: ReservationRow, changes: Partial<ReservationRow>) {
  const row = tx
    .update(restaurantReservations)
    .set({ ...changes, version: before.version + 1, updatedAt: new Date().toISOString() })
    .where(
      and(
        eq(restaurantReservations.tenantId, before.tenantId),
        eq(restaurantReservations.siteId, before.siteId),
        eq(restaurantReservations.id, before.id),
        eq(restaurantReservations.version, before.version),
        eq(restaurantReservations.status, before.status)
      )
    )
    .returning()
    .get();
  if (!row) reservationError('version');
  return row;
}
export function createReservation(ctx: CriticalCommandContext, input: CreateReservationInput) {
  return withReservation(ctx, input.siteId, tx => {
    const now = new Date().toISOString();
    if (input.endsAt <= now) reservationError('state');
    const id = nanoid();
    assertReservationSlot(tx, ctx.tenantId, { ...input, id });
    const row = tx
      .insert(restaurantReservations)
      .values({ ...input, id, tenantId: ctx.tenantId, createdAt: now, updatedAt: now })
      .returning()
      .get()!;
    return finish(ctx, tx, row, null, 'created');
  });
}
export function updateReservation(ctx: CriticalCommandContext, input: UpdateReservationInput) {
  return withReservation(ctx, input.siteId, tx => {
    const before = requireReservation(tx, ctx, input);
    if (before.status !== 'booked' || input.endsAt <= new Date().toISOString())
      reservationError('state');
    assertReservationSlot(tx, ctx.tenantId, input);
    const row = updateRow(tx, before, {
      tableId: input.tableId,
      guestName: input.guestName,
      partySize: input.partySize,
      startsAt: input.startsAt,
      endsAt: input.endsAt,
      phone: input.phone ?? null,
      notes: input.notes ?? null,
    });
    return finish(ctx, tx, row, before, 'updated');
  });
}
export function advanceReservation(ctx: CriticalCommandContext, input: AdvanceReservationInput) {
  return withReservation(ctx, input.siteId, tx => {
    const before = requireReservation(tx, ctx, input);
    const now = new Date().toISOString();
    const valid =
      before.status === 'booked' || (before.status === 'arrived' && input.toStatus === 'cancelled');
    if (!valid || (input.toStatus === 'no_show' && before.startsAt > now))
      reservationError('state');
    if (input.toStatus === 'arrived') {
      if (!before.tableId || before.endsAt <= now) reservationError('state');
      assertReservationSlot(tx, ctx.tenantId, before);
      assertReservationTableEmpty(tx, ctx.tenantId, before.tableId);
      if (
        findReservationHold(tx, ctx.tenantId, before.tableId, now).some(row => row.id !== before.id)
      )
        reservationError('held');
    }
    const row = updateRow(tx, before, {
      status: input.toStatus,
      reason: input.reason ?? null,
      ...(input.toStatus === 'arrived' ? { arrivedAt: now } : {}),
    });
    return finish(ctx, tx, row, before, input.toStatus);
  });
}
