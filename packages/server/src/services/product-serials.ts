/** ENG-110c — deterministic per-unit receipt, checkout, reversal and lookup. */
import { and, eq, inArray, or } from 'drizzle-orm';
import { nanoid } from 'nanoid';

import type { DatabaseInstance } from '../db/index.js';
import {
  customers,
  productSerials,
  products,
  saleItemSerials,
  saleItems,
  sales,
  sites,
  type ProductSerialStatus,
} from '../db/schema.js';
import { throwServerError } from '../lib/errorCodes.js';
import { roundMoney } from '../lib/money.js';
import { enqueueSyncInTransaction, type EnqueueSyncContext } from './sync/enqueue.js';

type SerialDb = DatabaseInstance;

/** Serial identity is case-insensitive at every API and persistence boundary. */
export function normalizeSerialNumber(value: string): string {
  return value.trim().normalize('NFKC').toLocaleUpperCase('en-US');
}

function assertWholeUnitCount(quantity: number): number {
  if (!Number.isInteger(quantity) || quantity <= 0) {
    throwServerError({
      trpcCode: 'BAD_REQUEST',
      errorCode: 'PRODUCT_SERIAL_QUANTITY_WHOLE_REQUIRED',
      message: 'Serialized products must be sold as whole base units',
      details: { quantity },
    });
  }
  return quantity;
}

function enqueueSerialSnapshot(
  syncContext: EnqueueSyncContext | undefined,
  serial: Record<string, unknown>,
  operation: 'create' | 'update'
): void {
  if (!syncContext || typeof serial.id !== 'string') return;
  enqueueSyncInTransaction(syncContext, {
    entityType: 'product_serials',
    entityId: serial.id,
    operation,
    data: serial,
  });
}

function enqueueSaleItemSerialSnapshot(
  syncContext: EnqueueSyncContext | undefined,
  row: Record<string, unknown>
): void {
  if (!syncContext || typeof row.id !== 'string') return;
  enqueueSyncInTransaction(syncContext, {
    entityType: 'sale_item_serials',
    entityId: row.id,
    operation: 'create',
    data: row,
  });
}

export function receiveProductSerialUnits(
  db: SerialDb,
  input: {
    tenantId: string;
    siteId: string;
    productId: string;
    serialNumbers: string[];
    unitCost: number;
    warrantyExpiresAt: string | null;
    notes: string | null;
    now: string;
    syncContext?: EnqueueSyncContext;
  }
) {
  const normalizedSerialNumbers = input.serialNumbers.map(normalizeSerialNumber);
  if (
    normalizedSerialNumbers.some(serialNumber => serialNumber.length === 0) ||
    new Set(normalizedSerialNumbers).size !== normalizedSerialNumbers.length
  ) {
    throwServerError({
      trpcCode: 'BAD_REQUEST',
      errorCode: 'PRODUCT_SERIAL_DUPLICATE',
      message: 'Serial numbers must be non-empty and unique within a receipt',
    });
  }

  const existing = db
    .select({ serialNumber: productSerials.serialNumber })
    .from(productSerials)
    .where(
      and(
        eq(productSerials.tenantId, input.tenantId),
        eq(productSerials.productId, input.productId),
        inArray(productSerials.serialNumber, normalizedSerialNumbers)
      )
    )
    .all();
  if (existing.length > 0) {
    throwServerError({
      trpcCode: 'CONFLICT',
      errorCode: 'PRODUCT_SERIAL_DUPLICATE',
      message: 'One or more serial numbers already exist for this product',
      details: { serialNumbers: existing.map(row => row.serialNumber) },
    });
  }

  const rows = normalizedSerialNumbers.map(serialNumber => ({
    id: nanoid(),
    tenantId: input.tenantId,
    currentSiteId: input.siteId,
    productId: input.productId,
    serialNumber,
    status: 'in_stock' as const,
    saleItemId: null,
    unitCost: roundMoney(input.unitCost),
    warrantyExpiresAt: input.warrantyExpiresAt,
    receivedAt: input.now,
    soldAt: null,
    returnedAt: null,
    notes: input.notes,
    syncStatus: 'pending' as const,
    syncVersion: 1,
    createdAt: input.now,
    updatedAt: input.now,
  }));

  for (const row of rows) {
    db.insert(productSerials).values(row).run();
    enqueueSerialSnapshot(input.syncContext, row, 'create');
  }
  return rows;
}

