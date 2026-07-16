/**
 * Sync router shared helpers (ENG-178 split).
 *
 * Leaf module: the sync-entity allowlist (SEC-003), the last-sync-time
 * accessors, the sync-overview aggregation, the conflict helpers, and the
 * entity lookup / mark-synced primitives. Imported by the per-concern record
 * modules (status / queue / conflicts / push); never imports them back.
 *
 * @module trpc/routers/sync/helpers
 */

import type Database from 'better-sqlite3';
import { eq, and, inArray, sql } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import type { DatabaseInstance } from '../../../db/index.js';
import {
  appSettings,
  syncConflicts,
  syncOutbox,
} from '../../../db/schema.js';

export const LAST_SYNC_KEY_PREFIX = 'sync_last_sync:';

/**
 * Statuses that count as "still pending" — the row has not yet been
 * accepted by the central server. `submitting` is a transient mid-push
 * state; counting it as pending preserves the legacy semantics where
 * any non-final row blocked closeout flows.
 */
export const PENDING_STATUSES = ['queued', 'submitting', 'retrying'] as const;
export type PendingStatus = (typeof PENDING_STATUSES)[number];

export const syncEntityConfig = {
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
  inventory_lots: {
    tableName: 'inventory_lots',
    supportsSyncMetadata: true,
    touchUpdatedAt: true,
  },
  product_serials: {
    tableName: 'product_serials',
    supportsSyncMetadata: true,
    touchUpdatedAt: true,
  },
  product_serial_transfers: {
    tableName: 'product_serial_transfers',
    supportsSyncMetadata: false,
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
  sale_item_serials: {
    tableName: 'sale_item_serials',
    supportsSyncMetadata: false,
    touchUpdatedAt: false,
  },
  sale_returns: { tableName: 'sale_returns', supportsSyncMetadata: true, touchUpdatedAt: true },
  sales: { tableName: 'sales', supportsSyncMetadata: true, touchUpdatedAt: true },
  sequentials: { tableName: 'sequentials', supportsSyncMetadata: false, touchUpdatedAt: false },
  sites: { tableName: 'sites', supportsSyncMetadata: false, touchUpdatedAt: false },
  units: { tableName: 'units', supportsSyncMetadata: false, touchUpdatedAt: false },
  users: { tableName: 'users', supportsSyncMetadata: false, touchUpdatedAt: false },
  vat_rates: { tableName: 'vat_rates', supportsSyncMetadata: false, touchUpdatedAt: false },
} as const;

export type SyncEntityType = keyof typeof syncEntityConfig;

export function getLastSyncKey(tenantId: string) {
  return `${LAST_SYNC_KEY_PREFIX}${tenantId}`;
}

export async function getLastSyncAt(
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

export async function saveLastSyncAt(
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

export async function getSyncOverview(
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

export async function hasPendingConflict(
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

export async function ensureSyncConflict(
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
export async function markOutboxFailure(
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

export function getSyncEntityConfiguration(entityType: string) {
  return syncEntityConfig[entityType as SyncEntityType];
}

function getSqliteClient(db: DatabaseInstance) {
  return (db as DatabaseInstance & { $client: Database.Database }).$client;
}

export function findEntity(
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

export function getConflictLocalRecordExists(
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

export function markEntityAsSynced(
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
