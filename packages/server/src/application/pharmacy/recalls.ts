import { and, desc, eq, inArray, isNotNull, isNull, ne, or, sql } from 'drizzle-orm';
import { nanoid } from 'nanoid';

import type { DatabaseInstance } from '../../db/index.js';
import {
  customers,
  inventoryLots,
  pharmacyProductProfiles,
  pharmacyRecallLots,
  pharmacyRecalls,
  products,
  providers,
  purchaseItemLots,
  purchaseItems,
  purchases,
  saleItemLots,
  saleItems,
  sales,
  transferOrderItemLots,
  transferOrderItems,
  transferOrders,
  type LotStatus,
} from '../../db/schema.js';
import { throwServerError } from '../../lib/errorCodes.js';
import { writeAuditLog } from '../../services/audit-logs.js';
import { isLotExpiredAt } from '../../services/inventory-lots/index.js';
import {
  assertTenantBusinessClockCurrent,
  resolveTenantBusinessClock,
} from '../../services/pharmacy/business-clock.js';
import {
  iterateInventoryLotEventsNewestFirst,
  writeInventoryLotEvent,
} from '../../services/pharmacy/lot-events.js';
import { normalizeSanitaryRegistration } from '../../services/pharmacy/product-profile.js';
import { enqueueSyncInTransaction } from '../../services/sync/enqueue.js';
import type {
  CreatePharmacyRecallInput,
  TransitionPharmacyLotInput,
} from '../../trpc/schemas/pharmacy.js';
import { clampPharmacyPage, pharmacySyncContext, type CriticalPharmacyContext } from './types.js';

interface RecallLotRow {
  id: string;
  tenantId: string;
  siteId: string;
  productId: string;
  lotNumber: string;
  expiresAt: string | null;
  onHand: number;
  status: LotStatus;
  syncVersion: number | null;
}

function lotSelection() {
  return {
    id: inventoryLots.id,
    tenantId: inventoryLots.tenantId,
    siteId: inventoryLots.siteId,
    productId: inventoryLots.productId,
    lotNumber: inventoryLots.lotNumber,
    expiresAt: inventoryLots.expiresAt,
    onHand: inventoryLots.onHand,
    status: inventoryLots.status,
    syncVersion: inventoryLots.syncVersion,
  };
}

const RECALL_LINEAGE_BATCH_SIZE = 250;

function chunkIds(ids: readonly string[]): string[][] {
  const chunks: string[][] = [];
  for (let offset = 0; offset < ids.length; offset += RECALL_LINEAGE_BATCH_SIZE) {
    chunks.push(ids.slice(offset, offset + RECALL_LINEAGE_BATCH_SIZE));
  }
  return chunks;
}

/**
 * A transfer moves one physical batch between site-specific lot rows. Treat
 * every non-void transfer edge as bidirectional so a recall raised from any
 * surviving copy reaches the whole batch, including sibling destinations.
 */
function expandTransferLotLineage(
  db: DatabaseInstance,
  tenantId: string,
  seedLotIds: readonly string[]
): Set<string> {
  const known = new Set(seedLotIds);
  let frontier = [...known];

  while (frontier.length > 0) {
    const candidates = new Set<string>();
    for (const batch of chunkIds(frontier)) {
      const edges = db
        .select({
          sourceLotId: transferOrderItemLots.sourceLotId,
          destinationLotId: transferOrderItemLots.destinationLotId,
        })
        .from(transferOrderItemLots)
        .innerJoin(
          transferOrderItems,
          eq(transferOrderItems.id, transferOrderItemLots.transferOrderItemId)
        )
        .innerJoin(
          transferOrders,
          and(
            eq(transferOrders.id, transferOrderItems.transferOrderId),
            eq(transferOrders.tenantId, tenantId)
          )
        )
        .where(
          and(
            eq(transferOrderItemLots.tenantId, tenantId),
            ne(transferOrders.status, 'void'),
            isNotNull(transferOrderItemLots.destinationLotId),
            or(
              inArray(transferOrderItemLots.sourceLotId, batch),
              inArray(transferOrderItemLots.destinationLotId, batch)
            )
          )
        )
        .all();

      for (const edge of edges) {
        for (const lotId of [edge.sourceLotId, edge.destinationLotId]) {
          if (lotId && !known.has(lotId)) candidates.add(lotId);
        }
      }
    }

    const next: string[] = [];
    for (const batch of chunkIds([...candidates])) {
      const tenantLots = db
        .select({ id: inventoryLots.id })
        .from(inventoryLots)
        .where(and(eq(inventoryLots.tenantId, tenantId), inArray(inventoryLots.id, batch)))
        .all();
      for (const lot of tenantLots) {
        if (!known.has(lot.id)) {
          known.add(lot.id);
          next.push(lot.id);
        }
      }
    }
    frontier = next;
  }

  return known;
}

