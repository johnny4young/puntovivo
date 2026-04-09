import {
  app,
  shell,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  nativeTheme,
  Tray,
  nativeImage,
  type OpenDialogOptions,
  type SaveDialogOptions,
} from 'electron';
import { randomUUID } from 'node:crypto';
import { access, copyFile, mkdir, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import {
  createServer,
  type OpenYojobServer,
  appSettings,
  syncConflicts,
  syncQueue,
} from '@open-yojob/server';
import { and, eq, sql } from 'drizzle-orm';
import {
  checkForAppUpdates,
  getAutoUpdateStatus,
  initAutoUpdater,
  restartToApplyAppUpdate,
} from './auto-updater';

// Handle creating/removing shortcuts on Windows when installing/uninstalling.
if (require('electron-squirrel-startup')) {
  app.quit();
}

// Web app dev server URL (from apps/web)
const WEB_DEV_SERVER_URL = process.env.WEB_DEV_SERVER_URL || 'http://localhost:3000';
// Check if we're in development mode - electron-forge start sets app.isPackaged = false
const isDev = !app.isPackaged;

console.log(`[Electron] isPackaged: ${app.isPackaged}, isDev: ${isDev}`);

let mainWindow: BrowserWindow | null = null;
let server: OpenYojobServer | null = null;
let tray: Tray | null = null;
let isQuitting = false;
let currentTraySettings: TraySettings = {
  enabled: true,
  closeToTray: false,
};

// Server configuration
const SERVER_PORT = 8090;
const DB_PATH = join(app.getPath('userData'), 'data', 'local.db');
const SQLITE_SIDECAR_SUFFIXES = ['-wal', '-shm', '-journal'] as const;

interface DesktopDatabaseActionResult {
  success: boolean;
  cancelled: boolean;
  path?: string;
  error?: string;
}

interface ReceiptPrintSettings {
  silent: boolean;
  printBackground: boolean;
}

type ThemePreference = 'light' | 'dark' | 'system';

interface TraySettings {
  enabled: boolean;
  closeToTray: boolean;
}

type AllowedDesktopTable =
  | 'products'
  | 'customers'
  | 'sales'
  | 'sale_items'
  | 'categories'
  | 'inventory_movements'
  | 'sync_queue';

type DesktopSyncOperation = 'create' | 'update' | 'delete';

interface DesktopSyncQueueInput {
  entityType: string;
  entityId: string;
  operation: DesktopSyncOperation;
  payload?: Record<string, unknown>;
  tenantId: string;
}

interface DesktopSyncStatusResult {
  isOnline: boolean;
  lastSync: string | null;
  pendingItems: number;
  conflicts: number;
}

interface DesktopSyncTriggerResult extends DesktopSyncStatusResult {
  success: boolean;
  synced: number;
  errors: string[];
}

const RECEIPT_PRINT_SETTINGS_KEY = 'receipt_print_settings';
const THEME_PREFERENCE_KEY = 'theme_preference';
const TRAY_SETTINGS_KEY = 'tray_settings';
const DESKTOP_SYNC_CONFIG_KEY = 'desktop_sync_config';
const LAST_SYNC_KEY_PREFIX = 'sync_last_sync:';
const DEFAULT_RECEIPT_PRINT_SETTINGS: ReceiptPrintSettings = {
  silent: false,
  printBackground: true,
};
const DEFAULT_THEME_PREFERENCE: ThemePreference = 'system';
const DEFAULT_TRAY_SETTINGS: TraySettings = {
  enabled: true,
  closeToTray: false,
};
const ALLOWED_DESKTOP_TABLES = [
  'products',
  'customers',
  'sales',
  'sale_items',
  'categories',
  'inventory_movements',
  'sync_queue',
] as const satisfies readonly AllowedDesktopTable[];
const DIRECT_TENANT_TABLES = new Set<AllowedDesktopTable>([
  'products',
  'customers',
  'sales',
  'categories',
  'inventory_movements',
  'sync_queue',
]);
const SYNC_ENTITY_TYPE_MAP: Record<string, string> = {
  product: 'products',
  customer: 'customers',
  sale: 'sales',
  sale_item: 'sale_items',
  category: 'categories',
  inventory_movement: 'inventory_movements',
};
const SYNC_ENTITY_CONFIG = {
  categories: { tableName: 'categories', supportsSyncMetadata: false, touchUpdatedAt: false },
  client_types: { tableName: 'client_types', supportsSyncMetadata: false, touchUpdatedAt: false },
  customers: { tableName: 'customers', supportsSyncMetadata: true, touchUpdatedAt: true },
  identification_types: {
    tableName: 'identification_types',
    supportsSyncMetadata: false,
    touchUpdatedAt: false,
  },
  inventory_movements: {
    tableName: 'inventory_movements',
    supportsSyncMetadata: true,
    touchUpdatedAt: false,
  },
  location_x_site: { tableName: 'location_x_site', supportsSyncMetadata: false, touchUpdatedAt: false },
  order_items: { tableName: 'order_items', supportsSyncMetadata: false, touchUpdatedAt: false },
  orders: { tableName: 'orders', supportsSyncMetadata: true, touchUpdatedAt: true },
  person_types: { tableName: 'person_types', supportsSyncMetadata: false, touchUpdatedAt: false },
  products: { tableName: 'products', supportsSyncMetadata: true, touchUpdatedAt: true },
  regime_types: { tableName: 'regime_types', supportsSyncMetadata: false, touchUpdatedAt: false },
  sale_items: { tableName: 'sale_items', supportsSyncMetadata: false, touchUpdatedAt: false },
  sales: { tableName: 'sales', supportsSyncMetadata: true, touchUpdatedAt: true },
} as const;
const tableColumnsCache = new Map<AllowedDesktopTable, Set<string>>();

function createBackupFileName(now = new Date()): string {
  const timestamp = now.toISOString().replace(/[:.]/g, '-');
  return `open-yojob-backup-${timestamp}.db`;
}

async function ensureParentDirectoryExists(filePath: string): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });
}

