/**
 * Sync tRPC Router
 *
 * Local sync queue management and sync status.
 *
 * Procedures (implemented):
 * - sync.status          (tenant) - Get current sync status
 * - sync.listQueue       (tenant) - List pending sync queue items
 * - sync.addToQueue      (tenant) - Add an operation to the sync queue
 * - sync.removeFromQueue (tenant) - Remove an item from the sync queue
 * - sync.listConflicts   (tenant) - List unresolved sync conflicts
 *
 * Additional procedures:
 * - sync.push    - Process queued local changes
 * - sync.pull    - Return a sync snapshot
 * - sync.resolve - Resolve a sync conflict
 *
 * @module trpc/routers/sync
 */

import { TRPCError } from '@trpc/server';
import type Database from 'better-sqlite3';
import { eq, and, desc, sql } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import type { DatabaseInstance } from '../../db/index.js';
import { router } from '../init.js';
import { adminProcedure } from '../middleware/roles.js';
import { tenantProcedure } from '../middleware/tenant.js';
import { appSettings, syncQueue, syncConflicts } from '../../db/schema.js';
import {
  listQueueInput,
  addToQueueInput,
  removeFromQueueInput,
  listConflictsInput,
  pullSyncInput,
  pushSyncInput,
  resolveSyncConflictInput,
} from '../schemas/sync.js';

const LAST_SYNC_KEY_PREFIX = 'sync_last_sync:';

const syncEntityConfig = {
  category_x_provider: {
    tableName: 'category_x_provider',
    supportsSyncMetadata: false,
    touchUpdatedAt: false,
  },
  categories: { tableName: 'categories', supportsSyncMetadata: false, touchUpdatedAt: false },
  cities: { tableName: 'cities', supportsSyncMetadata: false, touchUpdatedAt: false },
  client_types: { tableName: 'client_types', supportsSyncMetadata: false, touchUpdatedAt: false },
  commercial_activities: {
    tableName: 'commercial_activities',
    supportsSyncMetadata: false,
    touchUpdatedAt: false,
  },
  companies: { tableName: 'companies', supportsSyncMetadata: false, touchUpdatedAt: false },
  countries: { tableName: 'countries', supportsSyncMetadata: false, touchUpdatedAt: false },
  customers: { tableName: 'customers', supportsSyncMetadata: true, touchUpdatedAt: true },
  departments: { tableName: 'departments', supportsSyncMetadata: false, touchUpdatedAt: false },
  identification_types: {
    tableName: 'identification_types',
    supportsSyncMetadata: false,
    touchUpdatedAt: false,
  },
  initial_inventory: {
    tableName: 'initial_inventory',
    supportsSyncMetadata: true,
    touchUpdatedAt: false,
  },
  inventory_movements: {
    tableName: 'inventory_movements',
    supportsSyncMetadata: true,
    touchUpdatedAt: false,
  },
  logos: { tableName: 'logos', supportsSyncMetadata: false, touchUpdatedAt: false },
  locations: { tableName: 'locations', supportsSyncMetadata: false, touchUpdatedAt: false },
  location_x_site: { tableName: 'location_x_site', supportsSyncMetadata: false, touchUpdatedAt: false },
  order_items: { tableName: 'order_items', supportsSyncMetadata: false, touchUpdatedAt: false },
  orders: { tableName: 'orders', supportsSyncMetadata: true, touchUpdatedAt: true },
  person_types: { tableName: 'person_types', supportsSyncMetadata: false, touchUpdatedAt: false },
  products: { tableName: 'products', supportsSyncMetadata: true, touchUpdatedAt: true },
  providers: { tableName: 'providers', supportsSyncMetadata: false, touchUpdatedAt: false },
  purchase_items: { tableName: 'purchase_items', supportsSyncMetadata: false, touchUpdatedAt: false },
  purchases: { tableName: 'purchases', supportsSyncMetadata: true, touchUpdatedAt: true },
  purchase_return_items: {
    tableName: 'purchase_return_items',
    supportsSyncMetadata: false,
    touchUpdatedAt: false,
  },
  purchase_returns: { tableName: 'purchase_returns', supportsSyncMetadata: true, touchUpdatedAt: true },
  regime_types: { tableName: 'regime_types', supportsSyncMetadata: false, touchUpdatedAt: false },
  sale_items: { tableName: 'sale_items', supportsSyncMetadata: false, touchUpdatedAt: false },
  sale_returns: { tableName: 'sale_returns', supportsSyncMetadata: true, touchUpdatedAt: true },
  sales: { tableName: 'sales', supportsSyncMetadata: true, touchUpdatedAt: true },
  sequentials: { tableName: 'sequentials', supportsSyncMetadata: false, touchUpdatedAt: false },
  sites: { tableName: 'sites', supportsSyncMetadata: false, touchUpdatedAt: false },
  units: { tableName: 'units', supportsSyncMetadata: false, touchUpdatedAt: false },
  users: { tableName: 'users', supportsSyncMetadata: false, touchUpdatedAt: false },
  vat_rates: { tableName: 'vat_rates', supportsSyncMetadata: false, touchUpdatedAt: false },
} as const;

