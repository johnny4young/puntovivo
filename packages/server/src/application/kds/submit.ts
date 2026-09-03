/** Persist a preparation submission and its durable invalidation under the sale writer. */
import { and, count, eq, inArray } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import type { DatabaseInstance } from '../../db/index.js';
import {
  kdsLineDispatches,
  kdsOrderLines,
  kdsOrders,
  products,
  restaurantCheckLines,
  restaurantCourses,
  restaurantDiners,
  restaurantLineModifiers,
  restaurantRounds,
  saleItems,
  sales,
  units,
  type KdsModifierSnapshot,
  type KdsStationRow,
} from '../../db/schema.js';
import { throwServerError } from '../../lib/errorCodes.js';
import {
  isKdsActive,
  KDS_MAX_LINES,
  loadKitchenSale,
  requireKdsSite,
  type KdsWriteScope,
} from './common.js';
import { insertKitchenEvent } from './events.js';
import { adoptLegacyKitchenSale } from './legacy.js';
import { resolveKitchenRoutes } from './stations.js';
import { validateKitchenSnapshots } from './snapshot.js';

/** Bounded current sale-line query; snapshots prefer the already frozen sale name. */
function loadLines(tx: DatabaseInstance, scope: KdsWriteScope, saleId: string) {
  const rows = tx
    .select({
      saleItemId: saleItems.id,
      productId: saleItems.productId,
      frozenName: saleItems.productNameSnapshot,
      catalogName: products.name,
      categoryId: products.categoryId,
      quantity: saleItems.quantity,
      notes: saleItems.notes,
      unitLabel: units.abbreviation,
      checkLineId: restaurantCheckLines.id,
      roundId: restaurantCheckLines.roundId,
      roundLabel: restaurantRounds.label,
      courseKey: restaurantCourses.courseKey,
      dinerLabel: restaurantDiners.label,
    })
    .from(saleItems)
    .innerJoin(sales, and(eq(sales.id, saleItems.saleId), eq(sales.tenantId, scope.tenantId)))
    .innerJoin(
      products,
      and(eq(products.id, saleItems.productId), eq(products.tenantId, scope.tenantId))
    )
    .leftJoin(units, and(eq(units.id, saleItems.unitId), eq(units.tenantId, scope.tenantId)))
    .leftJoin(
      restaurantCheckLines,
      and(
        eq(restaurantCheckLines.saleItemId, saleItems.id),
        eq(restaurantCheckLines.tenantId, scope.tenantId)
      )
    )
    .leftJoin(
      restaurantRounds,
      and(
        eq(restaurantRounds.id, restaurantCheckLines.roundId),
        eq(restaurantRounds.tenantId, scope.tenantId)
      )
    )
    .leftJoin(
      restaurantCourses,
      and(
        eq(restaurantCourses.id, restaurantCheckLines.courseId),
        eq(restaurantCourses.tenantId, scope.tenantId)
      )
    )
    .leftJoin(
      restaurantDiners,
      and(
        eq(restaurantDiners.id, restaurantCheckLines.dinerId),
        eq(restaurantDiners.tenantId, scope.tenantId)
      )
    )
    .where(eq(saleItems.saleId, saleId))
    .limit(KDS_MAX_LINES + 1)
    .all();
  if (rows.length > KDS_MAX_LINES) {
    throwServerError({
      trpcCode: 'BAD_REQUEST',
      errorCode: 'KDS_ORDER_LIMIT_EXCEEDED',
      message: 'Kitchen submission exceeds its line bound',
    });
  }
  const expected =
    tx
      .select({ value: count() })
      .from(saleItems)
      .innerJoin(sales, and(eq(sales.id, saleItems.saleId), eq(sales.tenantId, scope.tenantId)))
      .where(eq(saleItems.saleId, saleId))
      .get()?.value ?? 0;
  if (expected !== rows.length || new Set(rows.map(row => row.saleItemId)).size !== rows.length) {
    throwServerError({
      trpcCode: 'CONFLICT',
      errorCode: 'KDS_SNAPSHOT_INVALID',
      message: 'Kitchen catalog projection is incomplete',
    });
  }
  return rows;
}

/**
 * New order and stock/cash writes either all commit or all roll back. Repeated
 * calls, checkout and financial splits cannot send a source line twice. The
 * caller must already own an immediate transaction; no await occurs here.
 */
