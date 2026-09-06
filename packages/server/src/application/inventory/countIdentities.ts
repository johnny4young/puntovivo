/** Exact physical identity counts; every write runs inside the count command transaction. */
import { roundQuantity } from '@puntovivo/shared/unit-math';
import { and, eq, inArray } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import type { DatabaseInstance } from '../../db/index.js';
import { inventoryCountIdentities, inventoryLots, productSerials } from '../../db/schema.js';
import { throwServerError } from '../../lib/errorCodes.js';
import { normalizeSerialNumber } from '../../services/product-serials.js';
import { writeInventoryLotEvent } from '../../services/pharmacy/lot-events.js';
import { enqueueSyncInTransaction, type EnqueueSyncContext } from '../../services/sync/enqueue.js';

/** Snapshot mode is frozen on the count line, not inferred on read from a mutable product. */
export type CountTrackingMode = 'aggregate' | 'lots' | 'serials';
/** Operator observations identify known physical stock, never create receiving provenance. */
export interface CountIdentityObservation {
  code: string;
  quantity: number;
}
/** Uniform identity projection; sync acknowledgement metadata is deliberately excluded. */
interface CountSource {
  sourceId: string;
  code: string;
  expectedQuantity: number;
  expectedStatus: string;
  expectedCustodyVersion: number;
  expiresAt: string | null;
  unitCost: number;
  stockStatusBeforeMissing: string | null;
}
const MAX_IDENTITIES = 10_000;
const EPSILON = 1e-9;

function invalidIdentities(): never {
  throwServerError({
    trpcCode: 'BAD_REQUEST',
    errorCode: 'INVENTORY_COUNT_IDENTITY_INVALID',
    message: 'Count each known identity once at this site; unknown stock requires a receipt',
  });
}
function changedIdentities(): never {
  throwServerError({
    trpcCode: 'CONFLICT',
    errorCode: 'INVENTORY_COUNT_IDENTITY_CHANGED',
    message: 'Physical custody changed after the count started; reject and start a fresh count',
  });
}

export function countTrackingMode(product: {
  tracksLots: boolean | null;
  tracksSerials: boolean | null;
}): CountTrackingMode {
  if (product.tracksLots && product.tracksSerials) invalidIdentities();
  return product.tracksLots ? 'lots' : product.tracksSerials ? 'serials' : 'aggregate';
}

function loadSources(
  db: DatabaseInstance,
  tenantId: string,
  siteId: string,
  productId: string,
  mode: CountTrackingMode
): CountSource[] {
  if (mode === 'aggregate') return [];
  let sources: CountSource[];
  if (mode === 'lots') {
    sources = db
      .select({
        sourceId: inventoryLots.id,
        code: inventoryLots.lotNumber,
        expectedQuantity: inventoryLots.onHand,
        expectedStatus: inventoryLots.status,
        expectedCustodyVersion: inventoryLots.custodyVersion,
        expiresAt: inventoryLots.expiresAt,
        unitCost: inventoryLots.unitCost,
      })
      .from(inventoryLots)
      .where(
        and(
          eq(inventoryLots.tenantId, tenantId),
          eq(inventoryLots.siteId, siteId),
          eq(inventoryLots.productId, productId)
        )
      )
      .orderBy(inventoryLots.id)
      .limit(MAX_IDENTITIES + 1)
      .all()
      .map(row => ({ ...row, stockStatusBeforeMissing: null }));
  } else {
    const serials = db
      .select()
      .from(productSerials)
      .where(
        and(
          eq(productSerials.tenantId, tenantId),
          eq(productSerials.currentSiteId, siteId),
          eq(productSerials.productId, productId),
          inArray(productSerials.status, ['in_stock', 'returned', 'missing'])
        )
      )
      .orderBy(productSerials.id)
      .limit(MAX_IDENTITIES + 1)
      .all();
    sources = serials.map(row => {
      if (
        row.saleItemId !== null ||
        (row.status === 'missing' &&
          !['in_stock', 'returned'].includes(row.stockStatusBeforeMissing ?? ''))
      )
        changedIdentities();
      return {
        sourceId: row.id,
        code: row.serialNumber,
        expectedQuantity: row.status === 'missing' ? 0 : 1,
        expectedStatus: row.status,
        expectedCustodyVersion: row.custodyVersion,
        expiresAt: row.warrantyExpiresAt,
        unitCost: row.unitCost,
        stockStatusBeforeMissing: row.stockStatusBeforeMissing,
      };
    });
  }
  if (sources.length > MAX_IDENTITIES)
    throwServerError({
      trpcCode: 'BAD_REQUEST',
      errorCode: 'INVENTORY_COUNT_IDENTITY_LIMIT',
      message: 'A counted product exceeds the supported identity snapshot size',
    });
  if (sources.some(row => !Number.isFinite(row.expectedQuantity) || row.expectedQuantity < 0))
    changedIdentities();
  return sources;
}