type SyncEntityType = keyof typeof syncEntityConfig;

function getLastSyncKey(tenantId: string) {
  return `${LAST_SYNC_KEY_PREFIX}${tenantId}`;
}

async function getLastSyncAt(
  db: DatabaseInstance,
  tenantId: string
) {
  const row = await db
    .select({ value: appSettings.value })
    .from(appSettings)
    .where(eq(appSettings.key, getLastSyncKey(tenantId)))
    .get();

  return typeof row?.value === 'string' ? row.value : null;
}

async function saveLastSyncAt(
  db: DatabaseInstance,
  tenantId: string,
  value: string
) {
  const key = getLastSyncKey(tenantId);
  const existing = await db
    .select({ key: appSettings.key })
    .from(appSettings)
    .where(eq(appSettings.key, key))
    .get();

  if (existing) {
    await db
      .update(appSettings)
      .set({
        value,
        updatedAt: value,
      })
      .where(eq(appSettings.key, key))
      .run();
    return;
  }

  await db.insert(appSettings).values({
    key,
    value,
    updatedAt: value,
  });
}

async function getSyncOverview(
  db: DatabaseInstance,
  tenantId: string
) {
  const [queueCountRow, conflictCountRow, lastSyncAt] = await Promise.all([
    db
      .select({ count: sql<number>`count(*)` })
      .from(syncQueue)
      .where(eq(syncQueue.tenantId, tenantId))
      .get(),
    db
      .select({ count: sql<number>`count(*)` })
      .from(syncConflicts)
      .where(and(eq(syncConflicts.tenantId, tenantId), eq(syncConflicts.status, 'pending')))
      .get(),
    getLastSyncAt(db, tenantId),
  ]);

  const pendingCount = queueCountRow?.count ?? 0;
  const conflictsCount = conflictCountRow?.count ?? 0;

  return {
    pendingCount,
    conflictsCount,
    externalSyncEnabled: true,
    lastSyncAt,
    status: conflictsCount > 0 ? 'conflict' : pendingCount > 0 ? 'pending' : 'synced',
  } as const;
}

async function hasPendingConflict(
  db: DatabaseInstance,
  tenantId: string,
  entityType: string,
  entityId: string
) {
  const conflict = await db
    .select({ id: syncConflicts.id })
    .from(syncConflicts)
    .where(
      and(
        eq(syncConflicts.tenantId, tenantId),
        eq(syncConflicts.entityType, entityType),
        eq(syncConflicts.entityId, entityId),
        eq(syncConflicts.status, 'pending')
      )
    )
    .get();

  return conflict?.id ?? null;
}

async function ensureSyncConflict(
  db: DatabaseInstance,
  {
    tenantId,
    entityType,
    entityId,
    localData,
    remoteData,
  }: {
    tenantId: string;
    entityType: string;
    entityId: string;
    localData: Record<string, unknown>;
    remoteData: Record<string, unknown>;
  }
) {
  const existingConflictId = await hasPendingConflict(db, tenantId, entityType, entityId);
  if (existingConflictId) {
    return existingConflictId;
  }

  const conflictId = nanoid();
  await db.insert(syncConflicts).values({
    id: conflictId,
    tenantId,
    entityType,
    entityId,
    localData,
    remoteData,
    status: 'pending',
    createdAt: new Date().toISOString(),
  });

  return conflictId;
}

