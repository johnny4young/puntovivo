import { and, asc, eq, inArray, isNull, or } from 'drizzle-orm';

import type { DatabaseInstance } from '../../db/index.js';
import {
  inventoryLots,
  pharmacyProductProfiles,
  pharmacyRecallLots,
  pharmacyRecalls,
  type LotStatus,
} from '../../db/schema.js';
import { throwServerError } from '../../lib/errorCodes.js';
import type { InventoryLotStatus } from '../inventory-lots/receive.js';
import { enqueueSyncInTransaction, type EnqueueSyncContext } from '../sync/enqueue.js';
import { iterateInventoryLotEventsNewestFirst, writeInventoryLotEvent } from './lot-events.js';

export interface RecallOverlay {
  id: string;
  reason: string;
}

export interface TransferLotCustody {
  incomingStatus: InventoryLotStatus;
  recallOverlays: RecallOverlay[];
}

/**
 * Resolve the state that follows a physical batch while it is in transit.
 * The live source lot is authoritative because quarantine, expiry or recall
 * may have happened after dispatch. A recalled state additionally requires a
 * provable consecutive event overlay so the destination inherits every
 * withdrawal campaign rather than becoming an untraceable recalled row.
 */
export function resolveTransferLotCustody(
  db: DatabaseInstance,
  tenantId: string,
  sourceLotId: string
): TransferLotCustody {
  const source = db
    .select({ status: inventoryLots.status })
    .from(inventoryLots)
    .where(and(eq(inventoryLots.id, sourceLotId), eq(inventoryLots.tenantId, tenantId)))
    .get();
  if (!source) {
    throwServerError({
      trpcCode: 'CONFLICT',
      errorCode: 'LOT_STOCK_INCONSISTENT',
      message: 'Transfer source lot is missing during receipt',
      details: { lotId: sourceLotId },
    });
  }
  if (source.status !== 'recalled') {
    return { incomingStatus: source.status, recallOverlays: [] };
  }

  const recallIdsNewestFirst: string[] = [];
  let underlyingStatus: LotStatus | null = null;
  for (const event of iterateInventoryLotEventsNewestFirst(db, tenantId, sourceLotId)) {
    if (event.nextStatus !== 'recalled') break;
    if (
      event.eventType === 'recall' &&
      event.referenceType === 'pharmacy_recall' &&
      event.referenceId
    ) {
      recallIdsNewestFirst.push(event.referenceId);
    }
    if (event.previousStatus && event.previousStatus !== 'recalled') {
      underlyingStatus = event.previousStatus;
      break;
    }
  }

  const recallIds = [...new Set(recallIdsNewestFirst.reverse())];
  if (!underlyingStatus || recallIds.length === 0) {
    throwServerError({
      trpcCode: 'CONFLICT',
      errorCode: 'PHARMACY_LOT_STATE_INVALID',
      message: 'The recalled transfer lot has no provable recall custody chain',
      details: { lotId: sourceLotId },
    });
  }

  const recalls: RecallOverlay[] = [];
  for (let offset = 0; offset < recallIds.length; offset += 500) {
    recalls.push(
      ...db
        .select({ id: pharmacyRecalls.id, reason: pharmacyRecalls.reason })
        .from(pharmacyRecalls)
        .where(
          and(
            eq(pharmacyRecalls.tenantId, tenantId),
            inArray(pharmacyRecalls.id, recallIds.slice(offset, offset + 500))
          )
        )
        .all()
    );
  }
  const recallById = new Map(recalls.map(recall => [recall.id, recall]));
  const recallOverlays = recallIds.map(id => recallById.get(id)).filter(Boolean) as RecallOverlay[];
  if (recallOverlays.length !== recallIds.length) {
    throwServerError({
      trpcCode: 'CONFLICT',
      errorCode: 'PHARMACY_LOT_STATE_INVALID',
      message: 'The recalled transfer lot references an unavailable recall campaign',
      details: { lotId: sourceLotId },
    });
  }
  return { incomingStatus: underlyingStatus, recallOverlays };
}