export function assignProductSerialsToSaleLine(
  db: SerialDb,
  input: {
    tenantId: string;
    siteId: string;
    productId: string;
    saleItemId: string;
    serialIds: string[];
    normalizedQuantity: number;
    targetStatus: 'reserved' | 'sold';
    now: string;
    syncContext?: EnqueueSyncContext;
  }
): void {
  const requiredCount = assertWholeUnitCount(input.normalizedQuantity);
  const uniqueIds = [...new Set(input.serialIds)];
  if (uniqueIds.length !== requiredCount || uniqueIds.length !== input.serialIds.length) {
    throwServerError({
      trpcCode: 'BAD_REQUEST',
      errorCode: 'PRODUCT_SERIAL_SELECTION_REQUIRED',
      message: 'Select exactly one unique serial number per serialized unit',
      details: { requiredCount, selectedCount: uniqueIds.length },
    });
  }

  const selected = db
    .select()
    .from(productSerials)
    .where(
      and(
        eq(productSerials.tenantId, input.tenantId),
        eq(productSerials.currentSiteId, input.siteId),
        eq(productSerials.productId, input.productId),
        inArray(productSerials.id, uniqueIds),
        or(eq(productSerials.status, 'in_stock'), eq(productSerials.status, 'returned'))
      )
    )
    .all();
  if (selected.length !== requiredCount) {
    throwServerError({
      trpcCode: 'CONFLICT',
      errorCode: 'PRODUCT_SERIAL_UNAVAILABLE',
      message: 'A selected serial number is unavailable at this sale site',
      details: { requiredCount, availableCount: selected.length },
    });
  }

  for (const serial of selected) {
    const next = {
      ...serial,
      status: input.targetStatus,
      saleItemId: input.saleItemId,
      soldAt: input.targetStatus === 'sold' ? input.now : null,
      returnedAt: null,
      syncStatus: 'pending' as const,
      syncVersion: (serial.syncVersion ?? 0) + 1,
      updatedAt: input.now,
    };
    const applied = db
      .update(productSerials)
      .set({
        status: next.status,
        saleItemId: next.saleItemId,
        soldAt: next.soldAt,
        returnedAt: null,
        syncStatus: 'pending',
        syncVersion: next.syncVersion,
        updatedAt: input.now,
      })
      .where(
        and(
          eq(productSerials.id, serial.id),
          eq(productSerials.tenantId, input.tenantId),
          eq(productSerials.currentSiteId, input.siteId),
          eq(productSerials.productId, input.productId),
          or(eq(productSerials.status, 'in_stock'), eq(productSerials.status, 'returned'))
        )
      )
      .run();
    if (applied.changes !== 1) {
      throwServerError({
        trpcCode: 'CONFLICT',
        errorCode: 'PRODUCT_SERIAL_UNAVAILABLE',
        message: 'A selected serial number changed during checkout',
      });
    }

    const historyRow = {
      id: nanoid(),
      tenantId: input.tenantId,
      saleItemId: input.saleItemId,
      productSerialId: serial.id,
      serialNumber: serial.serialNumber,
      createdAt: input.now,
    };
    db.insert(saleItemSerials).values(historyRow).run();
    enqueueSaleItemSerialSnapshot(input.syncContext, historyRow);
    enqueueSerialSnapshot(input.syncContext, next, 'update');
  }
}

