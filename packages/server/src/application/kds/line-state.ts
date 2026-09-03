/** Shared versioned operational projection; submitted preparation fields never change. */
import { and, eq } from 'drizzle-orm';
import type { DatabaseInstance } from '../../db/index.js';
import { kdsOrderLines, type KdsOrderLineRow, type KdsOrderRow } from '../../db/schema.js';
import { throwServerError } from '../../lib/errorCodes.js';
import { KDS_MAX_LINES } from './common.js';

/** Load one bounded ticket under its already-verified tenant/site header. */
export function loadKitchenOrderLines(tx: DatabaseInstance, order: KdsOrderRow): KdsOrderLineRow[] {
  const lines = tx
    .select()
    .from(kdsOrderLines)
    .where(and(eq(kdsOrderLines.tenantId, order.tenantId), eq(kdsOrderLines.orderId, order.id)))
    .limit(KDS_MAX_LINES + 1)
    .all();
  if (!lines.length || lines.length > KDS_MAX_LINES) {
    throwServerError({
      trpcCode: 'CONFLICT',
      errorCode: 'KDS_SNAPSHOT_INVALID',
      message: 'Kitchen line projection is incomplete or exceeds its bound',
    });
  }
  return lines;
}

/** Only operational fields are writable after a preparation submission. */
export type KitchenLinePatch = Partial<
  Pick<
    KdsOrderLineRow,
    | 'status'
    | 'readyAt'
    | 'readyByUserId'
    | 'voidedAt'
    | 'voidReason'
    | 'currentSaleId'
    | 'currentTableId'
    | 'currentTableLabel'
  >
>;

/** A line CAS also detects stale clients after a recall or table move (ABA). */
export function updateKitchenLine(
  tx: DatabaseInstance,
  line: KdsOrderLineRow,
  patch: KitchenLinePatch
): KdsOrderLineRow {
  const next = {
    ...line,
    ...patch,
    version: line.version + 1,
    updatedAt: new Date().toISOString(),
  };
  const result = tx
    .update(kdsOrderLines)
    .set({ ...patch, version: next.version, updatedAt: next.updatedAt })
    .where(
      and(
        eq(kdsOrderLines.id, line.id),
        eq(kdsOrderLines.tenantId, line.tenantId),
        eq(kdsOrderLines.orderId, line.orderId),
        eq(kdsOrderLines.version, line.version)
      )
    )
    .run();
  if (result.changes !== 1) {
    throwServerError({
      trpcCode: 'CONFLICT',
      errorCode: 'STALE_VERSION',
      message: 'Kitchen line changed before the action committed',
    });
  }
  return next;
}

/** Ready means every non-void line is ready; an entirely voided ticket remains visible as cancelled history. */
export function kitchenOrderState(
  lines: readonly KdsOrderLineRow[],
  actorId: string
): Pick<KdsOrderRow, 'status' | 'readyAt' | 'readyByUserId'> {
  const live = lines.filter(line => line.status !== 'voided');
  if (!live.length) return { status: 'cancelled', readyAt: null, readyByUserId: null };
  if (live.every(line => line.status === 'ready')) {
    const latest = [...live].sort((a, b) => (b.readyAt ?? '').localeCompare(a.readyAt ?? ''))[0]!;
    return {
      status: 'ready',
      readyAt: latest.readyAt ?? new Date().toISOString(),
      readyByUserId: latest.readyByUserId ?? actorId,
    };
  }
  return { status: 'pending', readyAt: null, readyByUserId: null };
}