function rowsForLine(db: DatabaseInstance, tenantId: string, lineId: string) {
  return db
    .select()
    .from(inventoryCountIdentities)
    .where(
      and(
        eq(inventoryCountIdentities.tenantId, tenantId),
        eq(inventoryCountIdentities.lineId, lineId)
      )
    )
    .orderBy(inventoryCountIdentities.sourceId)
    .all();
}

export function snapshotCountIdentities(
  db: DatabaseInstance,
  sync: EnqueueSyncContext,
  input: {
    lineId: string;
    productId: string;
    siteId: string;
    mode: CountTrackingMode;
    expectedQuantity: number;
    now: string;
    remainingIdentities: number;
  }
): number {
  if (input.mode === 'aggregate') return 0;
  const sources = loadSources(db, sync.tenantId, input.siteId, input.productId, input.mode);
  if (sources.length > input.remainingIdentities)
    throwServerError({
      trpcCode: 'BAD_REQUEST',
      errorCode: 'INVENTORY_COUNT_IDENTITY_LIMIT',
      message: 'Split this count into fewer products before capturing identities',
    });
  const total = sources.reduce((sum, row) => sum + row.expectedQuantity, 0);
  if (Math.abs(total - input.expectedQuantity) > EPSILON) {
    throwServerError({
      trpcCode: 'CONFLICT',
      errorCode: 'INVENTORY_COUNT_IDENTITY_TRACKING_REQUIRED',
      message: 'Book balance and physical identity stock must reconcile before opening a count',
    });
  }
  for (const source of sources) {
    const row = {
      id: nanoid(),
      tenantId: sync.tenantId,
      lineId: input.lineId,
      kind: input.mode,
      ...source,
      countedQuantity: null,
      syncStatus: 'pending' as const,
      syncVersion: 1,
      createdAt: input.now,
      updatedAt: input.now,
    };
    db.insert(inventoryCountIdentities).values(row).run();
    enqueueSyncInTransaction(sync, {
      entityType: 'inventory_count_identities',
      entityId: row.id,
      operation: 'create',
      data: row,
    });
  }
  return sources.length;
}

/** Blind serial counts show only identities actually scanned, never the expected inventory list. */
export function readCountIdentities(
  db: DatabaseInstance,
  tenantId: string,
  lineIds: string[],
  reveal: boolean
) {
  const result = new Map<
    string,
    Array<{
      code: string;
      countedQuantity: number | null;
      expectedQuantity: number | null;
      status: string | null;
      expiresAt: string | null;
    }>
  >();
  if (lineIds.length === 0) return result;
  const rows = db
    .select()
    .from(inventoryCountIdentities)
    .where(
      and(
        eq(inventoryCountIdentities.tenantId, tenantId),
        inArray(inventoryCountIdentities.lineId, lineIds)
      )
    )
    .orderBy(inventoryCountIdentities.code)
    .all();
  for (const row of rows) {
    if (!reveal && row.kind === 'serials' && row.countedQuantity !== 1) continue;
    const list = result.get(row.lineId) ?? [];
    list.push({
      code: row.code,
      countedQuantity: row.countedQuantity,
      expectedQuantity: reveal ? row.expectedQuantity : null,
      status: reveal ? row.expectedStatus : null,
      expiresAt: row.kind === 'lots' ? row.expiresAt : null,
    });
    result.set(row.lineId, list);
  }
  return result;
}

