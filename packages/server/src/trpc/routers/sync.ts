/**
 * Sync tRPC Router
 *
 * Local sync outbox management and sync status.
 *
 * Procedures (implemented):
 * - sync.status          (tenant) - Get current sync status
 * - sync.listQueue       (tenant, manager/admin) - List pending sync_outbox items
 * - sync.addToQueue      (tenant, manager/admin) - Add an operation to the sync_outbox
 * - sync.removeFromQueue (tenant, manager/admin) - Remove an item from the sync_outbox
 * - sync.listConflicts   (tenant, manager/admin) - List unresolved sync conflicts
 *
 * Additional procedures:
 * - sync.push    - Process queued local changes
 * - sync.pull    - Return a sync snapshot
 * - sync.resolve - Resolve a sync conflict
 *
 * ENG-064 contract v1 procedures:
 * - sync.getContract   - Manifest negotiation for ENG-068+ multi-store sync
 * - sync.peekOutbox    - Operations Center tail
 * - sync.retry         - Operator-driven retry of stuck rows
 *
 * @module trpc/routers/sync
 */

import { TRPCError } from '@trpc/server';
import type Database from 'better-sqlite3';
import { eq, and, desc, inArray, sql } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import type { DatabaseInstance } from '../../db/index.js';
import { router } from '../init.js';
import { adminProcedure, managerOrAdminProcedure } from '../middleware/roles.js';
import { tenantProcedure } from '../middleware/tenant.js';
import { throwServerError } from '../../lib/errorCodes.js';
import {
  appSettings,
  syncConflicts,
  syncOutbox,
} from '../../db/schema.js';
import {
  listQueueInput,
  addToQueueInput,
  removeFromQueueInput,
  listConflictsInput,
  peekOutboxInput,
  pullSyncInput,
  pushSyncInput,
  resolveSyncConflictInput,
  retryOutboxInput,
} from '../schemas/sync.js';
import { buildSyncContractManifest } from '../../services/sync/index.js';
import { enqueueSync } from '../../services/sync/enqueue.js';

const LAST_SYNC_KEY_PREFIX = 'sync_last_sync:';

/**
 * Statuses that count as "still pending" — the row has not yet been
 * accepted by the central server. `submitting` is a transient mid-push
 * state; counting it as pending preserves the legacy semantics where
 * any non-final row blocked closeout flows.
 */
