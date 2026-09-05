import { nanoid } from 'nanoid';
import { and, desc, eq, sql } from 'drizzle-orm';

import type { DatabaseInstance } from '../../db/index.js';
import { inventoryLotEvents, type InventoryLotEventType, type LotStatus } from '../../db/schema.js';
import { enqueueSyncInTransaction, type EnqueueSyncContext } from '../sync/enqueue.js';

export interface InventoryLotEventSnapshot {
  tenantId: string;
  siteId: string;
  productId: string;
  lotId: string;
  eventType: InventoryLotEventType;
  previousStatus: LotStatus | null;
  nextStatus: LotStatus;
  quantitySnapshot: number;
  reason: string;
  referenceType?: string | null;
  referenceId?: string | null;
  actorId: string;
  occurredAt: string;
}

export interface InventoryLotEventHistoryRow {
  eventType: InventoryLotEventType;
  previousStatus: LotStatus | null;
  nextStatus: LotStatus;
  referenceType: string | null;
  referenceId: string | null;
}

const LOT_EVENT_HISTORY_PAGE_SIZE = 128;

/**
 * Iterate one lot's immutable history newest-first while holding at most one
 * bounded page in memory. Callers normally run inside an immediate write
 * transaction, so OFFSET observes a stable ledger snapshot and rowid keeps
 * equal-millisecond events in insertion order.
 */
export function* iterateInventoryLotEventsNewestFirst(
  db: DatabaseInstance,
  tenantId: string,
  lotId: string
): Generator<InventoryLotEventHistoryRow> {
  let offset = 0;
  while (true) {
    const page = db
      .select({
        eventType: inventoryLotEvents.eventType,
        previousStatus: inventoryLotEvents.previousStatus,
        nextStatus: inventoryLotEvents.nextStatus,
        referenceType: inventoryLotEvents.referenceType,
        referenceId: inventoryLotEvents.referenceId,
      })
      .from(inventoryLotEvents)
      .where(and(eq(inventoryLotEvents.tenantId, tenantId), eq(inventoryLotEvents.lotId, lotId)))
      .orderBy(desc(inventoryLotEvents.occurredAt), sql`rowid DESC`)
      .limit(LOT_EVENT_HISTORY_PAGE_SIZE)
      .offset(offset)
      .all();

    yield* page;
    if (page.length < LOT_EVENT_HISTORY_PAGE_SIZE) return;
    offset += page.length;
  }
}

/** Append one immutable lot transition and its durable local-only sync trace. */
export function writeInventoryLotEvent(
  db: DatabaseInstance,
  sync: Omit<EnqueueSyncContext, 'db'>,
  snapshot: InventoryLotEventSnapshot
): { id: string; syncOutboxId: string } {
  const id = nanoid();
  db.insert(inventoryLotEvents)
    .values({ id, ...snapshot, createdAt: snapshot.occurredAt })
    .run();
  const syncOutboxId = enqueueSyncInTransaction(
    { ...sync, db },
    {
      entityType: 'inventory_lot_events',
      entityId: id,
      operation: 'create',
      data: { id, ...snapshot },
    }
  ).id;
  return { id, syncOutboxId };
}