function loadRecallLots(
  db: DatabaseInstance,
  tenantId: string,
  lotIds: ReadonlySet<string>
): RecallLotRow[] {
  const rows: RecallLotRow[] = [];
  for (const batch of chunkIds([...lotIds])) {
    rows.push(
      ...db
        .select(lotSelection())
        .from(inventoryLots)
        .where(and(eq(inventoryLots.tenantId, tenantId), inArray(inventoryLots.id, batch)))
        .all()
    );
  }
  return rows.sort((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0));
}

function resolveRecallLots(
  db: DatabaseInstance,
  tenantId: string,
  input: CreatePharmacyRecallInput
): RecallLotRow[] {
  const base = () =>
    db
      .selectDistinct(lotSelection())
      .from(inventoryLots)
      .innerJoin(
        products,
        and(eq(products.id, inventoryLots.productId), eq(products.tenantId, tenantId))
      )
      .innerJoin(
        pharmacyProductProfiles,
        and(
          eq(pharmacyProductProfiles.productId, products.id),
          eq(pharmacyProductProfiles.tenantId, tenantId)
        )
      );

  let roots: RecallLotRow[];
  if (input.scopeType === 'lot') {
    roots = base()
      .where(and(eq(inventoryLots.tenantId, tenantId), eq(inventoryLots.id, input.lotId!)))
      .all();
  } else if (input.scopeType === 'product') {
    roots = base()
      .where(
        and(eq(inventoryLots.tenantId, tenantId), eq(inventoryLots.productId, input.productId!))
      )
      .all();
  } else if (input.scopeType === 'sanitary_registration') {
    roots = base()
      .where(
        and(
          eq(inventoryLots.tenantId, tenantId),
          eq(
            pharmacyProductProfiles.sanitaryRegistrationNormalized,
            normalizeSanitaryRegistration(input.sanitaryRegistration!)
          )
        )
      )
      .all();
  } else {
    roots = base()
      .innerJoin(
        purchaseItemLots,
        and(
          eq(purchaseItemLots.inventoryLotId, inventoryLots.id),
          eq(purchaseItemLots.tenantId, tenantId)
        )
      )
      .innerJoin(
        purchaseItems,
        and(
          eq(purchaseItems.id, purchaseItemLots.purchaseItemId),
          eq(purchaseItems.productId, products.id)
        )
      )
      .innerJoin(
        purchases,
        and(
          eq(purchases.id, purchaseItems.purchaseId),
          eq(purchases.tenantId, tenantId),
          eq(purchases.providerId, input.providerId!),
          ne(purchases.status, 'voided')
        )
      )
      // Supplier recalls follow immutable receipt provenance. A mutable catalog
      // assignment describes who may supply the product, not who supplied a lot.
      .where(eq(inventoryLots.tenantId, tenantId))
      .all();
  }

  if (roots.length === 0) return [];
  return loadRecallLots(
    db,
    tenantId,
    expandTransferLotLineage(
      db,
      tenantId,
      roots.map(lot => lot.id)
    )
  );
}

