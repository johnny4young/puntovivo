/** Shared reservation holds used by every restaurant entry point, including legacy and table moves. */
import { and, eq, gt, inArray, lt, lte, ne, or } from 'drizzle-orm';
import type { DatabaseInstance } from '../../db/index.js';
import {
  restaurantReservations,
  restaurantServices,
  restaurantTables,
  sales,
  type ReservationRow,
} from '../../db/schema.js';
import { throwServerError } from '../../lib/errorCodes.js';

export function reservationError(
  kind: 'missing' | 'conflict' | 'state' | 'capacity' | 'held' | 'version'
): never {
  const codes = {
    missing: 'RESERVATION_NOT_FOUND',
    conflict: 'RESERVATION_SLOT_CONFLICT',
    state: 'RESERVATION_STATE_INVALID',
    capacity: 'RESERVATION_CAPACITY_EXCEEDED',
    held: 'RESERVATION_TABLE_HELD',
    version: 'STALE_VERSION',
  } as const;
  return throwServerError({
    trpcCode: kind === 'missing' ? 'NOT_FOUND' : 'CONFLICT',
    errorCode: codes[kind],
    message: 'Reservation is unavailable or has changed; refresh and review its state',
  });
}
/** Slot boundaries are half-open [start,end), so back-to-back bookings do not conflict. */
export function assertReservationSlot(
  tx: DatabaseInstance,
  tenantId: string,
  row: Pick<ReservationRow, 'id' | 'siteId' | 'tableId' | 'partySize' | 'startsAt' | 'endsAt'>
): void {
  if (!row.tableId) return;
  const table = tx
    .select()
    .from(restaurantTables)
    .where(
      and(
        eq(restaurantTables.tenantId, tenantId),
        eq(restaurantTables.siteId, row.siteId),
        eq(restaurantTables.id, row.tableId),
        eq(restaurantTables.isActive, true)
      )
    )
    .get();
  if (!table) reservationError('missing');
  if (table.seatCount !== null && row.partySize > table.seatCount) reservationError('capacity');
  const overlap = tx
    .select({ id: restaurantReservations.id })
    .from(restaurantReservations)
    .where(
      and(
        eq(restaurantReservations.tenantId, tenantId),
        eq(restaurantReservations.tableId, row.tableId),
        ne(restaurantReservations.id, row.id),
        inArray(restaurantReservations.status, ['booked', 'arrived']),
        lt(restaurantReservations.startsAt, row.endsAt),
        gt(restaurantReservations.endsAt, row.startsAt)
      )
    )
    .get();
  if (overlap) reservationError('conflict');
}
/** An arrived party holds its table until explicitly seated/cancelled, even after the planned end. */
export function findReservationHold(
  tx: DatabaseInstance,
  tenantId: string,
  tableId: string,
  now: string
) {
  return tx
    .select()
    .from(restaurantReservations)
    .where(
      and(
        eq(restaurantReservations.tenantId, tenantId),
        eq(restaurantReservations.tableId, tableId),
        or(
          eq(restaurantReservations.status, 'arrived'),
          and(
            eq(restaurantReservations.status, 'booked'),
            lte(restaurantReservations.startsAt, now),
            gt(restaurantReservations.endsAt, now)
          )
        )
      )
    )
    .limit(2)
    .all();
}
export function assertNoReservationHold(
  tx: DatabaseInstance,
  tenantId: string,
  tableId: string
): void {
  if (findReservationHold(tx, tenantId, tableId, new Date().toISOString()).length)
    reservationError('held');
}
export function assertReservationTableEmpty(
  tx: DatabaseInstance,
  tenantId: string,
  tableId: string,
  excludedSaleId?: string
): void {
  const service = tx
    .select({ id: restaurantServices.id })
    .from(restaurantServices)
    .where(
      and(
        eq(restaurantServices.tenantId, tenantId),
        eq(restaurantServices.tableId, tableId),
        eq(restaurantServices.status, 'open')
      )
    )
    .get();
  const draft = tx
    .select({ id: sales.id })
    .from(sales)
    .where(
      and(
        eq(sales.tenantId, tenantId),
        eq(sales.tableId, tableId),
        eq(sales.status, 'draft'),
        ...(excludedSaleId ? [ne(sales.id, excludedSaleId)] : [])
      )
    )
    .get();
  if (service || draft) reservationError('conflict');
}