async function incrementQueueFailure(
  db: DatabaseInstance,
  tenantId: string,
  queueId: string,
  message: string
) {
  await db
    .update(syncQueue)
    .set({
      attempts: sql`${syncQueue.attempts} + 1`,
      lastError: message,
    })
    .where(and(eq(syncQueue.id, queueId), eq(syncQueue.tenantId, tenantId)))
    .run();
}

function getSyncEntityConfiguration(entityType: string) {
  return syncEntityConfig[entityType as SyncEntityType];
}

function getSqliteClient(db: DatabaseInstance) {
  return (db as DatabaseInstance & { $client: Database.Database }).$client;
}

function findEntity(
  db: DatabaseInstance,
  config: (typeof syncEntityConfig)[SyncEntityType],
  tenantId: string,
  entityId: string
) {
  if (config.tableName === 'sale_items') {
    return getSqliteClient(db)
      .prepare(
        `SELECT si.id
         FROM sale_items si
         INNER JOIN sales s ON s.id = si.sale_id
         WHERE si.id = ? AND s.tenant_id = ?
         LIMIT 1`
      )
      .get(entityId, tenantId) as { id: string } | undefined;
  }

  if (config.tableName === 'purchase_return_items') {
    return getSqliteClient(db)
      .prepare(
        `SELECT pri.id
         FROM purchase_return_items pri
         INNER JOIN purchase_returns pr ON pr.id = pri.purchase_return_id
         WHERE pri.id = ? AND pr.tenant_id = ?
         LIMIT 1`
      )
      .get(entityId, tenantId) as { id: string } | undefined;
  }

  if (config.tableName === 'order_items') {
    return getSqliteClient(db)
      .prepare(
        `SELECT oi.id
         FROM order_items oi
         INNER JOIN orders o ON o.id = oi.order_id
         WHERE oi.id = ? AND o.tenant_id = ?
         LIMIT 1`
      )
      .get(entityId, tenantId) as { id: string } | undefined;
  }

  if (config.tableName === 'purchase_items') {
    return getSqliteClient(db)
      .prepare(
        `SELECT pi.id
         FROM purchase_items pi
         INNER JOIN purchases p ON p.id = pi.purchase_id
         WHERE pi.id = ? AND p.tenant_id = ?
         LIMIT 1`
      )
      .get(entityId, tenantId) as { id: string } | undefined;
  }

  return getSqliteClient(db)
    .prepare(`SELECT id FROM ${config.tableName} WHERE id = ? AND tenant_id = ? LIMIT 1`)
    .get(entityId, tenantId) as { id: string } | undefined;
}

function markEntityAsSynced(
  db: DatabaseInstance,
  config: (typeof syncEntityConfig)[SyncEntityType],
  tenantId: string,
  entityId: string,
  now: string
) {
  if (!config.supportsSyncMetadata) {
    return;
  }

  const statement = config.touchUpdatedAt
    ? getSqliteClient(db).prepare(
        `UPDATE ${config.tableName}
         SET sync_status = 'synced', sync_version = COALESCE(sync_version, 0) + 1, updated_at = ?
         WHERE id = ? AND tenant_id = ?`
      )
    : getSqliteClient(db).prepare(
        `UPDATE ${config.tableName}
         SET sync_status = 'synced', sync_version = COALESCE(sync_version, 0) + 1
         WHERE id = ? AND tenant_id = ?`
      );

  if (config.touchUpdatedAt) {
    statement.run(now, entityId, tenantId);
    return;
  }

  statement.run(entityId, tenantId);
}

