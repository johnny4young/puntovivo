/** Configuration affects future dispatches only; submitted identities remain immutable. */
import { and, eq, sql } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import type { DatabaseInstance } from '../../db/index.js';
import { categories, products, kdsRoutingRules, kdsStations, kdsOrders } from '../../db/schema.js';
import { throwServerError } from '../../lib/errorCodes.js';
import { writeAuditLog } from '../../services/audit-logs.js';
import type {
  SaveKitchenStationInput,
  SaveKitchenRouteInput,
  KitchenTargetInput,
} from '../../trpc/schemas/kdsConfiguration.js';
import { isKdsActive, requireKdsSite, type KdsWriteScope } from './common.js';

/** Authenticated scope plus explicit selected site, checked again inside the writer. */
export interface KitchenConfigurationContext extends KdsWriteScope {
  db: DatabaseInstance;
}
export function withKitchenConfiguration<T>(
  context: KitchenConfigurationContext,
  action: (tx: DatabaseInstance) => T
): T {
  return context.db.transaction(
    rawTx => {
      const tx = rawTx as unknown as DatabaseInstance;
      requireKdsSite(tx, context.tenantId, context.siteId);
      if (!isKdsActive(tx, context.tenantId))
        throwServerError({
          trpcCode: 'FORBIDDEN',
          errorCode: 'MODULE_NOT_ACTIVATED',
          message: 'Kitchen display is not active',
          details: { moduleId: 'kds' },
        });
      return action(tx);
    },
    { behavior: 'immediate' }
  );
}
function requireVersion(actual: number, expected: number): void {
  if (actual !== expected)
    throwServerError({
      trpcCode: 'CONFLICT',
      errorCode: 'STALE_VERSION',
      message: 'Kitchen configuration changed; refresh before saving',
    });
}
function invalidConfiguration(): never {
  return throwServerError({
    trpcCode: 'BAD_REQUEST',
    errorCode: 'KDS_CONFIGURATION_INVALID',
    message: 'Kitchen configuration is not valid in this site',
  });
}

export function saveKitchenStation(
  context: KitchenConfigurationContext,
  input: SaveKitchenStationInput
) {
  return withKitchenConfiguration(context, tx => {
    const scope = and(
      eq(kdsStations.tenantId, context.tenantId),
      eq(kdsStations.siteId, context.siteId),
      eq(kdsStations.code, input.code)
    );
    const before = tx.select().from(kdsStations).where(scope).get();
    requireVersion(before?.version ?? 0, input.expectedVersion);
    if (!input.isActive) {
      const referenced =
        before &&
        tx
          .select({ id: kdsRoutingRules.id })
          .from(kdsRoutingRules)
          .where(
            and(
              eq(kdsRoutingRules.tenantId, context.tenantId),
              eq(kdsRoutingRules.siteId, context.siteId),
              eq(kdsRoutingRules.stationId, before.id)
            )
          )
          .limit(1)
          .get();
      const pending = tx
        .select({ id: kdsOrders.id })
        .from(kdsOrders)
        .where(
          and(
            eq(kdsOrders.tenantId, context.tenantId),
            eq(kdsOrders.siteId, context.siteId),
            eq(kdsOrders.station, input.code),
            eq(kdsOrders.status, 'pending')
          )
        )
        .limit(1)
        .get();
      if (input.code === 'main' || referenced || pending)
        throwServerError({
          trpcCode: 'CONFLICT',
          errorCode: 'KDS_STATION_IN_USE',
          message: 'Kitchen station has active work or routing',
        });
    }
    if (!before) {
      const count = tx
        .select({ count: sql<number>`count(*)` })
        .from(kdsStations)
        .where(
          and(eq(kdsStations.tenantId, context.tenantId), eq(kdsStations.siteId, context.siteId))
        )
        .get()!.count;
      // Reserve a slot for the mandatory fallback even before its first dispatch.
      const main = tx
        .select({ id: kdsStations.id })
        .from(kdsStations)
        .where(
          and(
            eq(kdsStations.tenantId, context.tenantId),
            eq(kdsStations.siteId, context.siteId),
            eq(kdsStations.code, 'main')
          )
        )
        .get();
      if (count >= (input.code === 'main' || main ? 64 : 63)) invalidConfiguration();
    }
    const patch = {
      name: input.name,
      isActive: input.isActive,
      position: input.position,
      version: (before?.version ?? 0) + 1,
      updatedAt: new Date().toISOString(),
    };
    const after = before
      ? tx
          .update(kdsStations)
          .set(patch)
          .where(and(scope, eq(kdsStations.version, input.expectedVersion)))
          .returning()
          .get()
      : tx
          .insert(kdsStations)
          .values({
            ...patch,
            id: nanoid(),
            tenantId: context.tenantId,
            siteId: context.siteId,
            code: input.code,
          })
          .returning()
          .get();
    if (!after) requireVersion(-1, input.expectedVersion);
    writeAuditLog({
      tx,
      tenantId: context.tenantId,
      actorId: context.actorId,
      action: 'kds.station.saved',
      resourceType: 'kds_configuration',
      resourceId: after!.id,
      before: before ?? null,
      after: after!,
    });
    return after!;
  });
}

