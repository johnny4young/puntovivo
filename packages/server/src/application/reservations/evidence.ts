/** Reservation evidence joins the existing command transaction and excludes contact/name/notes. */
import { nanoid } from 'nanoid';
import type { DatabaseInstance } from '../../db/index.js';
import { reservationEvents, type ReservationRow } from '../../db/schema.js';
import { writeAuditLog } from '../../services/audit-logs.js';
import { enqueueSyncInTransaction } from '../../services/sync/enqueue.js';

/** Identity shared by explicit reservation commands and the restaurant sale transaction. */
export interface ReservationEvidenceContext {
  tenantId: string;
  actorId: string;
  deviceId?: string | null | undefined;
  envelope: { operationId: string; idempotencyKey?: string | undefined };
}
export function recordReservationEvidence(
  tx: DatabaseInstance,
  ctx: ReservationEvidenceContext,
  row: ReservationRow,
  before: ReservationRow | null,
  kind: typeof reservationEvents.$inferInsert.kind
): void {
  tx.insert(reservationEvents)
    .values({
      id: nanoid(),
      tenantId: ctx.tenantId,
      siteId: row.siteId,
      reservationId: row.id,
      version: row.version,
      kind,
      fromStatus: before?.status ?? null,
      toStatus: row.status,
      tableId: row.tableId,
      serviceId: row.serviceId,
      actorId: ctx.actorId,
      operationId: ctx.envelope.operationId,
      createdAt: row.updatedAt,
    })
    .run();
  const facts = {
    id: row.id,
    siteId: row.siteId,
    tableId: row.tableId,
    serviceId: row.serviceId,
    status: row.status,
    version: row.version,
    partySize: row.partySize,
    startsAt: row.startsAt,
    endsAt: row.endsAt,
  };
  writeAuditLog({
    tx,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    operationId: ctx.envelope.operationId,
    action: before ? 'reservation.update' : 'reservation.create',
    resourceType: 'restaurant_reservation',
    resourceId: row.id,
    before: before
      ? {
          status: before.status,
          version: before.version,
          tableId: before.tableId,
          startsAt: before.startsAt,
          endsAt: before.endsAt,
        }
      : null,
    after: { ...facts, kind },
  });
  enqueueSyncInTransaction(
    {
      tenantId: ctx.tenantId,
      db: tx,
      deviceId: ctx.deviceId ?? null,
      envelope: {
        operationId: ctx.envelope.operationId,
        ...(ctx.envelope.idempotencyKey ? { idempotencyKey: ctx.envelope.idempotencyKey } : {}),
      },
    },
    {
      entityType: 'restaurant_reservations',
      entityId: row.id,
      operation: before ? 'update' : 'create',
      data: facts,
    }
  );
}