async function removeSqliteSidecars(dbPath: string): Promise<void> {
  await Promise.all(
    SQLITE_SIDECAR_SUFFIXES.map(async suffix => {
      try {
        await rm(`${dbPath}${suffix}`);
      } catch (error) {
        const maybeFsError = error as NodeJS.ErrnoException;
        if (maybeFsError.code !== 'ENOENT') {
          throw error;
        }
      }
    })
  );
}

async function startEmbeddedServer(): Promise<OpenYojobServer> {
  console.log(`[Server] Starting embedded server...`);
  console.log(`[Server] Database path: ${DB_PATH}`);

  const nextServer = await createServer({
    dbPath: DB_PATH,
    port: SERVER_PORT,
    host: '127.0.0.1',
    verbose: isDev,
  });

  await nextServer.listen();
  console.log(`[Server] ✓ Server started at ${nextServer.getUrl()}`);

  return nextServer;
}

async function stopEmbeddedServer(): Promise<void> {
  if (!server) {
    return;
  }

  console.log('[Server] Shutting down...');
  await server.close();
  server = null;
  console.log('[Server] ✓ Server stopped');
}

async function runWithServerRestart<T>(
  operation: () => Promise<T>,
  options?: { reloadWindow?: boolean }
): Promise<T> {
  await stopEmbeddedServer();

  try {
    return await operation();
  } finally {
    server = await startEmbeddedServer();

    if (options?.reloadWindow && mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.reload();
    }
  }
}

function getServerDatabase(): OpenYojobServer['db'] {
  if (!server) {
    throw new Error('The embedded server is not available');
  }

  return server.db;
}

function getSqliteClient() {
  return getServerDatabase() as OpenYojobServer['db'] & {
    $client: import('better-sqlite3').Database;
  };
}

function isAllowedDesktopTable(value: string): value is AllowedDesktopTable {
  return (ALLOWED_DESKTOP_TABLES as readonly string[]).includes(value);
}

function getAllowedDesktopTable(table: string): AllowedDesktopTable {
  if (!isAllowedDesktopTable(table)) {
    throw new Error(`Table "${table}" is not allowed in the desktop bridge`);
  }

  return table;
}

function toSnakeCase(value: string): string {
  return value.replace(/[A-Z]/g, match => `_${match.toLowerCase()}`);
}

function toCamelCase(value: string): string {
  return value.replace(/_([a-z])/g, (_, char: string) => char.toUpperCase());
}

function getTableColumns(table: AllowedDesktopTable): Set<string> {
  const cached = tableColumnsCache.get(table);
  if (cached) {
    return cached;
  }

  const rows = getSqliteClient().$client
    .prepare(`PRAGMA table_info(${table})`)
    .all() as Array<{ name: string }>;
  const columns = new Set(rows.map(row => row.name));
  tableColumnsCache.set(table, columns);
  return columns;
}

function isJsonColumn(table: AllowedDesktopTable, column: string): boolean {
  return table === 'sync_queue' && column === 'data';
}