/** Append inherited recall overlays to a destination lot inside transfer receipt. */
export function applyRecallCustodyOverlays(
  db: DatabaseInstance,
  sync: Omit<EnqueueSyncContext, 'db'>,
  input: {
    tenantId: string;
    destinationLotId: string;
    recallOverlays: readonly RecallOverlay[];
    actorId: string;
    occurredAt: string;
  }
): InventoryLotStatus {
  for (const recall of input.recallOverlays) {
    const lot = db
      .select({
        id: inventoryLots.id,
        siteId: inventoryLots.siteId,
        productId: inventoryLots.productId,
        onHand: inventoryLots.onHand,
        status: inventoryLots.status,
        syncVersion: inventoryLots.syncVersion,
      })
      .from(inventoryLots)
      .where(
        and(
          eq(inventoryLots.id, input.destinationLotId),
          eq(inventoryLots.tenantId, input.tenantId)
        )
      )
      .get();
    if (!lot) {
      throwServerError({
        trpcCode: 'CONFLICT',
        errorCode: 'LOT_STOCK_INCONSISTENT',
        message: 'Transfer destination lot disappeared before recall inheritance',
        details: { lotId: input.destinationLotId },
      });
    }

    const existingLink = db
      .select({ recallId: pharmacyRecallLots.recallId })
      .from(pharmacyRecallLots)
      .where(
        and(
          eq(pharmacyRecallLots.tenantId, input.tenantId),
          eq(pharmacyRecallLots.recallId, recall.id),
          eq(pharmacyRecallLots.lotId, lot.id)
        )
      )
      .get();
    if (!existingLink) {
      db.insert(pharmacyRecallLots)
        .values({
          recallId: recall.id,
          lotId: lot.id,
          tenantId: input.tenantId,
          previousStatus: lot.status,
          createdAt: input.occurredAt,
        })
        .run();
      enqueueSyncInTransaction(
        { ...sync, db },
        {
          entityType: 'pharmacy_recall_lots',
          entityId: `${recall.id}:${lot.id}`,
          operation: 'create',
          data: { recallId: recall.id, lotId: lot.id, previousStatus: lot.status },
        }
      );
    } else if (lot.status === 'recalled') {
      continue;
    }

    const changed = db
      .update(inventoryLots)
      .set({
        status: 'recalled',
        syncStatus: 'pending',
        syncVersion: (lot.syncVersion ?? 0) + 1,
        updatedAt: input.occurredAt,
      })
      .where(
        and(
          eq(inventoryLots.id, lot.id),
          eq(inventoryLots.tenantId, input.tenantId),
          eq(inventoryLots.status, lot.status),
          lot.syncVersion === null
            ? isNull(inventoryLots.syncVersion)
            : eq(inventoryLots.syncVersion, lot.syncVersion)
        )
      )
      .run() as { changes?: number };
    if ((changed.changes ?? 0) !== 1) {
      throwServerError({
        trpcCode: 'CONFLICT',
        errorCode: 'PHARMACY_LOT_STATE_INVALID',
        message: 'Transfer destination lot changed during recall inheritance',
        details: { lotId: lot.id, recallId: recall.id },
      });
    }
    writeInventoryLotEvent(db, sync, {
      tenantId: input.tenantId,
      siteId: lot.siteId,
      productId: lot.productId,
      lotId: lot.id,
      eventType: 'recall',
      previousStatus: lot.status,
      nextStatus: 'recalled',
      quantitySnapshot: lot.onHand,
      reason: recall.reason,
      referenceType: 'pharmacy_recall',
      referenceId: recall.id,
      actorId: input.actorId,
      occurredAt: input.occurredAt,
    });
  }

  const finalStatus = db
    .select({ status: inventoryLots.status })
    .from(inventoryLots)
    .where(
      and(eq(inventoryLots.id, input.destinationLotId), eq(inventoryLots.tenantId, input.tenantId))
    )
    .get()?.status;
  if (!finalStatus) {
    throwServerError({
      trpcCode: 'CONFLICT',
      errorCode: 'LOT_STOCK_INCONSISTENT',
      message: 'Transfer destination lot is missing after recall inheritance',
      details: { lotId: input.destinationLotId },
    });
  }
  return finalStatus;
}

/** Resolve active campaigns that must cover stock received after recall creation. */
export function findActiveRecallOverlaysForLot(
  db: DatabaseInstance,
  input: { tenantId: string; lotId: string; providerId?: string | null }
): RecallOverlay[] {
  const lot = db
    .select({
      productId: inventoryLots.productId,
      sanitaryRegistrationNormalized: pharmacyProductProfiles.sanitaryRegistrationNormalized,
    })
    .from(inventoryLots)
    .innerJoin(
      pharmacyProductProfiles,
      and(
        eq(pharmacyProductProfiles.productId, inventoryLots.productId),
        eq(pharmacyProductProfiles.tenantId, input.tenantId)
      )
    )
    .where(and(eq(inventoryLots.id, input.lotId), eq(inventoryLots.tenantId, input.tenantId)))
    .get();
  if (!lot) return [];

  return db
    .select({ id: pharmacyRecalls.id, reason: pharmacyRecalls.reason })
    .from(pharmacyRecalls)
    .where(
      and(
        eq(pharmacyRecalls.tenantId, input.tenantId),
        eq(pharmacyRecalls.status, 'active'),
        or(
          and(eq(pharmacyRecalls.scopeType, 'lot'), eq(pharmacyRecalls.lotId, input.lotId)),
          and(
            eq(pharmacyRecalls.scopeType, 'product'),
            eq(pharmacyRecalls.productId, lot.productId)
          ),
          lot.sanitaryRegistrationNormalized
            ? and(
                eq(pharmacyRecalls.scopeType, 'sanitary_registration'),
                eq(pharmacyRecalls.sanitaryRegistration, lot.sanitaryRegistrationNormalized)
              )
            : undefined,
          input.providerId
            ? and(
                eq(pharmacyRecalls.scopeType, 'provider'),
                eq(pharmacyRecalls.providerId, input.providerId)
              )
            : undefined
        )
      )
    )
    .orderBy(asc(pharmacyRecalls.initiatedAt), asc(pharmacyRecalls.id))
    .all();
}