function recallScopeExists(
  db: DatabaseInstance,
  tenantId: string,
  input: CreatePharmacyRecallInput
): boolean {
  if (input.scopeType === 'lot') {
    return Boolean(
      db
        .select({ id: inventoryLots.id })
        .from(inventoryLots)
        .innerJoin(
          pharmacyProductProfiles,
          and(
            eq(pharmacyProductProfiles.productId, inventoryLots.productId),
            eq(pharmacyProductProfiles.tenantId, tenantId)
          )
        )
        .where(and(eq(inventoryLots.tenantId, tenantId), eq(inventoryLots.id, input.lotId!)))
        .get()
    );
  }
  if (input.scopeType === 'product') {
    return Boolean(
      db
        .select({ id: products.id })
        .from(products)
        .innerJoin(
          pharmacyProductProfiles,
          and(
            eq(pharmacyProductProfiles.productId, products.id),
            eq(pharmacyProductProfiles.tenantId, tenantId)
          )
        )
        .where(and(eq(products.tenantId, tenantId), eq(products.id, input.productId!)))
        .get()
    );
  }
  if (input.scopeType === 'provider') {
    return Boolean(
      db
        .select({ id: providers.id })
        .from(providers)
        .where(and(eq(providers.tenantId, tenantId), eq(providers.id, input.providerId!)))
        .get()
    );
  }
  return Boolean(
    db
      .select({ productId: pharmacyProductProfiles.productId })
      .from(pharmacyProductProfiles)
      .where(
        and(
          eq(pharmacyProductProfiles.tenantId, tenantId),
          eq(
            pharmacyProductProfiles.sanitaryRegistrationNormalized,
            normalizeSanitaryRegistration(input.sanitaryRegistration!)
          )
        )
      )
      .get()
  );
}

/** Resolve the non-recall state hidden by the current consecutive recall overlay. */
function resolveUnderlyingRecallStatus(
  db: DatabaseInstance,
  tenantId: string,
  lotId: string
): LotStatus | null {
  for (const event of iterateInventoryLotEventsNewestFirst(db, tenantId, lotId)) {
    if (event.nextStatus !== 'recalled') return null;
    // Quantity-only custody events such as destruction or a supplier return
    // preserve the recall overlay. Walk through those in-state transitions
    // until the event that originally entered recalled status.
    if (event.previousStatus === 'recalled') continue;
    if (event.previousStatus) {
      return event.previousStatus;
    }
    return null;
  }
  return null;
}