export const syncRouter = router({
  /**
   * Get the current sync status (pending count, conflicts count, last sync time)
   */
  status: tenantProcedure.query(async ({ ctx }) => {
    return getSyncOverview(ctx.db, ctx.tenantId);
  }),

  /**
   * List pending operations from the sync queue
   */
  listQueue: tenantProcedure.input(listQueueInput).query(async ({ ctx, input }) => {
    const [items, countRow] = await Promise.all([
      ctx.db
        .select()
        .from(syncQueue)
        .where(eq(syncQueue.tenantId, ctx.tenantId))
        .orderBy(syncQueue.createdAt)
        .limit(input.limit)
        .all(),
      ctx.db
        .select({ count: sql<number>`count(*)` })
        .from(syncQueue)
        .where(eq(syncQueue.tenantId, ctx.tenantId))
        .get(),
    ]);

    return { items, count: countRow?.count ?? 0 };
  }),

  /**
   * Add an operation to the local sync queue
   */
  addToQueue: tenantProcedure.input(addToQueueInput).mutation(async ({ ctx, input }) => {
    const now = new Date().toISOString();
    const id = nanoid();

    await ctx.db.insert(syncQueue).values({
      id,
      tenantId: ctx.tenantId,
      entityType: input.entityType,
      entityId: input.entityId,
      operation: input.operation,
      data: input.data ?? {},
      localVersion: 1,
      attempts: 0,
      createdAt: now,
    });

    return {
      id,
      entityType: input.entityType,
      entityId: input.entityId,
      operation: input.operation,
      createdAt: now,
    };
  }),

  /**
   * Remove an item from the sync queue (after successful sync)
   */
  removeFromQueue: tenantProcedure.input(removeFromQueueInput).mutation(async ({ ctx, input }) => {
    const item = await ctx.db
      .select()
      .from(syncQueue)
      .where(and(eq(syncQueue.id, input.id), eq(syncQueue.tenantId, ctx.tenantId)))
      .get();

    if (!item) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Sync queue item not found' });
    }

    await ctx.db
      .delete(syncQueue)
      .where(and(eq(syncQueue.id, input.id), eq(syncQueue.tenantId, ctx.tenantId)))
      .run();

    return { success: true, id: input.id };
  }),

  /**
   * List unresolved sync conflicts
   */
  listConflicts: tenantProcedure.input(listConflictsInput).query(async ({ ctx, input }) => {
    const where = and(eq(syncConflicts.tenantId, ctx.tenantId), eq(syncConflicts.status, 'pending'));
    const [items, countRow] = await Promise.all([
      ctx.db
        .select()
        .from(syncConflicts)
        .where(where)
        .orderBy(desc(syncConflicts.createdAt))
        .limit(input.limit)
        .all(),
      ctx.db
        .select({ count: sql<number>`count(*)` })
        .from(syncConflicts)
        .where(where)
        .get(),
    ]);

    return { items, count: countRow?.count ?? 0 };
  }),

  /**
   * Process pending queue items and mark them as synced locally.
   */
  push: tenantProcedure.input(pushSyncInput).mutation(async ({ ctx, input }) => {
    const items = await ctx.db
      .select()
      .from(syncQueue)
      .where(eq(syncQueue.tenantId, ctx.tenantId))
      .orderBy(syncQueue.createdAt)
      .limit(input.limit)
      .all();

    const processedIds: string[] = [];
    const conflictIds: string[] = [];
    const errors: string[] = [];
    const now = new Date().toISOString();

    for (const item of items) {
      const existingConflictId = await hasPendingConflict(
        ctx.db,
        ctx.tenantId,
        item.entityType,
        item.entityId
      );

      if (existingConflictId) {
        const message = `Pending conflict blocks ${item.entityType}:${item.entityId}`;
        await incrementQueueFailure(ctx.db, ctx.tenantId, item.id, message);
        conflictIds.push(existingConflictId);
        errors.push(message);
        continue;
      }

      const config = getSyncEntityConfiguration(item.entityType);
      if (!config) {
        const message = `Unsupported sync entity type: ${item.entityType}`;
        await incrementQueueFailure(ctx.db, ctx.tenantId, item.id, message);
        errors.push(message);
        continue;
      }

      if (item.operation !== 'delete') {
        const entity = findEntity(ctx.db, config, ctx.tenantId, item.entityId);
        if (!entity) {
          const message = `Unable to sync ${item.entityType}:${item.entityId} because the local record is missing`;
          const conflictId = await ensureSyncConflict(ctx.db, {
            tenantId: ctx.tenantId,
            entityType: item.entityType,
            entityId: item.entityId,
            localData: item.data ?? {},
            remoteData: {},
          });
          await incrementQueueFailure(ctx.db, ctx.tenantId, item.id, message);
          conflictIds.push(conflictId);
          errors.push(message);
          continue;
        }

        markEntityAsSynced(ctx.db, config, ctx.tenantId, item.entityId, now);
      }

      await ctx.db
        .delete(syncQueue)
        .where(and(eq(syncQueue.id, item.id), eq(syncQueue.tenantId, ctx.tenantId)))
        .run();
      processedIds.push(item.id);
    }

    if (processedIds.length > 0) {
      await saveLastSyncAt(ctx.db, ctx.tenantId, now);
    }

    const overview = await getSyncOverview(ctx.db, ctx.tenantId);

    return {
      success: errors.length === 0,
      synced: processedIds.length,
      processedIds,
      conflictIds,
      errors,
      ...overview,
    };
  }),

  /**
   * Return a sync snapshot with pending queue items and conflicts.
   */
  pull: tenantProcedure.input(pullSyncInput).query(async ({ ctx, input }) => {
    const [overview, queue, conflicts] = await Promise.all([
      getSyncOverview(ctx.db, ctx.tenantId),
      ctx.db
        .select()
        .from(syncQueue)
        .where(eq(syncQueue.tenantId, ctx.tenantId))
        .orderBy(syncQueue.createdAt)
        .limit(input.queueLimit)
        .all(),
      ctx.db
        .select()
        .from(syncConflicts)
        .where(and(eq(syncConflicts.tenantId, ctx.tenantId), eq(syncConflicts.status, 'pending')))
        .orderBy(desc(syncConflicts.createdAt))
        .limit(input.conflictLimit)
        .all(),
    ]);

    return {
      ...overview,
      queue,
      conflicts,
    };
  }),

  /**
   * Resolve a pending sync conflict and optionally requeue a local update.
   */
  resolve: adminProcedure.input(resolveSyncConflictInput).mutation(async ({ ctx, input }) => {
    const conflict = await ctx.db
      .select()
      .from(syncConflicts)
      .where(and(eq(syncConflicts.id, input.id), eq(syncConflicts.tenantId, ctx.tenantId)))
      .get();

    if (!conflict) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Sync conflict not found' });
    }

    if (conflict.status === 'resolved') {
      throw new TRPCError({ code: 'BAD_REQUEST', message: 'Sync conflict has already been resolved' });
    }

    const now = new Date().toISOString();
    const nextData =
      input.resolution === 'merged'
        ? input.mergedData ?? {}
        : input.resolution === 'local_wins'
          ? conflict.localData ?? {}
          : null;

    await ctx.db.transaction(tx => {
      tx
        .update(syncConflicts)
        .set({
          status: 'resolved',
          resolution: input.resolution,
          resolvedAt: now,
        })
        .where(and(eq(syncConflicts.id, conflict.id), eq(syncConflicts.tenantId, ctx.tenantId)))
        .run();

      tx
        .delete(syncQueue)
        .where(
          and(
            eq(syncQueue.tenantId, ctx.tenantId),
            eq(syncQueue.entityType, conflict.entityType),
            eq(syncQueue.entityId, conflict.entityId)
          )
        )
        .run();

      if (nextData) {
        tx.insert(syncQueue)
          .values({
            id: nanoid(),
            tenantId: ctx.tenantId,
            entityType: conflict.entityType,
            entityId: conflict.entityId,
            operation: 'update',
            data: nextData,
            localVersion: 1,
            attempts: 0,
            createdAt: now,
          })
          .run();
      }
    });

    const overview = await getSyncOverview(ctx.db, ctx.tenantId);

    return {
      success: true,
      id: conflict.id,
      resolution: input.resolution,
      ...overview,
    };
  }),
});