export function saveKitchenRoute(
  context: KitchenConfigurationContext,
  input: SaveKitchenRouteInput
) {
  return withKitchenConfiguration(context, tx => {
    const catalog = input.targetKind === 'product' ? products : categories;
    if (
      !tx
        .select({ id: catalog.id })
        .from(catalog)
        .where(and(eq(catalog.id, input.targetId), eq(catalog.tenantId, context.tenantId)))
        .get()
    )
      invalidConfiguration();
    if (
      input.route === 'station' &&
      !tx
        .select({ id: kdsStations.id })
        .from(kdsStations)
        .where(
          and(
            eq(kdsStations.id, input.stationId!),
            eq(kdsStations.tenantId, context.tenantId),
            eq(kdsStations.siteId, context.siteId),
            eq(kdsStations.isActive, true)
          )
        )
        .get()
    )
      invalidConfiguration();
    const scope = and(
      eq(kdsRoutingRules.tenantId, context.tenantId),
      eq(kdsRoutingRules.siteId, context.siteId),
      eq(kdsRoutingRules.targetKind, input.targetKind),
      eq(kdsRoutingRules.targetId, input.targetId)
    );
    const before = tx.select().from(kdsRoutingRules).where(scope).get();
    // Row identity fences deletion/recreation ABA even if its version resets to one.
    if ((before?.id ?? null) !== input.expectedRuleId) requireVersion(-1, input.expectedVersion);
    requireVersion(before?.version ?? 0, input.expectedVersion);
    const patch = {
      route: input.route,
      stationId: input.stationId,
      version: (before?.version ?? 0) + 1,
      updatedAt: new Date().toISOString(),
    };
    const after = before
      ? tx
          .update(kdsRoutingRules)
          .set(patch)
          .where(and(scope, eq(kdsRoutingRules.version, input.expectedVersion)))
          .returning()
          .get()
      : tx
          .insert(kdsRoutingRules)
          .values({
            ...patch,
            id: nanoid(),
            tenantId: context.tenantId,
            siteId: context.siteId,
            targetKind: input.targetKind,
            targetId: input.targetId,
          })
          .returning()
          .get();
    if (!after) requireVersion(-1, input.expectedVersion);
    writeAuditLog({
      tx,
      tenantId: context.tenantId,
      actorId: context.actorId,
      action: 'kds.routing.saved',
      resourceType: 'kds_configuration',
      resourceId: after!.id,
      before: before ?? null,
      after: after!,
    });
    return after!;
  });
}

export function removeKitchenRoute(
  context: KitchenConfigurationContext,
  input: KitchenTargetInput
) {
  return withKitchenConfiguration(context, tx => {
    const scope = and(
      eq(kdsRoutingRules.tenantId, context.tenantId),
      eq(kdsRoutingRules.siteId, context.siteId),
      eq(kdsRoutingRules.targetKind, input.targetKind),
      eq(kdsRoutingRules.targetId, input.targetId)
    );
    const before = tx.select().from(kdsRoutingRules).where(scope).get();
    // Row identity fences deletion/recreation ABA even if its version resets to one.
    if ((before?.id ?? null) !== input.expectedRuleId) requireVersion(-1, input.expectedVersion);
    requireVersion(before?.version ?? 0, input.expectedVersion);
    if (!before) return { removed: false };
    const result = tx
      .delete(kdsRoutingRules)
      .where(and(scope, eq(kdsRoutingRules.version, input.expectedVersion)))
      .run();
    if (result.changes !== 1) requireVersion(-1, input.expectedVersion);
    writeAuditLog({
      tx,
      tenantId: context.tenantId,
      actorId: context.actorId,
      action: 'kds.routing.removed',
      resourceType: 'kds_configuration',
      resourceId: before.id,
      before,
      after: null,
    });
    return { removed: true };
  });
}