export async function createPharmacyRecall(
  ctx: CriticalPharmacyContext,
  input: CreatePharmacyRecallInput
) {
  const clock = await resolveTenantBusinessClock(ctx.db, ctx.tenantId);
  const id = nanoid();
  const sanitaryRegistration =
    input.scopeType === 'sanitary_registration'
      ? normalizeSanitaryRegistration(input.sanitaryRegistration!)
      : null;
  return ctx.db.transaction(
    tx => {
      assertTenantBusinessClockCurrent(tx, ctx.tenantId, clock);
      if (!recallScopeExists(tx, ctx.tenantId, input)) {
        throwServerError({
          trpcCode: 'NOT_FOUND',
          errorCode: 'PHARMACY_RECALL_NO_LOTS',
          message: 'The pharmacy recall scope was not found for this tenant',
        });
      }
      const lots = resolveRecallLots(tx, ctx.tenantId, input);
      if (input.scopeType === 'lot' && lots.length === 0) {
        throwServerError({
          trpcCode: 'NOT_FOUND',
          errorCode: 'PHARMACY_RECALL_NO_LOTS',
          message: 'The exact pharmacy lot is unavailable for recall',
        });
      }
      tx.insert(pharmacyRecalls)
        .values({
          id,
          tenantId: ctx.tenantId,
          scopeType: input.scopeType,
          productId: input.productId ?? null,
          lotId: input.lotId ?? null,
          providerId: input.providerId ?? null,
          sanitaryRegistration,
          reason: input.reason,
          status: 'active',
          initiatedBy: ctx.user.id,
          initiatedAt: clock.nowIso,
          createdAt: clock.nowIso,
          updatedAt: clock.nowIso,
        })
        .run();

      const sync = pharmacySyncContext(ctx, tx);
      const mutatedLotIds: string[] = [];
      for (const lot of lots) {
        tx.insert(pharmacyRecallLots)
          .values({
            recallId: id,
            lotId: lot.id,
            tenantId: ctx.tenantId,
            previousStatus: lot.status,
            createdAt: clock.nowIso,
          })
          .run();
        enqueueSyncInTransaction(sync, {
          entityType: 'pharmacy_recall_lots',
          entityId: `${id}:${lot.id}`,
          operation: 'create',
          data: { recallId: id, lotId: lot.id, previousStatus: lot.status },
        });
        const update = tx
          .update(inventoryLots)
          .set({
            status: 'recalled',
            syncStatus: 'pending',
            syncVersion: (lot.syncVersion ?? 0) + 1,
            updatedAt: clock.nowIso,
          })
          .where(
            and(
              eq(inventoryLots.id, lot.id),
              eq(inventoryLots.tenantId, ctx.tenantId),
              eq(inventoryLots.status, lot.status),
              lot.syncVersion === null
                ? isNull(inventoryLots.syncVersion)
                : eq(inventoryLots.syncVersion, lot.syncVersion)
            )
          )
          .run() as { changes?: number };
        if ((update.changes ?? 0) !== 1) {
          throwServerError({
            trpcCode: 'CONFLICT',
            errorCode: 'PHARMACY_LOT_STATE_INVALID',
            message: 'A recalled lot changed concurrently',
          });
        }
        writeInventoryLotEvent(tx, sync, {
          tenantId: ctx.tenantId,
          siteId: lot.siteId,
          productId: lot.productId,
          lotId: lot.id,
          eventType: 'recall',
          previousStatus: lot.status,
          nextStatus: 'recalled',
          quantitySnapshot: lot.onHand,
          reason: input.reason,
          referenceType: 'pharmacy_recall',
          referenceId: id,
          actorId: ctx.user.id,
          occurredAt: clock.nowIso,
        });
        enqueueSyncInTransaction(sync, {
          entityType: 'inventory_lots',
          entityId: lot.id,
          operation: 'update',
          data: { id: lot.id, status: 'recalled', recallId: id },
        });
        mutatedLotIds.push(lot.id);
      }

      writeAuditLog({
        tx,
        tenantId: ctx.tenantId,
        actorId: ctx.user.id,
        action: 'pharmacy.recall.create',
        resourceType: 'pharmacy_recall',
        resourceId: id,
        before: null,
        after: {
          scopeType: input.scopeType,
          productId: input.productId ?? null,
          lotId: input.lotId ?? null,
          providerId: input.providerId ?? null,
          sanitaryRegistration,
          status: 'active',
          lotCount: lots.length,
        },
        metadata: { reason: input.reason },
        operationId: ctx.envelope.operationId,
      });
      enqueueSyncInTransaction(sync, {
        entityType: 'pharmacy_recalls',
        entityId: id,
        operation: 'create',
        data: {
          id,
          scopeType: input.scopeType,
          productId: input.productId ?? null,
          lotId: input.lotId ?? null,
          providerId: input.providerId ?? null,
          sanitaryRegistration,
          reason: input.reason,
          status: 'active',
          lotIds: mutatedLotIds,
          initiatedAt: clock.nowIso,
        },
      });
      const result = { id, status: 'active' as const, lotCount: lots.length };
      ctx.completeInTransaction(tx, result);
      return result;
    },
    { behavior: 'immediate' }
  );
}

export function listPharmacyRecalls(
  db: DatabaseInstance,
  tenantId: string,
  input: { page: number; perPage: number; status?: 'active' | 'closed' | undefined }
) {
  const where = input.status
    ? and(eq(pharmacyRecalls.tenantId, tenantId), eq(pharmacyRecalls.status, input.status))
    : eq(pharmacyRecalls.tenantId, tenantId);
  const total = Number(
    db
      .select({ count: sql<number>`count(*)` })
      .from(pharmacyRecalls)
      .where(where)
      .get()?.count ?? 0
  );
  const page = clampPharmacyPage(total, input.perPage, input.page);
  const items = db
    .select({
      id: pharmacyRecalls.id,
      scopeType: pharmacyRecalls.scopeType,
      productId: pharmacyRecalls.productId,
      lotId: pharmacyRecalls.lotId,
      providerId: pharmacyRecalls.providerId,
      sanitaryRegistration: pharmacyRecalls.sanitaryRegistration,
      reason: pharmacyRecalls.reason,
      status: pharmacyRecalls.status,
      initiatedBy: pharmacyRecalls.initiatedBy,
      initiatedAt: pharmacyRecalls.initiatedAt,
      closedAt: pharmacyRecalls.closedAt,
      productName: products.name,
      lotNumber: inventoryLots.lotNumber,
      providerName: providers.name,
      lotCount: sql<number>`(select count(*) from pharmacy_recall_lots prl where prl.recall_id = ${pharmacyRecalls.id} and prl.tenant_id = ${tenantId})`,
    })
    .from(pharmacyRecalls)
    .leftJoin(
      products,
      and(eq(products.id, pharmacyRecalls.productId), eq(products.tenantId, tenantId))
    )
    .leftJoin(
      inventoryLots,
      and(eq(inventoryLots.id, pharmacyRecalls.lotId), eq(inventoryLots.tenantId, tenantId))
    )
    .leftJoin(
      providers,
      and(eq(providers.id, pharmacyRecalls.providerId), eq(providers.tenantId, tenantId))
    )
    .where(where)
    .orderBy(desc(pharmacyRecalls.initiatedAt), desc(pharmacyRecalls.id))
    .limit(input.perPage)
    .offset((page - 1) * input.perPage)
    .all();
  return { items, total, page, perPage: input.perPage };
}