function serializeColumnValue(
  table: AllowedDesktopTable,
  column: string,
  value: unknown
): unknown {
  if (value === undefined) {
    return undefined;
  }

  if (column.startsWith('is_') && typeof value === 'boolean') {
    return value ? 1 : 0;
  }

  if (isJsonColumn(table, column)) {
    if (value === null) {
      return null;
    }
    return JSON.stringify(value);
  }

  return value;
}

function deserializeColumnValue(
  table: AllowedDesktopTable,
  column: string,
  value: unknown
): unknown {
  if (value === null || value === undefined) {
    return value;
  }

  if (column.startsWith('is_') && typeof value === 'number') {
    return value === 1;
  }

  if (isJsonColumn(table, column) && typeof value === 'string') {
    try {
      return JSON.parse(value) as unknown;
    } catch {
      return value;
    }
  }

  return value;
}

function normalizeRecordForTable(
  table: AllowedDesktopTable,
  input: Record<string, unknown>,
  options: { includeId?: boolean } = {}
): Record<string, unknown> {
  const columns = getTableColumns(table);
  const normalized: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(input)) {
    const column = toSnakeCase(key);
    if (!columns.has(column)) {
      continue;
    }

    if (column === 'id' && !options.includeId) {
      continue;
    }

    const serialized = serializeColumnValue(table, column, value);
    if (serialized !== undefined) {
      normalized[column] = serialized;
    }
  }

  return normalized;
}

function mapRowToRendererRecord(
  table: AllowedDesktopTable,
  row: Record<string, unknown> | undefined
): Record<string, unknown> | null {
  if (!row) {
    return null;
  }

  const mapped = Object.fromEntries(
    Object.entries(row).map(([column, value]) => [
      toCamelCase(column),
      deserializeColumnValue(table, column, value),
    ])
  );

  if (table === 'sync_queue') {
    const queueRow = mapped as Record<string, unknown>;
    const payload = queueRow.data as Record<string, unknown> | undefined;
    const retryCount = queueRow.attempts as number | undefined;
    delete queueRow.data;
    delete queueRow.attempts;
    delete queueRow.localVersion;

    return {
      ...queueRow,
      payload: payload ?? {},
      retryCount: retryCount ?? 0,
    };
  }

  return mapped;
}

