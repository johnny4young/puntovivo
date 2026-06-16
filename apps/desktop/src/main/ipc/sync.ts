/**
 * ENG-178 — desktop sync-bridge handlers + helpers, extracted verbatim
 * from the former monolithic main/index.ts. Electron-free (reaches the DB
 * only via runtime.ts + db.ts), so it stays unit-testable under node --test.
 * @module main/ipc/sync
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
import { mapRowToRendererRecord } from './db.js';

// SEC-003 — single source of truth for the operations the desktop sync
// bridge accepts. The IPC handler validates the renderer-supplied value
// against this list before any DB write, so a malformed/hostile payload
// cannot enqueue an outbox row with an unrecognised operation.
const DESKTOP_SYNC_OPERATIONS = ['create', 'update', 'delete'] as const;
type DesktopSyncOperation = (typeof DESKTOP_SYNC_OPERATIONS)[number];

export function assertDesktopSyncOperation(value: unknown): DesktopSyncOperation {
  if (
    typeof value === 'string' &&
    (DESKTOP_SYNC_OPERATIONS as readonly string[]).includes(value)
  ) {
    return value as DesktopSyncOperation;
  }
  throw new Error(`Sync operation "${String(value)}" is not allowed in the desktop bridge`);
}

export interface DesktopSyncQueueInput {
  entityType: string;
  entityId: string;
  operation: DesktopSyncOperation;
  payload?: Record<string, unknown>;
  tenantId: string;
}

export interface DesktopSyncStatusResult {
  isOnline: boolean;
  lastSync: string | null;
  pendingItems: number;
  conflicts: number;
}

export interface DesktopSyncTriggerResult extends DesktopSyncStatusResult {
  success: boolean;
  synced: number;
  errors: string[];
}

const DESKTOP_SYNC_CONFIG_KEY = 'desktop_sync_config';
const LAST_SYNC_KEY_PREFIX = 'sync_last_sync:';
const DESKTOP_PENDING_SYNC_STATUSES = ['queued', 'submitting', 'retrying'] as const;
const DESKTOP_PROCESSABLE_SYNC_STATUSES = ['queued', 'retrying'] as const;
type DesktopPendingSyncStatus = (typeof DESKTOP_PENDING_SYNC_STATUSES)[number];
type DesktopProcessableSyncStatus = (typeof DESKTOP_PROCESSABLE_SYNC_STATUSES)[number];
const SYNC_ENTITY_TYPE_MAP: Record<string, string> = {
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
const SYNC_ENTITY_CONFIG = {
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
const DESKTOP_MANUAL_SYNC_ENTITIES = new Set<string>([
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

function getLastSyncKey(tenantId: string): string {
  return `${LAST_SYNC_KEY_PREFIX}${tenantId}`;
}

function desktopPendingSyncWhere(tenantId?: string) {
  const statusFilter = inArray(
    syncOutbox.status,
    DESKTOP_PENDING_SYNC_STATUSES as unknown as DesktopPendingSyncStatus[]
  );
  return tenantId ? and(eq(syncOutbox.tenantId, tenantId), statusFilter) : statusFilter;
}

function desktopProcessableSyncWhere(tenantId: string) {
  return and(
    eq(syncOutbox.tenantId, tenantId),
    inArray(
      syncOutbox.status,
      DESKTOP_PROCESSABLE_SYNC_STATUSES as unknown as DesktopProcessableSyncStatus[]
    )
  );
}

function resolveDesktopConflictPolicy(entityType: string): SyncConflictPolicy {
  return DESKTOP_MANUAL_SYNC_ENTITIES.has(entityType) ? 'manual' : 'auto_lww';
}

async function getLastSyncAt(tenantId?: string): Promise<string | null> {
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

async function saveLastSyncAt(tenantId: string, value: string): Promise<void> {
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

export async function getDesktopSyncStatus(tenantId?: string): Promise<DesktopSyncStatusResult> {
  const database = getServerDatabase();
  const [queueRow, conflictRow, lastSync] = await Promise.all([
    tenantId
      ? database
          .select({ count: sql<number>`count(*)` })
          .from(syncOutbox)
          .where(desktopPendingSyncWhere(tenantId))
          .get()
      : database
          .select({ count: sql<number>`count(*)` })
          .from(syncOutbox)
          .where(desktopPendingSyncWhere())
          .get(),
    tenantId
      ? database
          .select({ count: sql<number>`count(*)` })
          .from(syncConflicts)
          .where(and(eq(syncConflicts.tenantId, tenantId), eq(syncConflicts.status, 'pending')))
          .get()
      : database
          .select({ count: sql<number>`count(*)` })
          .from(syncConflicts)
          .where(eq(syncConflicts.status, 'pending'))
          .get(),
    getLastSyncAt(tenantId),
  ]);

  return {
    isOnline: true,
    lastSync,
    pendingItems: queueRow?.count ?? 0,
    conflicts: conflictRow?.count ?? 0,
  };
}

function findLocalSyncEntity(
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

function markSyncEntityAsSynced(
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

async function incrementQueueFailure(
  tenantId: string,
  queueId: string,
  message: string
): Promise<void> {
  // ENG-064b: `sync_outbox.lastError` is a JSON `NormalizedOutboxError`
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

async function ensurePendingConflict(
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

function normalizeSyncEntityType(entityType: string): string {
  return SYNC_ENTITY_TYPE_MAP[entityType] ?? entityType;
}


export async function handleDesktopAddToSyncQueue(input: DesktopSyncQueueInput): Promise<void> {
  const database = getServerDatabase();
  const entityType = normalizeSyncEntityType(input.entityType);
  const payload = input.payload ?? {};
  const now = new Date().toISOString();
  const existingItems = await database
    .select()
    .from(syncOutbox)
    .where(
      and(
        eq(syncOutbox.tenantId, input.tenantId),
        eq(syncOutbox.entityType, entityType),
        eq(syncOutbox.entityId, input.entityId),
        inArray(
          syncOutbox.status,
          DESKTOP_PENDING_SYNC_STATUSES as unknown as DesktopPendingSyncStatus[]
        )
      )
    )
    .all();

  const pendingCreate = existingItems.find(item => item.operation === 'create');
  if (pendingCreate && input.operation === 'update') {
    await database
      .update(syncOutbox)
      .set({
        payload: {
          ...((pendingCreate.payload ?? {}) as Record<string, unknown>),
          ...payload,
        },
        conflictPolicy: resolveDesktopConflictPolicy(entityType),
        attempts: 0,
        lastError: null,
        status: 'queued',
        createdAt: now,
        updatedAt: now,
      })
      .where(eq(syncOutbox.id, pendingCreate.id))
      .run();
    return;
  }

  if (pendingCreate && input.operation === 'delete') {
    await database.delete(syncOutbox).where(eq(syncOutbox.id, pendingCreate.id)).run();
    return;
  }

  const pendingUpdate = existingItems.find(item => item.operation === 'update');
  if (pendingUpdate && input.operation === 'update') {
    await database
      .update(syncOutbox)
      .set({
        payload: {
          ...((pendingUpdate.payload ?? {}) as Record<string, unknown>),
          ...payload,
        },
        conflictPolicy: resolveDesktopConflictPolicy(entityType),
        attempts: 0,
        lastError: null,
        status: 'queued',
        createdAt: now,
        updatedAt: now,
      })
      .where(eq(syncOutbox.id, pendingUpdate.id))
      .run();
    return;
  }

  // ENG-064b: write directly to `sync_outbox` from the Electron IPC
  // bridge. Mirror ADR-0004's high-risk manual policy here because
  // this path can enqueue sales, inventory, orders, and purchases
  // without passing through the server-side `enqueueSync` helper.
  await database.insert(syncOutbox).values({
    id: randomUUID(),
    tenantId: input.tenantId,
    status: 'queued',
    entityType,
    entityId: input.entityId,
    operation: input.operation,
    conflictPolicy: resolveDesktopConflictPolicy(entityType),
    payload,
    payloadVersion: 1,
    attempts: 0,
    createdAt: now,
    updatedAt: now,
  });
}

export async function handleDesktopGetPendingSyncItems(tenantId: string): Promise<unknown[]> {
  const items = await getServerDatabase()
    .select()
    .from(syncOutbox)
    .where(desktopPendingSyncWhere(tenantId))
    .orderBy(syncOutbox.createdAt)
    .all();

  return items
    .map(item => mapRowToRendererRecord('sync_outbox', item as unknown as Record<string, unknown>))
    .filter((item): item is Record<string, unknown> => item !== null);
}

export async function handleDesktopTriggerSync(tenantId: string): Promise<DesktopSyncTriggerResult> {
  const database = getServerDatabase();
  const items = await database
    .select()
    .from(syncOutbox)
    .where(desktopProcessableSyncWhere(tenantId))
    .orderBy(syncOutbox.createdAt)
    .all();
  const processedIds: string[] = [];
  const errors: string[] = [];
  const now = new Date().toISOString();

  for (const item of items) {
    const existingConflict = await database
      .select({ id: syncConflicts.id })
      .from(syncConflicts)
      .where(
        and(
          eq(syncConflicts.tenantId, tenantId),
          eq(syncConflicts.entityType, item.entityType),
          eq(syncConflicts.entityId, item.entityId),
          eq(syncConflicts.status, 'pending')
        )
      )
      .get();

    if (existingConflict?.id) {
      const message = `Pending conflict blocks ${item.entityType}:${item.entityId}`;
      await incrementQueueFailure(tenantId, item.id, message);
      errors.push(message);
      continue;
    }

    if (!(item.entityType in SYNC_ENTITY_CONFIG)) {
      const message = `Unsupported sync entity type: ${item.entityType}`;
      await incrementQueueFailure(tenantId, item.id, message);
      errors.push(message);
      continue;
    }

    const entityType = item.entityType as keyof typeof SYNC_ENTITY_CONFIG;
    if (item.operation !== 'delete') {
      const exists = findLocalSyncEntity(entityType, tenantId, item.entityId);
      if (!exists) {
        const message = `Unable to sync ${item.entityType}:${item.entityId} because the local record is missing`;
        await ensurePendingConflict(
          tenantId,
          item.entityType,
          item.entityId,
          (item.payload ?? {}) as Record<string, unknown>,
          {}
        );
        await incrementQueueFailure(tenantId, item.id, message);
        errors.push(message);
        continue;
      }

      markSyncEntityAsSynced(entityType, tenantId, item.entityId, now);
    }

    await database.delete(syncOutbox).where(eq(syncOutbox.id, item.id)).run();
    processedIds.push(item.id);
  }

  if (processedIds.length > 0) {
    await saveLastSyncAt(tenantId, now);
  }

  const status = await getDesktopSyncStatus(tenantId);
  return {
    success: errors.length === 0,
    synced: processedIds.length,
    errors,
    ...status,
  };
}

export async function handleDesktopSetSyncConfig(config: Record<string, unknown>): Promise<void> {
  const database = getServerDatabase();
  const now = new Date().toISOString();
  const existing = await database
    .select({ key: appSettings.key })
    .from(appSettings)
    .where(eq(appSettings.key, DESKTOP_SYNC_CONFIG_KEY))
    .get();

  if (existing) {
    await database
      .update(appSettings)
      .set({
        value: config,
        updatedAt: now,
      })
      .where(eq(appSettings.key, DESKTOP_SYNC_CONFIG_KEY))
      .run();
    return;
  }

  await database.insert(appSettings).values({
    key: DESKTOP_SYNC_CONFIG_KEY,
    value: config,
    updatedAt: now,
  });
}