function requirePharmacyRecall(db: DatabaseInstance, tenantId: string, recallId: string) {
  const recall = db
    .select({
      recall: pharmacyRecalls,
      productName: products.name,
      lotNumber: inventoryLots.lotNumber,
      providerName: providers.name,
    })
    .from(pharmacyRecalls)
    .leftJoin(
      products,
      and(eq(products.id, pharmacyRecalls.productId), eq(products.tenantId, tenantId))
    )
    .leftJoin(
      inventoryLots,
      and(eq(inventoryLots.id, pharmacyRecalls.lotId), eq(inventoryLots.tenantId, tenantId))
    )
    .leftJoin(
      providers,
      and(eq(providers.id, pharmacyRecalls.providerId), eq(providers.tenantId, tenantId))
    )
    .where(and(eq(pharmacyRecalls.id, recallId), eq(pharmacyRecalls.tenantId, tenantId)))
    .get();
  if (!recall) {
    throwServerError({
      trpcCode: 'NOT_FOUND',
      errorCode: 'PHARMACY_RECALL_NOT_FOUND',
      message: 'Pharmacy recall not found',
    });
  }
  const { recall: row, ...identity } = recall;
  return { ...row, ...identity };
}

export function getPharmacyRecall(
  db: DatabaseInstance,
  tenantId: string,
  input: { id: string; page: number; perPage: number }
) {
  const recall = requirePharmacyRecall(db, tenantId, input.id);
  const lotsTotal = Number(
    db
      .select({ count: sql<number>`count(*)` })
      .from(pharmacyRecallLots)
      .where(
        and(eq(pharmacyRecallLots.recallId, input.id), eq(pharmacyRecallLots.tenantId, tenantId))
      )
      .get()?.count ?? 0
  );
  const page = clampPharmacyPage(lotsTotal, input.perPage, input.page);
  const lots = db
    .select({
      lotId: inventoryLots.id,
      lotNumber: inventoryLots.lotNumber,
      siteId: inventoryLots.siteId,
      productId: inventoryLots.productId,
      productName: products.name,
      expiresAt: inventoryLots.expiresAt,
      onHand: inventoryLots.onHand,
      status: inventoryLots.status,
      previousStatus: pharmacyRecallLots.previousStatus,
    })
    .from(pharmacyRecallLots)
    .innerJoin(
      inventoryLots,
      and(eq(inventoryLots.id, pharmacyRecallLots.lotId), eq(inventoryLots.tenantId, tenantId))
    )
    .innerJoin(
      products,
      and(eq(products.id, inventoryLots.productId), eq(products.tenantId, tenantId))
    )
    .where(
      and(eq(pharmacyRecallLots.recallId, input.id), eq(pharmacyRecallLots.tenantId, tenantId))
    )
    .orderBy(products.name, inventoryLots.lotNumber, inventoryLots.id)
    .limit(input.perPage)
    .offset((page - 1) * input.perPage)
    .all();
  return {
    ...recall,
    lots,
    lotsTotal,
    lotsPage: page,
    lotsPerPage: input.perPage,
  };
}