const PENDING_STATUSES = ['queued', 'submitting', 'retrying'] as const;
type PendingStatus = (typeof PENDING_STATUSES)[number];

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
  const pendingFilter = and(
    eq(syncOutbox.tenantId, tenantId),
    inArray(syncOutbox.status, PENDING_STATUSES as unknown as PendingStatus[])
  );

  const [pendingCountRow, retryingCountRow, failedCountRow, oldestPendingRow, conflictCountRow, lastSyncAt] = await Promise.all([
    db
      .select({ count: sql<number>`count(*)` })
      .from(syncOutbox)
      .where(pendingFilter)
      .get(),
    db
      .select({ count: sql<number>`count(*)` })
      .from(syncOutbox)
      .where(and(eq(syncOutbox.tenantId, tenantId), eq(syncOutbox.status, 'retrying')))
      .get(),
    db
      .select({ count: sql<number>`count(*)` })
      .from(syncOutbox)
      .where(
        and(
          eq(syncOutbox.tenantId, tenantId),
          inArray(syncOutbox.status, ['retrying', 'dead_letter']),
          sql`${syncOutbox.lastError} is not null`
        )
      )
      .get(),
    db
      .select({ createdAt: sql<string | null>`min(${syncOutbox.createdAt})` })
      .from(syncOutbox)
      .where(pendingFilter)
      .get(),
    db
      .select({ count: sql<number>`count(*)` })
      .from(syncConflicts)
      .where(and(eq(syncConflicts.tenantId, tenantId), eq(syncConflicts.status, 'pending')))
      .get(),
    getLastSyncAt(db, tenantId),
  ]);

  const pendingCount = pendingCountRow?.count ?? 0;
  const retryingCount = retryingCountRow?.count ?? 0;
  const failedCount = failedCountRow?.count ?? 0;
  const conflictsCount = conflictCountRow?.count ?? 0;
  const oldestPendingAt = oldestPendingRow?.createdAt ?? null;

  return {
    pendingCount,
    retryingCount,
    failedCount,
    conflictsCount,
    externalSyncEnabled: true,
    lastSyncAt,
    oldestPendingAt,
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

/**
 * Mark a `sync_outbox` row as failed: bump attempts, capture the
 * normalized error, transition to `retrying`. Used by `sync.push`
 * when a row hits a recoverable obstacle.
 */
async function markOutboxFailure(
  db: DatabaseInstance,
  tenantId: string,
  outboxId: string,
  message: string
) {
  const now = new Date().toISOString();
  await db
    .update(syncOutbox)
    .set({
      status: 'retrying',
      attempts: sql`${syncOutbox.attempts} + 1`,
      lastError: { kind: 'UNKNOWN', message },
      updatedAt: now,
    })
    .where(and(eq(syncOutbox.id, outboxId), eq(syncOutbox.tenantId, tenantId)))
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

  return getSqliteClient(db)
    .prepare(`SELECT id FROM ${config.tableName} WHERE id = ? AND tenant_id = ? LIMIT 1`)
    .get(entityId, tenantId) as { id: string } | undefined;
}

function getConflictLocalRecordExists(
  db: DatabaseInstance,
  tenantId: string,
  conflict: { entityType: string; entityId: string }
) {
  const config = getSyncEntityConfiguration(conflict.entityType);

  if (!config) {
    return null;
  }

  return Boolean(findEntity(db, config, tenantId, conflict.entityId));
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
   * List pending operations from the sync_outbox.
   *
   * The legacy response shape mapped one-to-one to `sync_queue`
   * columns (`data`, `localVersion`). Post-cutover the projection
   * still exposes `data` + `localVersion` (aliased from `payload` +
   * `payloadVersion`) so the web admin keeps rendering without a
   * shape change.
   */
  listQueue: managerOrAdminProcedure.input(listQueueInput).query(async ({ ctx, input }) => {
    const where = and(
      eq(syncOutbox.tenantId, ctx.tenantId),
      inArray(syncOutbox.status, PENDING_STATUSES as unknown as PendingStatus[])
    );
    const [rows, countRow] = await Promise.all([
      ctx.db
        .select({
          id: syncOutbox.id,
          tenantId: syncOutbox.tenantId,
          entityType: syncOutbox.entityType,
          entityId: syncOutbox.entityId,
          operation: syncOutbox.operation,
          data: syncOutbox.payload,
          localVersion: syncOutbox.payloadVersion,
          attempts: syncOutbox.attempts,
          lastError: syncOutbox.lastError,
          createdAt: syncOutbox.createdAt,
        })
        .from(syncOutbox)
        .where(where)
        .orderBy(syncOutbox.createdAt)
        .limit(input.limit)
        .all(),
      ctx.db
        .select({ count: sql<number>`count(*)` })
        .from(syncOutbox)
        .where(where)
        .get(),
    ]);

    return { items: rows, count: countRow?.count ?? 0 };
  }),

  /**
   * Add an operation to the local sync_outbox manually. Operator
   * recovery surface — system writers go through `enqueueSync()`.
   */
  addToQueue: managerOrAdminProcedure.input(addToQueueInput).mutation(async ({ ctx, input }) => {
    const result = await enqueueSync(ctx, {
      entityType: input.entityType as SyncEntityType,
      entityId: input.entityId,
      operation: input.operation,
      data: input.data ?? {},
    });

    return {
      id: result.id,
      entityType: input.entityType,
      entityId: input.entityId,
      operation: input.operation,
      createdAt: new Date().toISOString(),
    };
  }),

  /**
   * Remove an item from the sync_outbox (after successful manual
   * recovery, or to discard a stuck row outright).
   */
  removeFromQueue: managerOrAdminProcedure.input(removeFromQueueInput).mutation(async ({ ctx, input }) => {
    const item = await ctx.db
      .select({ id: syncOutbox.id })
      .from(syncOutbox)
      .where(and(eq(syncOutbox.id, input.id), eq(syncOutbox.tenantId, ctx.tenantId)))
      .get();

    if (!item) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Sync outbox item not found' });
    }

    await ctx.db
      .delete(syncOutbox)
      .where(and(eq(syncOutbox.id, input.id), eq(syncOutbox.tenantId, ctx.tenantId)))
      .run();

    return { success: true, id: input.id };
  }),

  /**
   * List unresolved sync conflicts
   */
  listConflicts: managerOrAdminProcedure.input(listConflictsInput).query(async ({ ctx, input }) => {
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

    return {
      items: items.map(item => ({
        ...item,
        localRecordExists: getConflictLocalRecordExists(ctx.db, ctx.tenantId, item),
      })),
      count: countRow?.count ?? 0,
    };
  }),

  /**
   * Process pending sync_outbox rows and mark them as synced
   * locally. Operator-driven; the periodic worker daemon lands in
   * ENG-066.
   */
  push: tenantProcedure.input(pushSyncInput).mutation(async ({ ctx, input }) => {
    const items = await ctx.db
      .select({
        id: syncOutbox.id,
        entityType: syncOutbox.entityType,
        entityId: syncOutbox.entityId,
        operation: syncOutbox.operation,
        payload: syncOutbox.payload,
        attempts: syncOutbox.attempts,
        priority: syncOutbox.priority,
      })
      .from(syncOutbox)
      .where(
        and(
          eq(syncOutbox.tenantId, ctx.tenantId),
          inArray(syncOutbox.status, ['queued', 'retrying'])
        )
      )
      .orderBy(desc(syncOutbox.priority), syncOutbox.createdAt)
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
        await markOutboxFailure(ctx.db, ctx.tenantId, item.id, message);
        conflictIds.push(existingConflictId);
        errors.push(message);
        continue;
      }

      const config = getSyncEntityConfiguration(item.entityType);
      if (!config) {
        const message = `Unsupported sync entity type: ${item.entityType}`;
        await markOutboxFailure(ctx.db, ctx.tenantId, item.id, message);
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
            localData: (item.payload ?? {}) as Record<string, unknown>,
            remoteData: {},
          });
          await markOutboxFailure(ctx.db, ctx.tenantId, item.id, message);
          conflictIds.push(conflictId);
          errors.push(message);
          continue;
        }

        markEntityAsSynced(ctx.db, config, ctx.tenantId, item.entityId, now);
      }

      await ctx.db
        .update(syncOutbox)
        .set({
          status: 'synced',
          lastError: null,
          updatedAt: now,
        })
        .where(and(eq(syncOutbox.id, item.id), eq(syncOutbox.tenantId, ctx.tenantId)))
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
   * Return a sync snapshot with pending sync_outbox rows and
   * conflicts. Read-only mirror of `sync.status` plus the actual row
   * payloads.
   */
  pull: managerOrAdminProcedure.input(pullSyncInput).query(async ({ ctx, input }) => {
    const [overview, queue, conflicts] = await Promise.all([
      getSyncOverview(ctx.db, ctx.tenantId),
      ctx.db
        .select({
          id: syncOutbox.id,
          tenantId: syncOutbox.tenantId,
          entityType: syncOutbox.entityType,
          entityId: syncOutbox.entityId,
          operation: syncOutbox.operation,
          data: syncOutbox.payload,
          localVersion: syncOutbox.payloadVersion,
          attempts: syncOutbox.attempts,
          lastError: syncOutbox.lastError,
          createdAt: syncOutbox.createdAt,
        })
        .from(syncOutbox)
        .where(
          and(
            eq(syncOutbox.tenantId, ctx.tenantId),
            inArray(syncOutbox.status, PENDING_STATUSES as unknown as PendingStatus[])
          )
        )
        .orderBy(syncOutbox.createdAt)
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
      conflicts: conflicts.map(conflict => ({
        ...conflict,
        localRecordExists: getConflictLocalRecordExists(ctx.db, ctx.tenantId, conflict),
      })),
    };
  }),

  /**
   * Resolve a pending sync conflict and optionally requeue a local
   * update on the sync_outbox.
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

    // ENG-042 close-out — the unsupported-entityType check stays OUTSIDE
    // the transaction: it does not require rollback because no DB writes
    // have happened yet. The findEntity guard, however, moves INSIDE the
    // transaction callback below so a concurrent delete between the
    // outer check and the keepLocal / merged write can no longer leave
    // the path resolving against stale data.
    let entityConfig: (typeof syncEntityConfig)[SyncEntityType] | null = null;
    if (nextData) {
      entityConfig = getSyncEntityConfiguration(conflict.entityType);

      if (!entityConfig) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: `Unsupported sync entity type: ${conflict.entityType}`,
        });
      }
    }

    await ctx.db.transaction(tx => {
      if (nextData && entityConfig) {
        const entity = findEntity(
          ctx.db,
          entityConfig,
          ctx.tenantId,
          conflict.entityId
        );
        if (!entity) {
          throwServerError({
            trpcCode: 'BAD_REQUEST',
            errorCode: 'SYNC_LOCAL_RECORD_MISSING',
            message:
              'Local record missing; accept remote to discard the stale queued change',
            details: {
              entityType: conflict.entityType,
              entityId: conflict.entityId,
              resolution: input.resolution,
            },
          });
        }
      }

      tx
        .update(syncConflicts)
        .set({
          status: 'resolved',
          resolution: input.resolution,
          resolvedAt: now,
        })
        .where(and(eq(syncConflicts.id, conflict.id), eq(syncConflicts.tenantId, ctx.tenantId)))
        .run();

      // Discard any in-flight outbox rows for the same entity. Both
      // resolution paths (`local_wins`/`merged` requeue, `remote_wins`
      // discard) start clean.
      tx
        .delete(syncOutbox)
        .where(
          and(
            eq(syncOutbox.tenantId, ctx.tenantId),
            eq(syncOutbox.entityType, conflict.entityType),
            eq(syncOutbox.entityId, conflict.entityId)
          )
        )
        .run();
    });

    if (nextData) {
      await enqueueSync(ctx, {
        entityType: conflict.entityType as SyncEntityType,
        entityId: conflict.entityId,
        operation: 'update',
        data: nextData,
      });
    }

    const overview = await getSyncOverview(ctx.db, ctx.tenantId);

    return {
      success: true,
      id: conflict.id,
      resolution: input.resolution,
      ...overview,
    };
  }),

  // ==========================================================================
  // ENG-064 — sync contract v1
  // --------------------------------------------------------------------------
  // The 3 procedures below operate on `sync_outbox` (migration 0016).
  // ENG-064b cut the legacy procedures above over to the same table
  // and dropped `sync_queue` in migration 0017.
  // ==========================================================================

  /**
   * Returns the sync payload contract manifest. ENG-068+ multi-store
   * sync uses this to negotiate the per-entity policy + version
   * before exchanging payloads.
   */
  getContract: managerOrAdminProcedure.query(() => buildSyncContractManifest()),

  /**
   * Operator-facing peek into the sync_outbox tail. Manager+admin
   * gated. Consumed by ENG-065's Operations Center.
   */
  peekOutbox: managerOrAdminProcedure
    .input(peekOutboxInput)
    .query(async ({ ctx, input }) => {
      const rows = await ctx.db
        .select({
          id: syncOutbox.id,
          status: syncOutbox.status,
          entityType: syncOutbox.entityType,
          entityId: syncOutbox.entityId,
          operation: syncOutbox.operation,
          conflictPolicy: syncOutbox.conflictPolicy,
          payloadVersion: syncOutbox.payloadVersion,
          idempotencyKey: syncOutbox.idempotencyKey,
          deviceId: syncOutbox.deviceId,
          dependsOnOperationId: syncOutbox.dependsOnOperationId,
          operationEventId: syncOutbox.operationEventId,
          attempts: syncOutbox.attempts,
          nextRetryAt: syncOutbox.nextRetryAt,
          lastError: syncOutbox.lastError,
          priority: syncOutbox.priority,
          createdAt: syncOutbox.createdAt,
          updatedAt: syncOutbox.updatedAt,
        })
        .from(syncOutbox)
        .where(eq(syncOutbox.tenantId, ctx.tenantId))
        .orderBy(desc(syncOutbox.priority), syncOutbox.createdAt)
        .limit(input.limit)
        .all();
      return rows;
    }),

  /**
   * Reset a `sync_outbox` row so the next push attempt picks it up
   * fresh. Operator path for "this row got stuck on a transient
   * error; force a retry now". Retryable rows (`retrying` /
   * `dead_letter`) reset `attempts=0`, clear `lastError`, move
   * status back to `queued`, and set `nextRetryAt=null`.
   * `queued` / `submitting` / `synced` / `conflict` are no-ops so
   * an accepted row cannot be accidentally replayed.
   * Admin-only.
   */
  retry: adminProcedure.input(retryOutboxInput).mutation(async ({ ctx, input }) => {
    const existing = await ctx.db
      .select({ id: syncOutbox.id, status: syncOutbox.status })
      .from(syncOutbox)
      .where(
        and(
          eq(syncOutbox.id, input.id),
          eq(syncOutbox.tenantId, ctx.tenantId)
        )
      )
      .get();
    if (!existing) {
      throwServerError({
        trpcCode: 'NOT_FOUND',
        errorCode: 'SYNC_OUTBOX_NOT_FOUND',
        message: 'sync_outbox row not found',
      });
    }
    if (existing.status !== 'retrying' && existing.status !== 'dead_letter') {
      return { ok: true as const, id: input.id };
    }
    const now = new Date().toISOString();
    await ctx.db
      .update(syncOutbox)
      .set({
        status: 'queued',
        attempts: 0,
        nextRetryAt: null,
        lastError: null,
        claimToken: null,
        lockedAt: null,
        updatedAt: now,
      })
      .where(
        and(
          eq(syncOutbox.id, input.id),
          eq(syncOutbox.tenantId, ctx.tenantId)
        )
      );
    return { ok: true as const, id: input.id };
  }),
});
