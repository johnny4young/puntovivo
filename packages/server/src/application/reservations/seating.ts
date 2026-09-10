/** Explicit reservation consumption belongs to the same transaction as the first real restaurant check. */
import { and, eq } from 'drizzle-orm';
import type { DatabaseInstance } from '../../db/index.js';
import { restaurantReservations, type ReservationRow } from '../../db/schema.js';
import {
  assertReservationSlot,
  assertReservationTableEmpty,
  findReservationHold,
  reservationError,
} from './invariants.js';
import { recordReservationEvidence, type ReservationEvidenceContext } from './evidence.js';

/** Opaque reservation reference plus optimistic version; never infer a party from a table/name. */
export interface ReservationReference {
  id: string;
  expectedVersion: number;
}
export function prepareReservationSeating(
  tx: DatabaseInstance,
  ctx: { tenantId: string; siteId: string; now: string },
  tableId: string,
  guestCount: number,
  saleId: string,
  ref: ReservationReference | undefined
): ReservationRow | null {
  if (!ref) return null;
  const row = tx
    .select()
    .from(restaurantReservations)
    .where(
      and(
        eq(restaurantReservations.tenantId, ctx.tenantId),
        eq(restaurantReservations.siteId, ctx.siteId),
        eq(restaurantReservations.id, ref.id)
      )
    )
    .get();
  if (!row) reservationError('missing');
  if (row.version !== ref.expectedVersion) reservationError('version');
  if (row.status !== 'arrived' || row.tableId !== tableId || row.partySize !== guestCount)
    reservationError('state');
  assertReservationSlot(tx, ctx.tenantId, row);
  assertReservationTableEmpty(tx, ctx.tenantId, tableId, saleId);
  if (
    findReservationHold(tx, ctx.tenantId, tableId, new Date().toISOString()).some(
      other => other.id !== row.id
    )
  )
    reservationError('held');
  return row;
}
export function seatReservation(
  tx: DatabaseInstance,
  ctx: ReservationEvidenceContext & { now: string },
  before: ReservationRow,
  serviceId: string
): void {
  const row = tx
    .update(restaurantReservations)
    .set({
      status: 'seated',
      serviceId,
      seatedAt: ctx.now,
      updatedAt: ctx.now,
      version: before.version + 1,
    })
    .where(
      and(
        eq(restaurantReservations.tenantId, ctx.tenantId),
        eq(restaurantReservations.id, before.id),
        eq(restaurantReservations.version, before.version),
        eq(restaurantReservations.status, 'arrived')
      )
    )
    .returning()
    .get();
  if (!row) reservationError('version');
  recordReservationEvidence(tx, ctx, row, before, 'seated');
}