export function listRecallAffectedSales(
  db: DatabaseInstance,
  tenantId: string,
  input: { id: string; page: number; perPage: number },
  includeCustomerIdentity: boolean
) {
  requirePharmacyRecall(db, tenantId, input.id);
  const where = and(
    eq(pharmacyRecallLots.recallId, input.id),
    eq(pharmacyRecallLots.tenantId, tenantId)
  );
  const total = Number(
    db
      .select({
        count: sql<number>`count(distinct ${saleItemLots.saleItemId} || char(0) || ${saleItemLots.lotId})`,
      })
      .from(pharmacyRecallLots)
      .innerJoin(
        inventoryLots,
        and(eq(inventoryLots.id, pharmacyRecallLots.lotId), eq(inventoryLots.tenantId, tenantId))
      )
      .innerJoin(
        saleItemLots,
        and(eq(saleItemLots.lotId, inventoryLots.id), eq(saleItemLots.tenantId, tenantId))
      )
      .innerJoin(saleItems, eq(saleItems.id, saleItemLots.saleItemId))
      .innerJoin(
        sales,
        and(
          eq(sales.id, saleItems.saleId),
          eq(sales.tenantId, tenantId),
          inArray(sales.status, ['completed', 'voided'])
        )
      )
      .where(where)
      .get()?.count ?? 0
  );
  const page = clampPharmacyPage(total, input.perPage, input.page);
  const items = db
    .select({
      saleId: sales.id,
      saleNumber: sales.saleNumber,
      soldAt: sales.createdAt,
      customerId: sales.customerId,
      customerName: includeCustomerIdentity ? customers.name : sql<string | null>`null`,
      customerEmail: includeCustomerIdentity ? customers.email : sql<string | null>`null`,
      customerPhone: includeCustomerIdentity ? customers.phone : sql<string | null>`null`,
      saleItemId: saleItems.id,
      productId: saleItems.productId,
      productName: saleItems.productNameSnapshot,
      lotId: inventoryLots.id,
      lotNumber: inventoryLots.lotNumber,
      quantity: sql<number>`sum(${saleItemLots.quantity})`,
    })
    .from(pharmacyRecallLots)
    .innerJoin(
      inventoryLots,
      and(eq(inventoryLots.id, pharmacyRecallLots.lotId), eq(inventoryLots.tenantId, tenantId))
    )
    .innerJoin(
      saleItemLots,
      and(eq(saleItemLots.lotId, inventoryLots.id), eq(saleItemLots.tenantId, tenantId))
    )
    .innerJoin(saleItems, eq(saleItems.id, saleItemLots.saleItemId))
    .innerJoin(
      sales,
      and(
        eq(sales.id, saleItems.saleId),
        eq(sales.tenantId, tenantId),
        inArray(sales.status, ['completed', 'voided'])
      )
    )
    .leftJoin(customers, and(eq(customers.id, sales.customerId), eq(customers.tenantId, tenantId)))
    .where(where)
    .groupBy(
      sales.id,
      sales.saleNumber,
      sales.createdAt,
      sales.customerId,
      customers.name,
      customers.email,
      customers.phone,
      saleItems.id,
      saleItems.productId,
      saleItems.productNameSnapshot,
      inventoryLots.id,
      inventoryLots.lotNumber
    )
    .orderBy(desc(sales.createdAt), desc(saleItems.id), desc(inventoryLots.id))
    .limit(input.perPage)
    .offset((page - 1) * input.perPage)
    .all();
  return {
    items: items.map(item => ({
      ...item,
      customerId: includeCustomerIdentity ? item.customerId : null,
      customerEmail: includeCustomerIdentity ? item.customerEmail : null,
      customerPhone: includeCustomerIdentity ? item.customerPhone : null,
      customerIdentityRestricted: !includeCustomerIdentity && item.customerId !== null,
    })),
    total,
    page,
    perPage: input.perPage,
  };
}