export function saveCountIdentities(
  db: DatabaseInstance,
  sync: EnqueueSyncContext,
  input: {
    lineId: string;
    mode: CountTrackingMode;
    countedQuantity: number;
    identities?: CountIdentityObservation[] | undefined;
    now: string;
  }
): void {
  if (input.mode === 'aggregate') {
    if (input.identities !== undefined) invalidIdentities();
    return;
  }
  if (!input.identities) invalidIdentities();
  const observations = input.identities.map(row => ({
    code: input.mode === 'serials' ? normalizeSerialNumber(row.code) : row.code.trim(),
    quantity: roundQuantity(row.quantity),
  }));
  const byCode = new Map(observations.map(row => [row.code, row.quantity]));
  if (
    byCode.size !== observations.length ||
    observations.some(
      row =>
        !Number.isFinite(row.quantity) ||
        row.quantity < 0 ||
        (input.mode === 'serials' && row.quantity !== 1)
    )
  )
    invalidIdentities();
  const rows = rowsForLine(db, sync.tenantId, input.lineId);
  const knownCodes = new Set(rows.map(row => row.code));
  if (
    observations.some(row => !knownCodes.has(row.code)) ||
    (input.mode === 'lots' && rows.length !== observations.length)
  )
    invalidIdentities();
  const total = roundQuantity(observations.reduce((sum, row) => sum + row.quantity, 0));
  if (total !== roundQuantity(input.countedQuantity)) invalidIdentities();
  for (const row of rows) {
    const quantity = byCode.get(row.code) ?? 0;
    const next = {
      ...row,
      countedQuantity: quantity,
      syncStatus: 'pending' as const,
      syncVersion: (row.syncVersion ?? 0) + 1,
      updatedAt: input.now,
    };
    db.update(inventoryCountIdentities)
      .set({
        countedQuantity: quantity,
        syncStatus: 'pending',
        syncVersion: next.syncVersion,
        updatedAt: input.now,
      })
      .where(
        and(
          eq(inventoryCountIdentities.id, row.id),
          eq(inventoryCountIdentities.tenantId, sync.tenantId),
          eq(inventoryCountIdentities.lineId, input.lineId)
        )
      )
      .run();
    enqueueSyncInTransaction(sync, {
      entityType: 'inventory_count_identities',
      entityId: row.id,
      operation: 'update',
      data: next,
    });
  }
}

/** Validate the full identity set, not just a total: equal-quantity substitutions and ABA must fail. */
export function assertCountIdentitiesUnchanged(
  db: DatabaseInstance,
  tenantId: string,
  input: {
    lineId: string;
    mode: CountTrackingMode;
    siteId: string;
    productId: string;
    countedQuantity: number;
  }
) {
  if (input.mode === 'aggregate') return;
  const rows = rowsForLine(db, tenantId, input.lineId);
  const current = loadSources(db, tenantId, input.siteId, input.productId, input.mode);
  if (rows.length !== current.length) changedIdentities();
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index]!;
    const source = current[index]!;
    if (
      row.kind !== input.mode ||
      row.countedQuantity === null ||
      row.sourceId !== source.sourceId ||
      row.code !== source.code ||
      row.expectedQuantity !== source.expectedQuantity ||
      row.expectedStatus !== source.expectedStatus ||
      row.expectedCustodyVersion !== source.expectedCustodyVersion ||
      row.unitCost !== source.unitCost ||
      row.expiresAt !== source.expiresAt ||
      row.stockStatusBeforeMissing !== source.stockStatusBeforeMissing
    )
      changedIdentities();
  }
  if (
    roundQuantity(rows.reduce((sum, row) => sum + (row.countedQuantity ?? 0), 0)) !==
    input.countedQuantity
  )
    invalidIdentities();
}