function getLastSyncKey(tenantId: string): string {
  return `${LAST_SYNC_KEY_PREFIX}${tenantId}`;
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

async function getDesktopSyncStatus(tenantId?: string): Promise<DesktopSyncStatusResult> {
  const database = getServerDatabase();
  const [queueRow, conflictRow, lastSync] = await Promise.all([
    tenantId
      ? database
          .select({ count: sql<number>`count(*)` })
          .from(syncQueue)
          .where(eq(syncQueue.tenantId, tenantId))
          .get()
      : database.select({ count: sql<number>`count(*)` }).from(syncQueue).get(),
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
  await getServerDatabase()
    .update(syncQueue)
    .set({
      attempts: sql`${syncQueue.attempts} + 1`,
      lastError: message,
    })
    .where(and(eq(syncQueue.id, queueId), eq(syncQueue.tenantId, tenantId)))
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

async function getDesktopRecordById(
  table: AllowedDesktopTable,
  id: string
): Promise<Record<string, unknown> | null> {
  const sqlite = getSqliteClient().$client;
  const row = sqlite.prepare(`SELECT * FROM ${table} WHERE id = ? LIMIT 1`).get(id) as
    | Record<string, unknown>
    | undefined;

  return mapRowToRendererRecord(table, row);
}

async function handleDesktopGetAll(tableName: string, tenantId: string): Promise<unknown[]> {
  const table = getAllowedDesktopTable(tableName);
  const sqlite = getSqliteClient().$client;

  const rows =
    table === 'sale_items'
      ? (sqlite
          .prepare(
            `SELECT si.*
             FROM sale_items si
             INNER JOIN sales s ON s.id = si.sale_id
             WHERE s.tenant_id = ?`
          )
          .all(tenantId) as Record<string, unknown>[])
      : DIRECT_TENANT_TABLES.has(table)
        ? (sqlite
            .prepare(`SELECT * FROM ${table} WHERE tenant_id = ?`)
            .all(tenantId) as Record<string, unknown>[])
        : (sqlite.prepare(`SELECT * FROM ${table}`).all() as Record<string, unknown>[]);

  return rows
    .map(row => mapRowToRendererRecord(table, row))
    .filter((row): row is Record<string, unknown> => row !== null);
}

async function handleDesktopGetById(tableName: string, id: string): Promise<unknown> {
  const table = getAllowedDesktopTable(tableName);
  return getDesktopRecordById(table, id);
}

async function handleDesktopInsert(
  tableName: string,
  data: Record<string, unknown>
): Promise<unknown> {
  const table = getAllowedDesktopTable(tableName);
  const sqlite = getSqliteClient().$client;
  const normalized = normalizeRecordForTable(table, data, { includeId: true });
  const id = normalized.id;

  if (typeof id !== 'string' || id.length === 0) {
    throw new Error(`Table "${table}" requires a string id`);
  }

  const columns = Object.keys(normalized);
  if (columns.length === 0) {
    throw new Error(`No writable fields were provided for table "${table}"`);
  }

  const placeholders = columns.map(() => '?').join(', ');
  const values = columns.map(column => normalized[column]);

  sqlite
    .prepare(`INSERT INTO ${table} (${columns.join(', ')}) VALUES (${placeholders})`)
    .run(...values);

  return getDesktopRecordById(table, id);
}

async function handleDesktopUpdate(
  tableName: string,
  id: string,
  data: Record<string, unknown>
): Promise<unknown> {
  const table = getAllowedDesktopTable(tableName);
  const sqlite = getSqliteClient().$client;
  const normalized = normalizeRecordForTable(table, data);
  const columns = Object.keys(normalized);

  if (columns.length > 0) {
    const assignments = columns.map(column => `${column} = ?`).join(', ');
    const values = columns.map(column => normalized[column]);
    sqlite.prepare(`UPDATE ${table} SET ${assignments} WHERE id = ?`).run(...values, id);
  }

  return getDesktopRecordById(table, id);
}

async function handleDesktopDelete(tableName: string, id: string): Promise<boolean> {
  const table = getAllowedDesktopTable(tableName);
  const result = getSqliteClient().$client.prepare(`DELETE FROM ${table} WHERE id = ?`).run(id);
  return result.changes > 0;
}

async function handleDesktopGetByField(
  tableName: string,
  fieldName: string,
  value: unknown
): Promise<unknown[]> {
  const table = getAllowedDesktopTable(tableName);
  const field = toSnakeCase(fieldName);

  if (!getTableColumns(table).has(field)) {
    throw new Error(`Field "${fieldName}" is not allowed for table "${table}"`);
  }

  const rows = getSqliteClient().$client
    .prepare(`SELECT * FROM ${table} WHERE ${field} = ?`)
    .all(value) as Record<string, unknown>[];

  return rows
    .map(row => mapRowToRendererRecord(table, row))
    .filter((row): row is Record<string, unknown> => row !== null);
}

async function handleDesktopDeleteByTenant(tableName: string, tenantId: string): Promise<number> {
  const table = getAllowedDesktopTable(tableName);
  const sqlite = getSqliteClient().$client;
  const result =
    table === 'sale_items'
      ? sqlite
          .prepare(
            `DELETE FROM sale_items
             WHERE sale_id IN (SELECT id FROM sales WHERE tenant_id = ?)`
          )
          .run(tenantId)
      : sqlite.prepare(`DELETE FROM ${table} WHERE tenant_id = ?`).run(tenantId);

  return result.changes;
}

async function handleDesktopCountByTenant(tableName: string, tenantId: string): Promise<number> {
  const table = getAllowedDesktopTable(tableName);
  const sqlite = getSqliteClient().$client;
  const row =
    table === 'sale_items'
      ? (sqlite
          .prepare(
            `SELECT COUNT(*) AS count
             FROM sale_items si
             INNER JOIN sales s ON s.id = si.sale_id
             WHERE s.tenant_id = ?`
          )
          .get(tenantId) as { count: number } | undefined)
      : (sqlite
          .prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE tenant_id = ?`)
          .get(tenantId) as { count: number } | undefined);

  return row?.count ?? 0;
}

async function handleDesktopAddToSyncQueue(input: DesktopSyncQueueInput): Promise<void> {
  const database = getServerDatabase();
  const entityType = normalizeSyncEntityType(input.entityType);
  const payload = input.payload ?? {};
  const now = new Date().toISOString();
  const existingItems = await database
    .select()
    .from(syncQueue)
    .where(
      and(
        eq(syncQueue.tenantId, input.tenantId),
        eq(syncQueue.entityType, entityType),
        eq(syncQueue.entityId, input.entityId)
      )
    )
    .all();

  const pendingCreate = existingItems.find(item => item.operation === 'create');
  if (pendingCreate && input.operation === 'update') {
    await database
      .update(syncQueue)
      .set({
        data: {
          ...(pendingCreate.data ?? {}),
          ...payload,
        },
        attempts: 0,
        lastError: null,
        createdAt: now,
      })
      .where(eq(syncQueue.id, pendingCreate.id))
      .run();
    return;
  }

  if (pendingCreate && input.operation === 'delete') {
    await database.delete(syncQueue).where(eq(syncQueue.id, pendingCreate.id)).run();
    return;
  }

  const pendingUpdate = existingItems.find(item => item.operation === 'update');
  if (pendingUpdate && input.operation === 'update') {
    await database
      .update(syncQueue)
      .set({
        data: {
          ...(pendingUpdate.data ?? {}),
          ...payload,
        },
        attempts: 0,
        lastError: null,
        createdAt: now,
      })
      .where(eq(syncQueue.id, pendingUpdate.id))
      .run();
    return;
  }

  await database.insert(syncQueue).values({
    id: randomUUID(),
    tenantId: input.tenantId,
    entityType,
    entityId: input.entityId,
    operation: input.operation,
    data: payload,
    localVersion: 1,
    attempts: 0,
    createdAt: now,
  });
}

async function handleDesktopGetPendingSyncItems(tenantId: string): Promise<unknown[]> {
  const items = await getServerDatabase()
    .select()
    .from(syncQueue)
    .where(eq(syncQueue.tenantId, tenantId))
    .orderBy(syncQueue.createdAt)
    .all();

  return items
    .map(item => mapRowToRendererRecord('sync_queue', item as unknown as Record<string, unknown>))
    .filter((item): item is Record<string, unknown> => item !== null);
}

async function handleDesktopTriggerSync(tenantId: string): Promise<DesktopSyncTriggerResult> {
  const database = getServerDatabase();
  const items = await database
    .select()
    .from(syncQueue)
    .where(eq(syncQueue.tenantId, tenantId))
    .orderBy(syncQueue.createdAt)
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
          (item.data ?? {}) as Record<string, unknown>,
          {}
        );
        await incrementQueueFailure(tenantId, item.id, message);
        errors.push(message);
        continue;
      }

      markSyncEntityAsSynced(entityType, tenantId, item.entityId, now);
    }

    await database.delete(syncQueue).where(eq(syncQueue.id, item.id)).run();
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

async function handleDesktopSetSyncConfig(config: Record<string, unknown>): Promise<void> {
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

function normalizeReceiptPrintSettings(
  value: unknown,
  base: ReceiptPrintSettings = DEFAULT_RECEIPT_PRINT_SETTINGS
): ReceiptPrintSettings {
  if (!value || typeof value !== 'object') {
    return { ...base };
  }

  const candidate = value as Partial<ReceiptPrintSettings>;

  return {
    silent: typeof candidate.silent === 'boolean' ? candidate.silent : base.silent,
    printBackground:
      typeof candidate.printBackground === 'boolean'
        ? candidate.printBackground
        : base.printBackground,
  };
}

async function getReceiptPrintSettings(): Promise<ReceiptPrintSettings> {
  const database = getServerDatabase();
  const row = await database
    .select({ value: appSettings.value })
    .from(appSettings)
    .where(eq(appSettings.key, RECEIPT_PRINT_SETTINGS_KEY))
    .get();

  return normalizeReceiptPrintSettings(row?.value);
}

async function saveReceiptPrintSettings(settings: unknown): Promise<ReceiptPrintSettings> {
  const database = getServerDatabase();
  const now = new Date().toISOString();
  const nextSettings = normalizeReceiptPrintSettings(
    settings,
    await getReceiptPrintSettings()
  );
  const existing = await database
    .select({ key: appSettings.key })
    .from(appSettings)
    .where(eq(appSettings.key, RECEIPT_PRINT_SETTINGS_KEY))
    .get();

  if (existing) {
    await database
      .update(appSettings)
      .set({
        value: nextSettings,
        updatedAt: now,
      })
      .where(eq(appSettings.key, RECEIPT_PRINT_SETTINGS_KEY));
  } else {
    await database.insert(appSettings).values({
      key: RECEIPT_PRINT_SETTINGS_KEY,
      value: nextSettings,
      updatedAt: now,
    });
  }

  return nextSettings;
}

function normalizeThemePreference(value: unknown): ThemePreference {
  if (value === 'light' || value === 'dark' || value === 'system') {
    return value;
  }

  return DEFAULT_THEME_PREFERENCE;
}

function applyThemePreference(preference: ThemePreference): ThemePreference {
  nativeTheme.themeSource = preference;
  return preference;
}

async function getThemePreference(): Promise<ThemePreference> {
  const database = getServerDatabase();
  const row = await database
    .select({ value: appSettings.value })
    .from(appSettings)
    .where(eq(appSettings.key, THEME_PREFERENCE_KEY))
    .get();

  return normalizeThemePreference(row?.value);
}

async function saveThemePreference(preference: unknown): Promise<ThemePreference> {
  const database = getServerDatabase();
  const now = new Date().toISOString();
  const nextPreference = applyThemePreference(normalizeThemePreference(preference));
  const existing = await database
    .select({ key: appSettings.key })
    .from(appSettings)
    .where(eq(appSettings.key, THEME_PREFERENCE_KEY))
    .get();

  if (existing) {
    await database
      .update(appSettings)
      .set({
        value: nextPreference,
        updatedAt: now,
      })
      .where(eq(appSettings.key, THEME_PREFERENCE_KEY));
  } else {
    await database.insert(appSettings).values({
      key: THEME_PREFERENCE_KEY,
      value: nextPreference,
      updatedAt: now,
    });
  }

  return nextPreference;
}

function normalizeTraySettings(
  value: unknown,
  base: TraySettings = DEFAULT_TRAY_SETTINGS
): TraySettings {
  if (!value || typeof value !== 'object') {
    return { ...base };
  }

  const candidate = value as Partial<TraySettings>;

  return {
    enabled: typeof candidate.enabled === 'boolean' ? candidate.enabled : base.enabled,
    closeToTray:
      typeof candidate.closeToTray === 'boolean' ? candidate.closeToTray : base.closeToTray,
  };
}

async function getTraySettings(): Promise<TraySettings> {
  const database = getServerDatabase();
  const row = await database
    .select({ value: appSettings.value })
    .from(appSettings)
    .where(eq(appSettings.key, TRAY_SETTINGS_KEY))
    .get();

  return normalizeTraySettings(row?.value);
}

function createTrayIcon() {
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64">
      <rect x="10" y="10" width="44" height="44" rx="12" fill="#0ea5e9"/>
      <path d="M22 22h20v6H28v8h12v6H28v10h-6V22z" fill="#ffffff"/>
    </svg>
  `.trim();

  return nativeImage
    .createFromDataURL(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`)
    .resize({ width: 18, height: 18 });
}

function showMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    createWindow();
    return;
  }

  if (mainWindow.isMinimized()) {
    mainWindow.restore();
  }

  if (!mainWindow.isVisible()) {
    mainWindow.show();
  }

  mainWindow.focus();
}

function hideMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }

  mainWindow.hide();
}

function toggleMainWindowVisibility() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    createWindow();
    return;
  }

  if (mainWindow.isVisible()) {
    hideMainWindow();
    return;
  }

  showMainWindow();
}

function destroyTray() {
  if (!tray) {
    return;
  }

  tray.destroy();
  tray = null;
}

function refreshTray(settings = currentTraySettings) {
  currentTraySettings = settings;

  if (!settings.enabled) {
    destroyTray();
    return;
  }

  if (!tray) {
    tray = new Tray(createTrayIcon());
    tray.setToolTip('Open Yojob');
    tray.on('click', () => {
      toggleMainWindowVisibility();
    });
  }

  const contextMenu = Menu.buildFromTemplate([
    {
      label: mainWindow?.isVisible() ? 'Hide Window' : 'Open Window',
      click: () => {
        toggleMainWindowVisibility();
      },
    },
    { type: 'separator' },
    {
      label: settings.closeToTray ? 'Closing hides to tray' : 'Closing quits the app',
      enabled: false,
    },
    { type: 'separator' },
    {
      label: 'Quit',
      click: () => {
        isQuitting = true;
        app.quit();
      },
    },
  ]);

  tray.setContextMenu(contextMenu);
}

async function saveTraySettings(settings: unknown): Promise<TraySettings> {
  const database = getServerDatabase();
  const now = new Date().toISOString();
  const nextSettings = normalizeTraySettings(settings, await getTraySettings());
  const existing = await database
    .select({ key: appSettings.key })
    .from(appSettings)
    .where(eq(appSettings.key, TRAY_SETTINGS_KEY))
    .get();

  if (existing) {
    await database
      .update(appSettings)
      .set({
        value: nextSettings,
        updatedAt: now,
      })
      .where(eq(appSettings.key, TRAY_SETTINGS_KEY));
  } else {
    await database.insert(appSettings).values({
      key: TRAY_SETTINGS_KEY,
      value: nextSettings,
      updatedAt: now,
    });
  }

  refreshTray(nextSettings);
  return nextSettings;
}

async function printReceipt(
  receiptHtml: string,
  settings: ReceiptPrintSettings
): Promise<void> {
  const printWindow = new BrowserWindow({
    show: false,
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  try {
    await printWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(receiptHtml)}`);

    await new Promise<void>((resolve, reject) => {
      printWindow.webContents.print(
        {
          silent: settings.silent,
          printBackground: settings.printBackground,
        },
        (success, failureReason) => {
          if (!success) {
            reject(new Error(failureReason || 'Receipt printing failed'));
            return;
          }

          resolve();
        }
      );
    });
  } finally {
    if (!printWindow.isDestroyed()) {
      printWindow.close();
    }
  }
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1024,
    minHeight: 768,
    show: false,
    autoHideMenuBar: true,
    title: 'Open Yojob - POS Solutions',
    webPreferences: {
      preload: join(__dirname, '../preload/index.cjs'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.on('ready-to-show', () => {
    mainWindow?.show();
  });

  mainWindow.on('close', event => {
    if (!isQuitting && currentTraySettings.enabled && currentTraySettings.closeToTray) {
      event.preventDefault();
      hideMainWindow();
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  mainWindow.on('show', () => {
    refreshTray();
  });

  mainWindow.on('hide', () => {
    refreshTray();
  });

  mainWindow.webContents.setWindowOpenHandler(details => {
    shell.openExternal(details.url);
    return { action: 'deny' };
  });

  // Load the renderer based on mode
  if (isDev) {
    // Development mode: load from web dev server
    console.log(`[Dev Mode] Loading from dev server: ${WEB_DEV_SERVER_URL}`);
    mainWindow.loadURL(WEB_DEV_SERVER_URL);
    // Open DevTools in development
    mainWindow.webContents.openDevTools();
  } else {
    // Production mode: load from packaged web app
    const webAppPath = join(process.resourcesPath, 'dist', 'index.html');
    console.log(`[Production Mode] Loading from: ${webAppPath}`);
    mainWindow.loadFile(webAppPath);
  }

  // Forward renderer console logs to terminal in development
  if (isDev) {
    mainWindow.webContents.on('console-message', (_event, level, message, line, sourceId) => {
      const levelStr = ['LOG', 'WARN', 'ERROR'][level] || 'INFO';
      console.log(`[Renderer ${levelStr}] ${message} (${sourceId}:${line})`);
    });
  }
}

async function handleCreateDatabaseBackup(): Promise<DesktopDatabaseActionResult> {
  const saveDialogOptions: SaveDialogOptions = {
    title: 'Create Database Backup',
    defaultPath: join(app.getPath('documents'), createBackupFileName()),
    filters: [
      {
        name: 'SQLite Database',
        extensions: ['db', 'sqlite', 'sqlite3'],
      },
    ],
  };
  const { canceled, filePath } = mainWindow
    ? await dialog.showSaveDialog(mainWindow, saveDialogOptions)
    : await dialog.showSaveDialog(saveDialogOptions);

  if (canceled || !filePath) {
    return {
      success: false,
      cancelled: true,
    };
  }

  try {
    await runWithServerRestart(async () => {
      await access(DB_PATH);
      await ensureParentDirectoryExists(filePath);
      await copyFile(DB_PATH, filePath);
    });

    return {
      success: true,
      cancelled: false,
      path: filePath,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Backup creation failed';
    console.error('[Backup] Failed to create backup:', error);
    return {
      success: false,
      cancelled: false,
      error: message,
    };
  }
}

async function handleRestoreDatabaseBackup(): Promise<DesktopDatabaseActionResult> {
  const openDialogOptions: OpenDialogOptions = {
    title: 'Restore Database Backup',
    properties: ['openFile'],
    filters: [
      {
        name: 'SQLite Database',
        extensions: ['db', 'sqlite', 'sqlite3'],
      },
    ],
  };
  const { canceled, filePaths } = mainWindow
    ? await dialog.showOpenDialog(mainWindow, openDialogOptions)
    : await dialog.showOpenDialog(openDialogOptions);

  const selectedBackupPath = filePaths[0];
  if (canceled || !selectedBackupPath) {
    return {
      success: false,
      cancelled: true,
    };
  }

  try {
    await runWithServerRestart(
      async () => {
        await access(selectedBackupPath);
        await ensureParentDirectoryExists(DB_PATH);
        await removeSqliteSidecars(DB_PATH);
        await copyFile(selectedBackupPath, DB_PATH);
        await removeSqliteSidecars(DB_PATH);
      },
      { reloadWindow: true }
    );

    return {
      success: true,
      cancelled: false,
      path: selectedBackupPath,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Database restore failed';
    console.error('[Backup] Failed to restore backup:', error);
    return {
      success: false,
      cancelled: false,
      error: message,
    };
  }
}

// Initialize the application
app.whenReady().then(async () => {
  // Initialize auto-updater (configurable via env)
  initAutoUpdater();

  // Start embedded Fastify server
  try {
    server = await startEmbeddedServer();
    applyThemePreference(await getThemePreference());
    currentTraySettings = await getTraySettings();
  } catch (err) {
    console.error('[Server] Failed to start:', err);
  }

  createWindow();
  refreshTray();

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
      refreshTray();
      return;
    }

    showMainWindow();
  });
});

app.on('before-quit', () => {
  isQuitting = true;
});

// Quit when all windows are closed
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('will-quit', () => {
  destroyTray();
  void stopEmbeddedServer();
});

// IPC Handlers
ipcMain.handle('get-app-version', () => app.getVersion());
ipcMain.handle('get-app-path', () => app.getPath('userData'));
ipcMain.handle('get-server-url', () => server?.getUrl() || `http://127.0.0.1:${SERVER_PORT}`);
ipcMain.handle('get-auto-update-status', () => getAutoUpdateStatus());
ipcMain.handle('check-for-app-updates', () => checkForAppUpdates());
ipcMain.handle('restart-to-apply-app-update', () => restartToApplyAppUpdate());
ipcMain.handle('create-database-backup', handleCreateDatabaseBackup);
ipcMain.handle('restore-database-backup', handleRestoreDatabaseBackup);
ipcMain.handle('get-receipt-print-settings', async () => {
  return getReceiptPrintSettings();
});
ipcMain.handle('update-receipt-print-settings', async (_event, settings: unknown) => {
  return saveReceiptPrintSettings(settings);
});
ipcMain.handle('get-theme-preference', async () => {
  return getThemePreference();
});
ipcMain.handle('update-theme-preference', async (_event, preference: unknown) => {
  return saveThemePreference(preference);
});
ipcMain.handle('get-tray-settings', async () => {
  return getTraySettings();
});
ipcMain.handle('update-tray-settings', async (_event, settings: unknown) => {
  return saveTraySettings(settings);
});
ipcMain.handle('db:getAll', async (_event, table: string, tenantId: string) => {
  return handleDesktopGetAll(table, tenantId);
});
ipcMain.handle('db:getById', async (_event, table: string, id: string) => {
  return handleDesktopGetById(table, id);
});
ipcMain.handle('db:insert', async (_event, table: string, data: Record<string, unknown>) => {
  return handleDesktopInsert(table, data);
});
ipcMain.handle(
  'db:update',
  async (_event, table: string, id: string, data: Record<string, unknown>) => {
    return handleDesktopUpdate(table, id, data);
  }
);
ipcMain.handle('db:delete', async (_event, table: string, id: string) => {
  return handleDesktopDelete(table, id);
});
ipcMain.handle(
  'db:getByField',
  async (_event, table: string, fieldName: string, value: unknown) => {
    return handleDesktopGetByField(table, fieldName, value);
  }
);
ipcMain.handle('db:deleteByTenant', async (_event, table: string, tenantId: string) => {
  return handleDesktopDeleteByTenant(table, tenantId);
});
ipcMain.handle('db:countByTenant', async (_event, table: string, tenantId: string) => {
  return handleDesktopCountByTenant(table, tenantId);
});
ipcMain.handle('db:addToSyncQueue', async (_event, item: DesktopSyncQueueInput) => {
  return handleDesktopAddToSyncQueue(item);
});
ipcMain.handle('db:getPendingSyncItems', async (_event, tenantId: string) => {
  return handleDesktopGetPendingSyncItems(tenantId);
});
ipcMain.handle('sync:getStatus', async (_event, tenantId?: string) => {
  return getDesktopSyncStatus(tenantId);
});
ipcMain.handle('sync:triggerSync', async (_event, tenantId?: string) => {
  if (!tenantId) {
    throw new Error('A tenant id is required to trigger sync');
  }

  return handleDesktopTriggerSync(tenantId);
});
ipcMain.handle('sync:setConfig', async (_event, config: Record<string, unknown>) => {
  return handleDesktopSetSyncConfig(config);
});
ipcMain.handle('print-receipt', async (_event, receiptHtml: unknown) => {
  if (typeof receiptHtml !== 'string' || receiptHtml.trim().length === 0) {
    return {
      success: false,
      error: 'A receipt document is required before printing',
    };
  }

  try {
    const settings = await getReceiptPrintSettings();
    await printReceipt(receiptHtml, settings);
    return { success: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Receipt printing failed';
    console.error('[Print] Receipt printing failed:', error);
    return {
      success: false,
      error: message,
    };
  }
});