export function closePharmacyRecall(
  ctx: CriticalPharmacyContext,
  input: { id: string; reason: string }
) {
  const now = new Date().toISOString();
  return ctx.db.transaction(
    tx => {
      const recall = tx
        .select()
        .from(pharmacyRecalls)
        .where(and(eq(pharmacyRecalls.id, input.id), eq(pharmacyRecalls.tenantId, ctx.tenantId)))
        .get();
      if (!recall) {
        throwServerError({
          trpcCode: 'NOT_FOUND',
          errorCode: 'PHARMACY_RECALL_NOT_FOUND',
          message: 'Pharmacy recall not found',
        });
      }
      if (recall.status !== 'active') {
        throwServerError({
          trpcCode: 'CONFLICT',
          errorCode: 'PHARMACY_LOT_STATE_INVALID',
          message: 'Only an active recall can be closed',
        });
      }
      const changed = tx
        .update(pharmacyRecalls)
        .set({ status: 'closed', closedBy: ctx.user.id, closedAt: now, updatedAt: now })
        .where(
          and(
            eq(pharmacyRecalls.id, recall.id),
            eq(pharmacyRecalls.tenantId, ctx.tenantId),
            eq(pharmacyRecalls.status, 'active')
          )
        )
        .run() as { changes?: number };
      if ((changed.changes ?? 0) !== 1) {
        throwServerError({
          trpcCode: 'CONFLICT',
          errorCode: 'PHARMACY_LOT_STATE_INVALID',
          message: 'The recall changed before it could be closed',
        });
      }
      writeAuditLog({
        tx,
        tenantId: ctx.tenantId,
        actorId: ctx.user.id,
        action: 'pharmacy.recall.close',
        resourceType: 'pharmacy_recall',
        resourceId: recall.id,
        before: { status: 'active' },
        after: { status: 'closed' },
        metadata: { reason: input.reason, lotsRemainBlocked: true },
        operationId: ctx.envelope.operationId,
      });
      enqueueSyncInTransaction(pharmacySyncContext(ctx, tx), {
        entityType: 'pharmacy_recalls',
        entityId: recall.id,
        operation: 'update',
        data: { id: recall.id, status: 'closed', closedAt: now },
      });
      const result = { id: recall.id, status: 'closed' as const, lotsRemainBlocked: true };
      ctx.completeInTransaction(tx, result);
      return result;
    },
    { behavior: 'immediate' }
  );
}