export function transitionSaleSerials(
  db: SerialDb,
  input: {
    tenantId: string;
    saleItemIds: string[];
    from: ProductSerialStatus;
    to: ProductSerialStatus;
    now: string;
    clearSaleItem?: boolean;
    syncContext?: EnqueueSyncContext;
  }
): string[] {
  if (input.saleItemIds.length === 0) return [];
  const serializedLines = db
    .select({
      saleItemId: saleItems.id,
      quantity: saleItems.quantity,
      unitEquivalence: saleItems.unitEquivalence,
    })
    .from(saleItems)
    .innerJoin(
      sales,
      and(eq(saleItems.saleId, sales.id), eq(sales.tenantId, input.tenantId))
    )
    .innerJoin(
      products,
      and(eq(saleItems.productId, products.id), eq(products.tenantId, input.tenantId))
    )
    .where(
      and(inArray(saleItems.id, input.saleItemIds), eq(products.tracksSerials, true))
    )
    .all();
  const expectedSerialCount = serializedLines.reduce(
    (total, line) => total + assertWholeUnitCount(line.quantity * line.unitEquivalence),
    0
  );
  const historyRows = db
    .select({
      saleItemId: saleItemSerials.saleItemId,
      productSerialId: saleItemSerials.productSerialId,
    })
    .from(saleItemSerials)
    .where(
      and(
        eq(saleItemSerials.tenantId, input.tenantId),
        inArray(saleItemSerials.saleItemId, input.saleItemIds)
      )
    )
    .all();
  if (historyRows.length !== expectedSerialCount) {
    throwServerError({
      trpcCode: 'CONFLICT',
      errorCode: 'PRODUCT_SERIAL_UNAVAILABLE',
      message: 'Serialized sale provenance no longer matches the recorded sale quantity',
      details: { expectedCount: expectedSerialCount, historyCount: historyRows.length },
    });
  }
  if (historyRows.length === 0) return [];

  const serialIds = [...new Set(historyRows.map(row => row.productSerialId))];
  const rows = db
    .select()
    .from(productSerials)
    .where(
      and(
        eq(productSerials.tenantId, input.tenantId),
        inArray(productSerials.id, serialIds),
        inArray(productSerials.saleItemId, input.saleItemIds),
        eq(productSerials.status, input.from)
      )
    )
    .all();
  if (rows.length !== serialIds.length) {
    throwServerError({
      trpcCode: 'CONFLICT',
      errorCode: 'PRODUCT_SERIAL_UNAVAILABLE',
      message: 'Serialized sale provenance no longer matches the current unit registry',
      details: { expectedCount: serialIds.length, availableCount: rows.length },
    });
  }
  for (const serial of rows) {
    const next = {
      ...serial,
      status: input.to,
      saleItemId: input.clearSaleItem ? null : serial.saleItemId,
      soldAt: input.to === 'sold' ? input.now : input.clearSaleItem ? null : serial.soldAt,
      returnedAt: input.to === 'returned' ? input.now : null,
      syncStatus: 'pending' as const,
      syncVersion: (serial.syncVersion ?? 0) + 1,
      updatedAt: input.now,
    };
    const applied = db
      .update(productSerials)
      .set({
        status: next.status,
        saleItemId: next.saleItemId,
        soldAt: next.soldAt,
        returnedAt: next.returnedAt,
        syncStatus: 'pending',
        syncVersion: next.syncVersion,
        updatedAt: input.now,
      })
      .where(
        and(
          eq(productSerials.id, serial.id),
          eq(productSerials.tenantId, input.tenantId),
          eq(productSerials.status, input.from)
        )
      )
      .run();
    if (applied.changes !== 1) {
      throwServerError({
        trpcCode: 'CONFLICT',
        errorCode: 'PRODUCT_SERIAL_UNAVAILABLE',
        message: 'A serialized unit changed during the sale lifecycle transition',
      });
    }
    enqueueSerialSnapshot(input.syncContext, next, 'update');
  }
  return rows.map(row => row.id);
}

