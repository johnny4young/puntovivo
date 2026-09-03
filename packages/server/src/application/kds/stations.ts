/** Resolve frozen site-local preparation routes without per-item catalog queries. */
import { and, eq, inArray, or } from 'drizzle-orm';
import type { DatabaseInstance } from '../../db/index.js';
import { kdsRoutingRules, kdsStations, type KdsStationRow } from '../../db/schema.js';
import { throwServerError } from '../../lib/errorCodes.js';
import type { KdsWriteScope } from './common.js';

/** The fallback is application configuration, not a claim of physical hardware. */
export function ensureMainKitchenStation(
  tx: DatabaseInstance,
  scope: KdsWriteScope
): KdsStationRow {
  let row = tx
    .select()
    .from(kdsStations)
    .where(
      and(
        eq(kdsStations.tenantId, scope.tenantId),
        eq(kdsStations.siteId, scope.siteId),
        eq(kdsStations.code, 'main')
      )
    )
    .get();
  if (!row) {
    tx.insert(kdsStations)
      .values({
        id: `kds-main:${scope.siteId}`,
        tenantId: scope.tenantId,
        siteId: scope.siteId,
        code: 'main',
        name: 'main',
      })
      .run();
    row = tx
      .select()
      .from(kdsStations)
      .where(
        and(
          eq(kdsStations.id, `kds-main:${scope.siteId}`),
          eq(kdsStations.tenantId, scope.tenantId),
          eq(kdsStations.siteId, scope.siteId)
        )
      )
      .get();
  }
  if (!row?.isActive) {
    throwServerError({
      trpcCode: 'CONFLICT',
      errorCode: 'KDS_CONFIGURATION_INVALID',
      message: 'The main kitchen station is unavailable',
    });
  }
  return row;
}

/** Product id/category pairs are tenant-validated by the submission's catalog join. */
export function resolveKitchenRoutes(
  tx: DatabaseInstance,
  scope: KdsWriteScope,
  items: ReadonlyArray<{ productId: string; categoryId: string | null }>
): Map<string, KdsStationRow | null> {
  const productIds = [...new Set(items.map(item => item.productId))];
  const categoryIds = [
    ...new Set(items.flatMap(item => (item.categoryId ? [item.categoryId] : []))),
  ];
  const rules = tx
    .select()
    .from(kdsRoutingRules)
    .where(
      and(
        eq(kdsRoutingRules.tenantId, scope.tenantId),
        eq(kdsRoutingRules.siteId, scope.siteId),
        or(
          and(
            eq(kdsRoutingRules.targetKind, 'product'),
            inArray(kdsRoutingRules.targetId, productIds)
          ),
          and(
            eq(kdsRoutingRules.targetKind, 'category'),
            inArray(kdsRoutingRules.targetId, categoryIds)
          )
        )
      )
    )
    .all();
  const ruleByTarget = new Map(rules.map(rule => [`${rule.targetKind}:${rule.targetId}`, rule]));
  const stationIds = [...new Set(rules.flatMap(rule => (rule.stationId ? [rule.stationId] : [])))];
  const stations = stationIds.length
    ? tx
        .select()
        .from(kdsStations)
        .where(
          and(
            eq(kdsStations.tenantId, scope.tenantId),
            eq(kdsStations.siteId, scope.siteId),
            eq(kdsStations.isActive, true),
            inArray(kdsStations.id, stationIds)
          )
        )
        .all()
    : [];
  const stationById = new Map(stations.map(station => [station.id, station]));
  const result = new Map<string, KdsStationRow | null>();
  let fallback: KdsStationRow | undefined;
  for (const item of items) {
    const rule =
      ruleByTarget.get(`product:${item.productId}`) ??
      (item.categoryId ? ruleByTarget.get(`category:${item.categoryId}`) : undefined);
    if (!rule) {
      fallback ??= ensureMainKitchenStation(tx, scope);
      result.set(item.productId, fallback);
    } else if (rule.route === 'exclude') {
      result.set(item.productId, null);
    } else {
      const station = rule.stationId ? stationById.get(rule.stationId) : undefined;
      if (!station) {
        throwServerError({
          trpcCode: 'CONFLICT',
          errorCode: 'KDS_CONFIGURATION_INVALID',
          message: 'Kitchen routing points to an unavailable station',
        });
      }
      result.set(item.productId, station);
    }
  }
  return result;
}