export async function transitionPharmacyLot(
  ctx: CriticalPharmacyContext,
  input: TransitionPharmacyLotInput
) {
  const clock = await resolveTenantBusinessClock(ctx.db, ctx.tenantId);
  return ctx.db.transaction(
    tx => {
      assertTenantBusinessClockCurrent(tx, ctx.tenantId, clock);
      const lot = tx
        .select({
          id: inventoryLots.id,
          siteId: inventoryLots.siteId,
          productId: inventoryLots.productId,
          expiresAt: inventoryLots.expiresAt,
          onHand: inventoryLots.onHand,
          status: inventoryLots.status,
          syncVersion: inventoryLots.syncVersion,
        })
        .from(inventoryLots)
        .innerJoin(
          pharmacyProductProfiles,
          and(
            eq(pharmacyProductProfiles.productId, inventoryLots.productId),
            eq(pharmacyProductProfiles.tenantId, ctx.tenantId)
          )
        )
        .where(and(eq(inventoryLots.id, input.lotId), eq(inventoryLots.tenantId, ctx.tenantId)))
        .get();
      if (!lot) {
        throwServerError({
          trpcCode: 'NOT_FOUND',
          errorCode: 'LOT_NOT_FOUND',
          message: 'Pharmacy lot not found',
        });
      }
      const activeRecall = tx
        .select({ id: pharmacyRecalls.id })
        .from(pharmacyRecallLots)
        .innerJoin(
          pharmacyRecalls,
          and(
            eq(pharmacyRecalls.id, pharmacyRecallLots.recallId),
            eq(pharmacyRecalls.tenantId, ctx.tenantId),
            eq(pharmacyRecalls.status, 'active')
          )
        )
        .where(
          and(eq(pharmacyRecallLots.tenantId, ctx.tenantId), eq(pharmacyRecallLots.lotId, lot.id))
        )
        .get();

      let nextStatus: LotStatus;
      if (input.action === 'release') {
        if ((lot.status !== 'quarantined' && lot.status !== 'recalled') || activeRecall) {
          throwServerError({
            trpcCode: 'PRECONDITION_FAILED',
            errorCode: activeRecall ? 'PHARMACY_RECALL_ACTIVE' : 'PHARMACY_LOT_STATE_INVALID',
            message: 'This lot cannot be released',
          });
        }
        if (lot.status === 'recalled') {
          const underlyingStatus = resolveUnderlyingRecallStatus(tx, ctx.tenantId, lot.id);
          if (!underlyingStatus || underlyingStatus === 'recalled') {
            throwServerError({
              trpcCode: 'PRECONDITION_FAILED',
              errorCode: 'PHARMACY_LOT_STATE_INVALID',
              message: 'The pre-recall lot state cannot be proven',
            });
          }
          // Removing a recall overlay must not implicitly clear a quarantine
          // that existed before it. That requires a separate explicit release.
          nextStatus =
            underlyingStatus === 'expired' ||
            isLotExpiredAt(lot.expiresAt, clock.nowIso, clock.businessDate)
              ? 'expired'
              : underlyingStatus === 'quarantined'
                ? 'quarantined'
                : lot.onHand > 0
                  ? 'active'
                  : 'depleted';
        } else {
          // A direct quarantine release clears that overlay while preserving
          // expiry and zero-stock semantics. Returning quarantined here would
          // make every ordinary quarantine impossible to release.
          nextStatus = isLotExpiredAt(lot.expiresAt, clock.nowIso, clock.businessDate)
            ? 'expired'
            : lot.onHand > 0
              ? 'active'
              : 'depleted';
        }
      } else if (input.action === 'expiration') {
        if (lot.status === 'recalled') {
          throwServerError({
            trpcCode: 'CONFLICT',
            errorCode: 'PHARMACY_LOT_STATE_INVALID',
            message: 'Recall state takes precedence over expiration',
          });
        }
        nextStatus = 'expired';
      } else {
        if (lot.status === 'recalled' || lot.status === 'expired') {
          throwServerError({
            trpcCode: 'CONFLICT',
            errorCode:
              lot.status === 'recalled' ? 'PHARMACY_RECALL_ACTIVE' : 'PHARMACY_LOT_STATE_INVALID',
            message: 'Recall or expiration state takes precedence over quarantine',
          });
        }
        nextStatus = 'quarantined';
      }
      if (nextStatus === lot.status) {
        throwServerError({
          trpcCode: 'CONFLICT',
          errorCode: 'PHARMACY_LOT_STATE_INVALID',
          message: 'The requested lot state is already active',
        });
      }
      const update = tx
        .update(inventoryLots)
        .set({
          status: nextStatus,
          syncStatus: 'pending',
          syncVersion: (lot.syncVersion ?? 0) + 1,
          updatedAt: clock.nowIso,
        })
        .where(
          and(
            eq(inventoryLots.id, lot.id),
            eq(inventoryLots.tenantId, ctx.tenantId),
            eq(inventoryLots.status, lot.status),
            lot.syncVersion === null
              ? isNull(inventoryLots.syncVersion)
              : eq(inventoryLots.syncVersion, lot.syncVersion)
          )
        )
        .run() as { changes?: number };
      if ((update.changes ?? 0) !== 1) {
        throwServerError({
          trpcCode: 'CONFLICT',
          errorCode: 'PHARMACY_LOT_STATE_INVALID',
          message: 'The lot state changed concurrently',
        });
      }
      const eventType =
        input.action === 'cold_chain_incident' ? 'cold_chain_incident' : input.action;
      const sync = pharmacySyncContext(ctx, tx);
      writeInventoryLotEvent(tx, sync, {
        tenantId: ctx.tenantId,
        siteId: lot.siteId,
        productId: lot.productId,
        lotId: lot.id,
        eventType,
        previousStatus: lot.status,
        nextStatus,
        quantitySnapshot: lot.onHand,
        reason: input.reason,
        actorId: ctx.user.id,
        occurredAt: clock.nowIso,
      });
      writeAuditLog({
        tx,
        tenantId: ctx.tenantId,
        actorId: ctx.user.id,
        action: 'pharmacy.lot.transition',
        resourceType: 'inventory_lot',
        resourceId: lot.id,
        before: { status: lot.status },
        after: { status: nextStatus },
        metadata: { eventType, reason: input.reason },
        operationId: ctx.envelope.operationId,
      });
      enqueueSyncInTransaction(sync, {
        entityType: 'inventory_lots',
        entityId: lot.id,
        operation: 'update',
        data: { id: lot.id, status: nextStatus },
      });
      const result = { id: lot.id, previousStatus: lot.status, status: nextStatus };
      ctx.completeInTransaction(tx, result);
      return result;
    },
    { behavior: 'immediate' }
  );
}
