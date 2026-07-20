/**
 * sync-bridge helpers + constants extracted from ipc/sync.ts
 * (slice-7 668-LOC file split to clear the 500 ceiling). Electron-free
 * (DB via runtime.ts), node --test-able.
 * @module main/ipc/sync-helpers
 */
import { randomUUID } from 'node:crypto';
import {
  and,
  eq,
  inArray,
  sql,
  appSettings,
  syncConflicts,
  syncOutbox,
  type SyncConflictPolicy,
} from '@puntovivo/server';
import { getServerDatabase, getSqliteClient } from '../runtime.js';

export const DESKTOP_SYNC_CONFIG_KEY = 'desktop_sync_config';
export const LAST_SYNC_KEY_PREFIX = 'sync_last_sync:';
export const DESKTOP_PENDING_SYNC_STATUSES = ['queued', 'submitting', 'retrying'] as const;
export const DESKTOP_PROCESSABLE_SYNC_STATUSES = ['queued', 'retrying'] as const;
export type DesktopPendingSyncStatus = (typeof DESKTOP_PENDING_SYNC_STATUSES)[number];
export type DesktopProcessableSyncStatus = (typeof DESKTOP_PROCESSABLE_SYNC_STATUSES)[number];
export const SYNC_ENTITY_TYPE_MAP: Record<string, string> = {
  product: 'products',
  customer: 'customers',
  sale: 'sales',
  sale_item: 'sale_items',
  category: 'categories',
  inventory_movement: 'inventory_movements',
  company: 'companies',
  country: 'countries',
  department: 'departments',
  city: 'cities',
  identification_type: 'identification_types',
  person_type: 'person_types',
  regime_type: 'regime_types',
  client_type: 'client_types',
  commercial_activity: 'commercial_activities',
  location: 'locations',
  site: 'sites',
  unit: 'units',
  user: 'users',
  provider: 'providers',
  vat_rate: 'vat_rates',
  logo: 'logos',
  sequential: 'sequentials',
  order: 'orders',
  order_item: 'order_items',
  purchase: 'purchases',
  purchase_item: 'purchase_items',
  purchase_return: 'purchase_returns',
  purchase_return_item: 'purchase_return_items',
  sale_return: 'sale_returns',
  initial_inventory_item: 'initial_inventory',
};
export const SYNC_ENTITY_CONFIG = {
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
  location_x_site: {
    tableName: 'location_x_site',
    supportsSyncMetadata: false,
    touchUpdatedAt: false,
  },
  order_items: { tableName: 'order_items', supportsSyncMetadata: false, touchUpdatedAt: false },
  orders: { tableName: 'orders', supportsSyncMetadata: true, touchUpdatedAt: true },
  person_types: { tableName: 'person_types', supportsSyncMetadata: false, touchUpdatedAt: false },
  products: { tableName: 'products', supportsSyncMetadata: true, touchUpdatedAt: true },
  providers: { tableName: 'providers', supportsSyncMetadata: false, touchUpdatedAt: false },
  purchase_items: {
    tableName: 'purchase_items',
    supportsSyncMetadata: false,
    touchUpdatedAt: false,
  },
  purchases: { tableName: 'purchases', supportsSyncMetadata: true, touchUpdatedAt: true },
  purchase_return_items: {
    tableName: 'purchase_return_items',
    supportsSyncMetadata: false,
    touchUpdatedAt: false,
  },
  purchase_returns: {
    tableName: 'purchase_returns',
    supportsSyncMetadata: true,
    touchUpdatedAt: true,
  },
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
export const DESKTOP_MANUAL_SYNC_ENTITIES = new Set<string>([
  'sales',
  'sale_items',
  'sale_payments',
  'sale_returns',
  'cash_sessions',
  'cash_movements',
  'fiscal_documents',
  'fiscal_document_items',
  'fiscal_numbering_resolutions',
  'fiscal_certificates',
  'inventory_movements',
  'inventory_balances',
  'initial_inventory',
  'transfer_orders',
  'transfer_order_items',
  'stock_adjustments',
  'audit_logs',
  'orders',
  'order_items',
  'purchases',
  'purchase_items',
  'purchase_returns',
  'purchase_return_items',
]);

export function getLastSyncKey(tenantId: string): string {
  return `${LAST_SYNC_KEY_PREFIX}${tenantId}`;
}

export function desktopPendingSyncWhere(tenantId?: string) {
  const statusFilter = inArray(
    syncOutbox.status,
    DESKTOP_PENDING_SYNC_STATUSES as unknown as DesktopPendingSyncStatus[]
  );
  return tenantId ? and(eq(syncOutbox.tenantId, tenantId), statusFilter) : statusFilter;
}

export function desktopProcessableSyncWhere(tenantId: string) {
  return and(
    eq(syncOutbox.tenantId, tenantId),
    inArray(
      syncOutbox.status,
      DESKTOP_PROCESSABLE_SYNC_STATUSES as unknown as DesktopProcessableSyncStatus[]
    )
  );
}

export function resolveDesktopConflictPolicy(entityType: string): SyncConflictPolicy {
  return DESKTOP_MANUAL_SYNC_ENTITIES.has(entityType) ? 'manual' : 'auto_lww';
}

export async function getLastSyncAt(tenantId?: string): Promise<string | null> {
  const database = getServerDatabase();

  if (tenantId) {
    const row = await database
      .select({ value: appSettings.value })
      .from(appSettings)
      .where(eq(appSettings.key, getLastSyncKey(tenantId)))
      .get();

    return typeof row?.value === 'string' ? row.value : null;
  }

  const row = await database
    .select({ value: appSettings.value })
    .from(appSettings)
    .where(sql`${appSettings.key} like ${`${LAST_SYNC_KEY_PREFIX}%`}`)
    .orderBy(sql`${appSettings.updatedAt} desc`)
    .get();

  return typeof row?.value === 'string' ? row.value : null;
}

export async function saveLastSyncAt(tenantId: string, value: string): Promise<void> {
  const database = getServerDatabase();
  const key = getLastSyncKey(tenantId);
  const existing = await database
    .select({ key: appSettings.key })
    .from(appSettings)
    .where(eq(appSettings.key, key))
    .get();

  if (existing) {
    await database
      .update(appSettings)
      .set({
        value,
        updatedAt: value,
      })
      .where(eq(appSettings.key, key))
      .run();
    return;
  }

  await database.insert(appSettings).values({
    key,
    value,
    updatedAt: value,
  });
}

export function findLocalSyncEntity(
  tableName: keyof typeof SYNC_ENTITY_CONFIG,
  tenantId: string,
  entityId: string
): boolean {
  const sqlite = getSqliteClient().$client;

  if (tableName === 'sale_items') {
    const row = sqlite
      .prepare(
        `SELECT si.id
         FROM sale_items si
         INNER JOIN sales s ON s.id = si.sale_id
         WHERE si.id = ? AND s.tenant_id = ?
         LIMIT 1`
      )
      .get(entityId, tenantId) as { id: string } | undefined;

    return Boolean(row?.id);
  }

  if (tableName === 'purchase_return_items') {
    const row = sqlite
      .prepare(
        `SELECT pri.id
         FROM purchase_return_items pri
         INNER JOIN purchase_returns pr ON pr.id = pri.purchase_return_id
         WHERE pri.id = ? AND pr.tenant_id = ?
         LIMIT 1`
      )
      .get(entityId, tenantId) as { id: string } | undefined;

    return Boolean(row?.id);
  }

  if (tableName === 'order_items') {
    const row = sqlite
      .prepare(
        `SELECT oi.id
         FROM order_items oi
         INNER JOIN orders o ON o.id = oi.order_id
         WHERE oi.id = ? AND o.tenant_id = ?
         LIMIT 1`
      )
      .get(entityId, tenantId) as { id: string } | undefined;

    return Boolean(row?.id);
  }

  if (tableName === 'purchase_items') {
    const row = sqlite
      .prepare(
        `SELECT pi.id
         FROM purchase_items pi
         INNER JOIN purchases p ON p.id = pi.purchase_id
         WHERE pi.id = ? AND p.tenant_id = ?
         LIMIT 1`
      )
      .get(entityId, tenantId) as { id: string } | undefined;

    return Boolean(row?.id);
  }

  const row = sqlite
    .prepare(`SELECT id FROM ${tableName} WHERE id = ? AND tenant_id = ? LIMIT 1`)
    .get(entityId, tenantId) as { id: string } | undefined;

  return Boolean(row?.id);
}

export function markSyncEntityAsSynced(
  tableName: keyof typeof SYNC_ENTITY_CONFIG,
  tenantId: string,
  entityId: string,
  now: string
): void {
  const config = SYNC_ENTITY_CONFIG[tableName];
  if (!config.supportsSyncMetadata) {
    return;
  }

  const sqlite = getSqliteClient().$client;
  const statement = config.touchUpdatedAt
    ? sqlite.prepare(
        `UPDATE ${config.tableName}
         SET sync_status = 'synced', sync_version = COALESCE(sync_version, 0) + 1, updated_at = ?
         WHERE id = ? AND tenant_id = ?`
      )
    : sqlite.prepare(
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

export async function incrementQueueFailure(
  tenantId: string,
  queueId: string,
  message: string
): Promise<void> {
  // : `sync_outbox.lastError` is a JSON `NormalizedOutboxError`
  // column, not a plain text. Mirrors `markOutboxFailure` in the
  // server router. Status flips to `retrying` so a subsequent
  // operator retry path picks the row up.
  await getServerDatabase()
    .update(syncOutbox)
    .set({
      status: 'retrying',
      attempts: sql`${syncOutbox.attempts} + 1`,
      lastError: { kind: 'UNKNOWN', message },
      updatedAt: new Date().toISOString(),
    })
    .where(and(eq(syncOutbox.id, queueId), eq(syncOutbox.tenantId, tenantId)))
    .run();
}

export async function ensurePendingConflict(
  tenantId: string,
  entityType: string,
  entityId: string,
  localData: Record<string, unknown>,
  remoteData: Record<string, unknown>
): Promise<string> {
  const database = getServerDatabase();
  const existingConflict = await database
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

  if (existingConflict?.id) {
    return existingConflict.id;
  }

  const conflictId = randomUUID();
  await database.insert(syncConflicts).values({
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

export function normalizeSyncEntityType(entityType: string): string {
  return SYNC_ENTITY_TYPE_MAP[entityType] ?? entityType;
}