export function listProductSerialUnits(
  db: SerialDb,
  input: { tenantId: string; siteId: string; productId: string; sellableOnly: boolean }
) {
  return db
    .select()
    .from(productSerials)
    .where(
      and(
        eq(productSerials.tenantId, input.tenantId),
        eq(productSerials.currentSiteId, input.siteId),
        eq(productSerials.productId, input.productId),
        ...(input.sellableOnly
          ? [or(eq(productSerials.status, 'in_stock'), eq(productSerials.status, 'returned'))!]
          : [])
      )
    )
    .orderBy(productSerials.serialNumber)
    .all();
}

export function lookupProductSerialWarranty(
  db: SerialDb,
  input: { tenantId: string; serialNumber: string }
) {
  const registryRows = db
    .select({
      id: productSerials.id,
      serialNumber: productSerials.serialNumber,
      status: productSerials.status,
      currentSiteId: productSerials.currentSiteId,
      receivedAt: productSerials.receivedAt,
      soldAt: productSerials.soldAt,
      returnedAt: productSerials.returnedAt,
      warrantyExpiresAt: productSerials.warrantyExpiresAt,
      productId: products.id,
      productName: products.name,
      productSku: products.sku,
      saleId: sales.id,
      saleNumber: sales.saleNumber,
      customerId: customers.id,
      customerName: customers.name,
      currentSiteName: sites.name,
    })
    .from(productSerials)
    .innerJoin(products, eq(productSerials.productId, products.id))
    .innerJoin(sites, eq(productSerials.currentSiteId, sites.id))
    .leftJoin(saleItems, eq(productSerials.saleItemId, saleItems.id))
    .leftJoin(sales, eq(saleItems.saleId, sales.id))
    .leftJoin(customers, eq(sales.customerId, customers.id))
    .where(
      and(
        eq(productSerials.tenantId, input.tenantId),
        eq(productSerials.serialNumber, normalizeSerialNumber(input.serialNumber))
      )
    )
    .all();

  return registryRows.map(registry => {
    const history = db
      .select({
        saleItemSerialId: saleItemSerials.id,
        saleItemId: saleItemSerials.saleItemId,
        saleId: sales.id,
        saleNumber: sales.saleNumber,
        saleStatus: sales.status,
        paymentStatus: sales.paymentStatus,
        customerId: customers.id,
        customerName: customers.name,
        soldAt: sales.createdAt,
      })
      .from(saleItemSerials)
      .innerJoin(saleItems, eq(saleItemSerials.saleItemId, saleItems.id))
      .innerJoin(sales, eq(saleItems.saleId, sales.id))
      .leftJoin(customers, eq(sales.customerId, customers.id))
      .where(
        and(
          eq(saleItemSerials.tenantId, input.tenantId),
          eq(saleItemSerials.productSerialId, registry.id)
        )
      )
      .orderBy(sales.createdAt)
      .all();
    return { ...registry, history };
  });
}

export function listSaleItemSerialNumbers(
  db: SerialDb,
  input: { tenantId: string; saleItemIds: string[] }
): Map<string, string[]> {
  if (input.saleItemIds.length === 0) return new Map();
  const rows = db
    .select({
      saleItemId: saleItemSerials.saleItemId,
      serialNumber: saleItemSerials.serialNumber,
    })
    .from(saleItemSerials)
    .where(
      and(
        eq(saleItemSerials.tenantId, input.tenantId),
        inArray(saleItemSerials.saleItemId, input.saleItemIds)
      )
    )
    .orderBy(saleItemSerials.serialNumber)
    .all();
  const bySaleItem = new Map<string, string[]>();
  for (const row of rows) {
    const serialNumbers = bySaleItem.get(row.saleItemId) ?? [];
    serialNumbers.push(row.serialNumber);
    bySaleItem.set(row.saleItemId, serialNumbers);
  }
  return bySaleItem;
}
