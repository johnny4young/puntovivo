/** Immutable event and durable invalidation writes; no post-commit database side effects. */
import { and, eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import type { DatabaseInstance } from '../../db/index.js';
import {
  kdsOrderEvents,
  kdsOrders,
  kdsOutbox,
  type KdsEventKind,
  type KdsOrderRow,
} from '../../db/schema.js';
import { throwServerError } from '../../lib/errorCodes.js';

/** Event snapshots carry kitchen-only changes, never full sale or customer objects. */
interface KitchenEventInput {
  kind: KdsEventKind;
  actorId: string | null;
  facts: Record<string, unknown>;
  notify?: boolean;
}

/** First event of a newly submitted or explicitly adopted legacy ticket. */
export function insertKitchenEvent(
  tx: DatabaseInstance,
  order: KdsOrderRow,
  input: KitchenEventInput
): string {
  const eventId = nanoid();
  const now = new Date().toISOString();
  tx.insert(kdsOrderEvents)
    .values({
      id: eventId,
      tenantId: order.tenantId,
      siteId: order.siteId,
      orderId: order.id,
      sequence: order.version,
      kind: input.kind,
      actorId: input.actorId,
      facts: input.facts,
      createdAt: now,
    })
    .run();
  if (input.notify !== false) {
    tx.insert(kdsOutbox)
      .values({
        id: nanoid(),
        tenantId: order.tenantId,
        eventId,
        payload: { eventId, orderId: order.id, siteId: order.siteId },
        createdAt: now,
        updatedAt: now,
      })
      .run();
  }
  return eventId;
}

/** Bump the ticket generation with a CAS and freeze the event in the same writer. */
export function appendKitchenEvent(
  tx: DatabaseInstance,
  order: KdsOrderRow,
  input: KitchenEventInput,
  patch: Partial<Pick<KdsOrderRow, 'status' | 'readyAt' | 'readyByUserId'>> = {}
): KdsOrderRow {
  const next = {
    ...order,
    ...patch,
    version: order.version + 1,
    updatedAt: new Date().toISOString(),
  };
  const result = tx
    .update(kdsOrders)
    .set({ ...patch, version: next.version, updatedAt: next.updatedAt })
    .where(
      and(
        eq(kdsOrders.id, order.id),
        eq(kdsOrders.tenantId, order.tenantId),
        eq(kdsOrders.siteId, order.siteId),
        eq(kdsOrders.version, order.version)
      )
    )
    .run();
  if (result.changes !== 1) {
    throwServerError({
      trpcCode: 'CONFLICT',
      errorCode: 'STALE_VERSION',
      message: 'Kitchen ticket version changed',
    });
  }
  insertKitchenEvent(tx, next, input);
  return next;
}