export function submitKitchenSaleInTransaction(
  tx: DatabaseInstance,
  scope: KdsWriteScope,
  saleId: string
): string[] {
  if (!isKdsActive(tx, scope.tenantId)) return [];
  requireKdsSite(tx, scope.tenantId, scope.siteId);
  const sale = loadKitchenSale(tx, scope, saleId);
  if (sale.status !== 'draft' && sale.status !== 'completed') return [];
  adoptLegacyKitchenSale(tx, scope, saleId);
  const rows = loadLines(tx, scope, saleId);
  if (!rows.length) return [];
  const decided = tx
    .select({
      sourceSaleItemId: kdsLineDispatches.sourceSaleItemId,
      siteId: kdsLineDispatches.siteId,
    })
    .from(kdsLineDispatches)
    .where(
      and(
        eq(kdsLineDispatches.tenantId, scope.tenantId),
        inArray(
          kdsLineDispatches.sourceSaleItemId,
          rows.map(row => row.saleItemId)
        )
      )
    )
    .all();
  if (decided.some(row => row.siteId !== scope.siteId)) {
    throwServerError({
      trpcCode: 'CONFLICT',
      errorCode: 'KDS_SNAPSHOT_INVALID',
      message: 'Kitchen dispatch belongs to a different site',
    });
  }
  const decidedIds = new Set(decided.map(row => row.sourceSaleItemId));
  const pending = rows.filter(row => !decidedIds.has(row.saleItemId));
  if (!pending.length) return [];
  const routes = resolveKitchenRoutes(tx, scope, pending);
  const checkLineIds = pending.flatMap(row => (row.checkLineId ? [row.checkLineId] : []));
  const modifiers = checkLineIds.length
    ? tx
        .select({
          checkLineId: restaurantLineModifiers.checkLineId,
          name: restaurantLineModifiers.name,
          quantity: restaurantLineModifiers.quantity,
        })
        .from(restaurantLineModifiers)
        .where(
          and(
            eq(restaurantLineModifiers.tenantId, scope.tenantId),
            inArray(restaurantLineModifiers.checkLineId, checkLineIds)
          )
        )
        .orderBy(restaurantLineModifiers.position)
        .limit(KDS_MAX_LINES * 20 + 1)
        .all()
    : [];
  if (modifiers.length > KDS_MAX_LINES * 20) {
    throwServerError({
      trpcCode: 'CONFLICT',
      errorCode: 'KDS_ORDER_LIMIT_EXCEEDED',
      message: 'Kitchen modifier projection exceeds its bound',
    });
  }
  const modifiersByLine = new Map<string, KdsModifierSnapshot[]>();
  for (const modifier of modifiers) {
    const values = modifiersByLine.get(modifier.checkLineId) ?? [];
    values.push({ name: modifier.name, quantity: modifier.quantity });
    modifiersByLine.set(modifier.checkLineId, values);
  }
  const groups = new Map<string, { station: KdsStationRow; rows: typeof pending }>();
  for (const row of pending) {
    const station = routes.get(row.productId);
    if (station === undefined) {
      throwServerError({
        trpcCode: 'CONFLICT',
        errorCode: 'KDS_CONFIGURATION_INVALID',
        message: 'Kitchen route was not resolved',
      });
    }
    if (station === null) {
      tx.insert(kdsLineDispatches)
        .values({
          id: nanoid(),
          tenantId: scope.tenantId,
          siteId: scope.siteId,
          sourceSaleItemId: row.saleItemId,
          route: 'exclude',
        })
        .run();
      continue;
    }
    const key = `${station.id}:${row.roundId ?? 'unstructured'}`;
    const group = groups.get(key) ?? { station, rows: [] };
    group.rows.push(row);
    groups.set(key, group);
  }
  const createdOrderIds: string[] = [];
  for (const { station, rows: groupRows } of groups.values()) {
    const now = new Date().toISOString();
    const id = nanoid();
    const snapshots = validateKitchenSnapshots(
      groupRows.map(row => ({
        saleItemId: row.saleItemId,
        productId: row.productId,
        productName: row.frozenName ?? row.catalogName,
        quantity: row.quantity,
        unitLabel: row.unitLabel,
        notes: row.notes,
        roundId: row.roundId,
        roundLabel: row.roundLabel,
        courseKey: row.courseKey,
        dinerLabel: row.dinerLabel,
        modifiers: row.checkLineId ? (modifiersByLine.get(row.checkLineId) ?? []) : [],
      }))
    );
    const order = tx
      .insert(kdsOrders)
      .values({
        id,
        tenantId: scope.tenantId,
        siteId: scope.siteId,
        saleId,
        saleNumber: sale.saleNumber,
        tableId: sale.tableId,
        tableLabel: sale.tableLabel,
        station: station.code,
        stationName: station.name,
        dispatchKey: nanoid(),
        snapshotVersion: 2,
        version: 1,
        itemsJson: JSON.stringify(snapshots),
        notes: sale.notes,
        createdAt: now,
        updatedAt: now,
      })
      .returning()
      .get();
    for (const snapshot of snapshots) {
      const lineId = nanoid();
      tx.insert(kdsOrderLines)
        .values({
          id: lineId,
          tenantId: scope.tenantId,
          orderId: id,
          sourceSaleItemId: snapshot.saleItemId,
          productId: snapshot.productId,
          productName: snapshot.productName,
          quantity: snapshot.quantity,
          unitLabel: snapshot.unitLabel,
          notes: snapshot.notes,
          roundId: snapshot.roundId,
          roundLabel: snapshot.roundLabel,
          courseKey: snapshot.courseKey,
          dinerLabel: snapshot.dinerLabel,
          modifiers: snapshot.modifiers,
          currentSaleId: saleId,
          currentTableId: sale.tableId,
          currentTableLabel: sale.tableLabel,
          createdAt: now,
          updatedAt: now,
        })
        .run();
      tx.insert(kdsLineDispatches)
        .values({
          id: nanoid(),
          tenantId: scope.tenantId,
          siteId: scope.siteId,
          sourceSaleItemId: snapshot.saleItemId,
          route: 'station',
          stationCode: station.code,
          orderLineId: lineId,
        })
        .run();
    }
    insertKitchenEvent(tx, order, {
      kind: 'submitted',
      actorId: scope.actorId,
      facts: { lineCount: snapshots.length, sourceSaleId: saleId },
    });
    createdOrderIds.push(id);
  }
  return createdOrderIds;
}