export function applyCountIdentities(
  db: DatabaseInstance,
  sync: EnqueueSyncContext,
  input: {
    lineId: string;
    mode: CountTrackingMode;
    siteId: string;
    productId: string;
    sessionId: string;
    actorId: string;
    now: string;
  }
) {
  if (input.mode === 'aggregate') return;
  for (const row of rowsForLine(db, sync.tenantId, input.lineId)) {
    if (row.countedQuantity === null) invalidIdentities();
    if (row.countedQuantity === row.expectedQuantity) continue;
    if (input.mode === 'lots') {
      const current = db
        .select()
        .from(inventoryLots)
        .where(
          and(
            eq(inventoryLots.id, row.sourceId),
            eq(inventoryLots.tenantId, sync.tenantId),
            eq(inventoryLots.siteId, input.siteId),
            eq(inventoryLots.productId, input.productId)
          )
        )
        .get();
      if (!current) changedIdentities();
      // Counting is not a release workflow. Rediscovered depleted stock needs
      // explicit inspection; quarantine, recall and expiry always survive.
      const status =
        (current.status === 'depleted' || (current.status === 'active' && current.onHand === 0)) &&
        row.countedQuantity > 0
          ? 'quarantined'
          : current.status === 'active' && row.countedQuantity === 0
            ? 'depleted'
            : current.status;
      const changed = db
        .update(inventoryLots)
        .set({
          onHand: row.countedQuantity,
          status,
          syncStatus: 'pending',
          syncVersion: (current.syncVersion ?? 0) + 1,
          updatedAt: input.now,
        })
        .where(
          and(
            eq(inventoryLots.id, row.sourceId),
            eq(inventoryLots.tenantId, sync.tenantId),
            eq(inventoryLots.siteId, input.siteId),
            eq(inventoryLots.productId, input.productId),
            eq(inventoryLots.custodyVersion, row.expectedCustodyVersion)
          )
        )
        .run();
      if (changed.changes !== 1) changedIdentities();
      if (status === 'quarantined' && status !== current.status)
        writeInventoryLotEvent(db, sync, {
          tenantId: sync.tenantId,
          siteId: input.siteId,
          productId: input.productId,
          lotId: row.sourceId,
          eventType: 'quarantine',
          previousStatus: current.status,
          nextStatus: status,
          quantitySnapshot: row.countedQuantity,
          reason: 'Rediscovered depleted stock requires inspection after a physical count',
          referenceType: 'inventory_count',
          referenceId: input.sessionId,
          actorId: input.actorId,
          occurredAt: input.now,
        });
      const next = db
        .select()
        .from(inventoryLots)
        .where(and(eq(inventoryLots.id, row.sourceId), eq(inventoryLots.tenantId, sync.tenantId)))
        .get()!;
      enqueueSyncInTransaction(sync, {
        entityType: 'inventory_lots',
        entityId: row.sourceId,
        operation: 'update',
        data: next,
      });
    } else {
      const current = db
        .select()
        .from(productSerials)
        .where(
          and(
            eq(productSerials.id, row.sourceId),
            eq(productSerials.tenantId, sync.tenantId),
            eq(productSerials.currentSiteId, input.siteId),
            eq(productSerials.productId, input.productId)
          )
        )
        .get();
      if (!current) changedIdentities();
      const recoveredStatus = current.stockStatusBeforeMissing;
      if (row.countedQuantity === 1 && (current.status !== 'missing' || !recoveredStatus))
        changedIdentities();
      if (
        row.countedQuantity === 0 &&
        current.status !== 'in_stock' &&
        current.status !== 'returned'
      )
        changedIdentities();
      const changed = db
        .update(productSerials)
        .set({
          status: row.countedQuantity === 0 ? 'missing' : recoveredStatus!,
          stockStatusBeforeMissing:
            row.countedQuantity === 0 ? (current.status as 'in_stock' | 'returned') : null,
          syncStatus: 'pending',
          syncVersion: (current.syncVersion ?? 0) + 1,
          updatedAt: input.now,
        })
        .where(
          and(
            eq(productSerials.id, row.sourceId),
            eq(productSerials.tenantId, sync.tenantId),
            eq(productSerials.currentSiteId, input.siteId),
            eq(productSerials.productId, input.productId),
            eq(productSerials.custodyVersion, row.expectedCustodyVersion)
          )
        )
        .run();
      if (changed.changes !== 1) changedIdentities();
      const next = db
        .select()
        .from(productSerials)
        .where(and(eq(productSerials.id, row.sourceId), eq(productSerials.tenantId, sync.tenantId)))
        .get()!;
      enqueueSyncInTransaction(sync, {
        entityType: 'product_serials',
        entityId: row.sourceId,
        operation: 'update',
        data: next,
      });
    }
  }
}
