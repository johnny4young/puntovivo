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
import { existsSync } from 'node:fs';
import { access, copyFile, mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { DEVICE_ID_FILENAME, readDeviceIdFromDir, writeDeviceIdToDir } from './device-id-store.js';
import {
  createBackupBundle,
  createBackupFileName as createBackupZipFileName,
  extractBackupBundle,
  assertSqliteIntegrity,
} from './backup/backup-bundle.js';
import {
  createServer,
  createModuleLogger,
  resolveRuntimeConfig,
  type PuntovivoServer,
  type RuntimeConfig,
  type SyncConflictPolicy,
  appSettings,
  syncConflicts,
  syncOutbox,
} from '@puntovivo/server';

// ENG-006 — three child loggers for the Electron main. `electron-main`
// covers the embedded Fastify lifecycle, window loading, and the
// renderer-console forwarding hook. `backup` and `print` split out
// two frequent-error surfaces so operators can filter the stream by
// module=backup or module=print without additional tagging.
const mainLog = createModuleLogger('electron-main');
const rendererLog = createModuleLogger('renderer');
const backupLog = createModuleLogger('backup');
const printLog = createModuleLogger('print');

// Renderer console levels map to pino levels via this table. Electron
// reports the level as a narrow union of strings (`debug` | `info` |
// `warning` | `error`) on the console-message event; we route each to
// the matching pino method so the severity bubbles through to any
// downstream log consumer unchanged.
const RENDERER_LEVEL_MAP = {
  debug: 'debug',
  info: 'info',
  warning: 'warn',
  error: 'error',
} as const satisfies Record<
  import('electron').WebContentsConsoleMessageEventParams['level'],
  'debug' | 'info' | 'warn' | 'error'
>;
import { and, eq, inArray, sql } from 'drizzle-orm';
import {
  checkForAppUpdates,
  getAutoUpdateStatus,
  initAutoUpdater,
  refreshAutoUpdateTranslations,
  restartToApplyAppUpdate,
} from './auto-updater';
import { t, setMainLocale, normalizeMainLocale, type MainLocale } from './i18n';
import { buildMainWindowWebPreferences } from './window-config.js';
// ENG-025 — single source of truth for the authenticated identity at
// the IPC boundary. Every db:* / sync:* handler reads tenantId from
// here instead of trusting the renderer-supplied argument. The
// `SESSION_NOT_REGISTERED` and `SESSION_REGISTER_REJECTED` error
// strings are the stable contract the renderer matches against to
// decide whether to redirect to the login screen.
import * as desktopSession from './session/desktopSession.js';
import { verifyTokenWithServer } from '@puntovivo/server';

// Handle creating/removing shortcuts on Windows when installing/uninstalling.
if (require('electron-squirrel-startup')) {
  app.quit();
}

// Web app dev server URL (from apps/web)
const WEB_DEV_SERVER_URL = process.env.WEB_DEV_SERVER_URL || 'http://localhost:3000';
// Check if we're in development mode - electron-forge start sets app.isPackaged = false
const isDev = !app.isPackaged;
const shouldOpenDevTools = process.env.PUNTOVIVO_OPEN_DEVTOOLS === 'true';
process.env.PUNTOVIVO_RUNTIME_ENV ??= isDev ? 'development' : 'production';

mainLog.info({ isPackaged: app.isPackaged, isDev }, 'electron runtime detected');

let mainWindow: BrowserWindow | null = null;
let server: PuntovivoServer | null = null;
let tray: Tray | null = null;
let isQuitting = false;
let currentTraySettings: TraySettings = {
  enabled: true,
  closeToTray: false,
};

// Server configuration. ENG-072 — port/host are resolved through the
// shared Authority Node runtime config so the embedded server picks
// up `PUNTOVIVO_*` env overrides (operator boots a Store Hub by
// exporting `PUNTOVIVO_AUTHORITY_MODE=site_hub` etc., even when
// launching from Electron). Defaults match the historical hardcoded
// `127.0.0.1:8090` so a fresh install boots identically to today.
const DB_PATH = join(app.getPath('userData'), 'data', 'local.db');
const SQLITE_SIDECAR_SUFFIXES = ['-wal', '-shm', '-journal'] as const;

// ENG-002 step 2 — in packaged builds, the generated Drizzle migrations
// ship via forge.config.ts `extraResource` into process.resourcesPath.
// In dev (electron-forge start), the server module is bundled into
// `apps/desktop/.vite/build/index.cjs`, so the server-side
// `MIGRATIONS_FOLDER` (computed from `import.meta.url`) resolves
// against that bundle path rather than the original source. Up to
// Vite 7 the bundler preserved the original `import.meta.url`, so
// the default fallback worked; ENG-026's bump to Vite 8 (Rolldown)
// rewrites the URL to the bundle and the lookup misses. Resolve the
// dev override from the migrations copied into `.vite/build` first,
// then fall back through the source workspace layouts used by
// electron-forge and direct local invocations.
function resolveDevMigrationsPath(): string {
  const candidates = [
    join(app.getAppPath(), 'migrations'),
    join(app.getAppPath(), '..', '..', '..', '..', 'packages', 'server', 'dist', 'db', 'migrations'),
    join(app.getAppPath(), '..', '..', 'packages', 'server', 'dist', 'db', 'migrations'),
    join(process.cwd(), 'packages', 'server', 'dist', 'db', 'migrations'),
  ];

  return (
    candidates.find(candidate => existsSync(join(candidate, 'meta', '_journal.json'))) ??
    candidates[0]!
  );
}

const MIGRATIONS_PATH = app.isPackaged
  ? join(process.resourcesPath, 'migrations')
  : resolveDevMigrationsPath();

interface DesktopDatabaseActionResult {
  success: boolean;
  cancelled: boolean;
  path?: string;
  /**
   * ENG-066 — bytes of the produced backup ZIP. Existing renderer callers
   * can ignore it; future toasts/diagnostics may surface it.
   */
  sizeBytes?: number;
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
  | 'sync_outbox';

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
const DESKTOP_PENDING_SYNC_STATUSES = ['queued', 'submitting', 'retrying'] as const;
const DESKTOP_PROCESSABLE_SYNC_STATUSES = ['queued', 'retrying'] as const;
type DesktopPendingSyncStatus = (typeof DESKTOP_PENDING_SYNC_STATUSES)[number];
type DesktopProcessableSyncStatus = (typeof DESKTOP_PROCESSABLE_SYNC_STATUSES)[number];
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
  'sync_outbox',
] as const satisfies readonly AllowedDesktopTable[];
const DIRECT_TENANT_TABLES = new Set<AllowedDesktopTable>([
  'products',
  'customers',
  'sales',
  'categories',
  'inventory_movements',
  'sync_outbox',
]);
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
const tableColumnsCache = new Map<AllowedDesktopTable, Set<string>>();

/**
 * Resolves to `${userData}/device-id.txt`. Backup bundles include
 * this file so device identity travels with the data: a full-disk
 * failure can restore the device on new hardware AS the same logical
 * device from the server's perspective (per ADR-0001 + ADR-0006).
 */
function getDeviceIdPath(): string {
  return join(app.getPath('userData'), DEVICE_ID_FILENAME);
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

async function startEmbeddedServer(): Promise<PuntovivoServer> {
  // ENG-072 — Resolve the Authority Node runtime config from env
  // before booting. Defaults reproduce the historical hardcoded
  // `device_local + 127.0.0.1 + 8090` shape, so a fresh install
  // boots identically. Failures are fatal here; the resolver throws
  // a clear message that bubbles up through Electron's startup error
  // handling instead of silently sliding into defaults.
  const runtime: RuntimeConfig = resolveRuntimeConfig({ env: process.env });
  mainLog.info(
    {
      dbPath: DB_PATH,
      authorityMode: runtime.authorityMode,
      bindHost: runtime.bindHost,
      bindPort: runtime.bindPort,
    },
    'starting embedded server'
  );

  const nextServer = await createServer({
    dbPath: DB_PATH,
    port: runtime.bindPort,
    host: runtime.bindHost,
    verbose: isDev,
    migrationsFolder: MIGRATIONS_PATH,
    runtime,
  });

  await nextServer.listen();
  mainLog.info({ url: nextServer.getUrl() }, 'embedded server started');

  return nextServer;
}

async function stopEmbeddedServer(): Promise<void> {
  if (!server) {
    return;
  }

  mainLog.info('shutting down embedded server');
  await server.close();
  server = null;
  mainLog.info('embedded server stopped');
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

function getServerDatabase(): PuntovivoServer['db'] {
  if (!server) {
    throw new Error('The embedded server is not available');
  }

  return server.db;
}

function getSqliteClient() {
  return getServerDatabase() as PuntovivoServer['db'] & {
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
  return table === 'sync_outbox' && (column === 'payload' || column === 'last_error');
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

  if (table === 'sync_outbox') {
    const queueRow = mapped as Record<string, unknown>;
    // Renderer historically expected `payload` + `retryCount` (matching
    // the IndexedDB shadow shape). After the ENG-064b cutover the
    // server columns are `payload` + `attempts` directly, so we just
    // alias `attempts` over to `retryCount` for the renderer payload.
    const payload = queueRow.payload as Record<string, unknown> | undefined;
    const retryCount = queueRow.attempts as number | undefined;
    delete queueRow.attempts;
    delete queueRow.payloadVersion;

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

async function getDesktopSyncStatus(tenantId?: string): Promise<DesktopSyncStatusResult> {
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

/**
 * ENG-025 — guard that blocks single-record operations (`db:getById`,
 * `db:update`, `db:delete`) when the target row belongs to a tenant
 * other than the one held by `desktopSession`. Returns silently when
 * the row is reachable; throws `CROSS_TENANT_ACCESS` otherwise. For
 * tables that do not carry a `tenant_id` column directly (e.g.
 * `sale_items`) the check climbs through `sales.tenant_id` so the
 * scope still holds.
 *
 * Existing behaviour for non-existent rows: pass through (the
 * handler returns `undefined` / no-op) — we only block
 * cross-tenant access of existing rows, mirroring the tRPC layer's
 * "not found vs not authorized" silence to avoid leaking which IDs
 * exist in other tenants.
 */
async function assertRowBelongsToActiveTenant(
  table: AllowedDesktopTable,
  id: string
): Promise<void> {
  const activeTenantId = desktopSession.requireTenantId();
  const sqlite = getSqliteClient().$client;

  let rowTenantId: string | null;
  if (table === 'sale_items') {
    const joined = sqlite
      .prepare(
        `SELECT s.tenant_id AS tenant_id
         FROM sale_items si
         INNER JOIN sales s ON s.id = si.sale_id
         WHERE si.id = ? LIMIT 1`
      )
      .get(id) as { tenant_id?: string } | undefined;
    rowTenantId = joined?.tenant_id ?? null;
  } else if (DIRECT_TENANT_TABLES.has(table)) {
    const row = sqlite
      .prepare(`SELECT tenant_id FROM ${table} WHERE id = ? LIMIT 1`)
      .get(id) as { tenant_id?: string } | undefined;
    rowTenantId = row?.tenant_id ?? null;
  } else {
    // Catalog / global tables (none in ALLOWED_DESKTOP_TABLES today,
    // but defensive). No tenant column → access is always allowed.
    return;
  }

  if (rowTenantId === null) {
    // Row missing — let the actual handler return its usual "not
    // found" response instead of leaking existence cross-tenant.
    return;
  }

  if (rowTenantId !== activeTenantId) {
    throw new Error('CROSS_TENANT_ACCESS');
  }
}

function getSaleIdFromRecord(data: Record<string, unknown>): string | null {
  const value = data.saleId ?? data.sale_id;
  return typeof value === 'string' && value.length > 0 ? value : null;
}

async function assertSaleItemWriteBelongsToActiveTenant(
  data: Record<string, unknown>,
  options: { requireSaleId: boolean }
): Promise<void> {
  const saleId = getSaleIdFromRecord(data);
  if (!saleId) {
    if (options.requireSaleId) {
      throw new Error('SALE_ID_REQUIRED');
    }
    return;
  }

  const activeTenantId = desktopSession.requireTenantId();
  const row = getSqliteClient().$client
    .prepare('SELECT tenant_id FROM sales WHERE id = ? LIMIT 1')
    .get(saleId) as { tenant_id?: string } | undefined;

  if (!row?.tenant_id || row.tenant_id !== activeTenantId) {
    throw new Error('CROSS_TENANT_ACCESS');
  }
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
  const activeTenantId = desktopSession.requireTenantId();

  if (!getTableColumns(table).has(field)) {
    throw new Error(`Field "${fieldName}" is not allowed for table "${table}"`);
  }

  const sqlite = getSqliteClient().$client;
  const rows =
    table === 'sale_items'
      ? (sqlite
          .prepare(
            `SELECT si.*
             FROM sale_items si
             INNER JOIN sales s ON s.id = si.sale_id
             WHERE si.${field} = ? AND s.tenant_id = ?`
          )
          .all(value, activeTenantId) as Record<string, unknown>[])
      : DIRECT_TENANT_TABLES.has(table)
        ? (sqlite
            .prepare(`SELECT * FROM ${table} WHERE ${field} = ? AND tenant_id = ?`)
            .all(value, activeTenantId) as Record<string, unknown>[])
        : (sqlite
            .prepare(`SELECT * FROM ${table} WHERE ${field} = ?`)
            .all(value) as Record<string, unknown>[]);

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

async function handleDesktopGetPendingSyncItems(tenantId: string): Promise<unknown[]> {
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

async function handleDesktopTriggerSync(tenantId: string): Promise<DesktopSyncTriggerResult> {
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
    tray.setToolTip(t('tray.tooltip'));
    tray.on('click', () => {
      toggleMainWindowVisibility();
    });
  }

  const contextMenu = Menu.buildFromTemplate([
    {
      label: mainWindow?.isVisible() ? t('tray.hideWindow') : t('tray.openWindow'),
      click: () => {
        toggleMainWindowVisibility();
      },
    },
    { type: 'separator' },
    {
      label: settings.closeToTray ? t('tray.closeHidesToTray') : t('tray.closeQuitsApp'),
      enabled: false,
    },
    { type: 'separator' },
    {
      label: t('tray.quit'),
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
            reject(new Error(failureReason || t('print.receiptFailed')));
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
    title: t('app.windowTitle'),
    // ENG-004 — security-critical webPreferences are assembled in
    // window-config.ts so the exact BrowserWindow contract can be pinned
    // by a Node regression test without booting Electron.
    webPreferences: buildMainWindowWebPreferences(join(__dirname, '../preload/index.cjs')),
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
    mainLog.info({ source: WEB_DEV_SERVER_URL }, 'loading renderer from dev server');
    mainWindow.loadURL(WEB_DEV_SERVER_URL);
    if (shouldOpenDevTools) {
      mainWindow.webContents.openDevTools();
    }
  } else {
    // Production mode: load from packaged web app
    const webAppPath = join(process.resourcesPath, 'dist', 'index.html');
    mainLog.info({ source: webAppPath }, 'loading renderer from packaged bundle');
    mainWindow.loadFile(webAppPath);
  }

  // Forward renderer console logs to the structured stream in development
  // so renderer-side errors surface next to main-process logs under one
  // module=renderer filter.
  if (isDev) {
    mainWindow.webContents.on('console-message', details => {
      const method = RENDERER_LEVEL_MAP[details.level] ?? 'info';
      rendererLog[method](
        { sourceId: details.sourceId, lineNumber: details.lineNumber },
        details.message
      );
    });
  }
}

async function handleCreateDatabaseBackup(): Promise<DesktopDatabaseActionResult> {
  const saveDialogOptions: SaveDialogOptions = {
    title: t('backup.createDialogTitle'),
    defaultPath: join(app.getPath('documents'), createBackupZipFileName()),
    filters: [
      {
        name: t('backup.fileFilterName'),
        extensions: ['zip'],
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
    // ENG-066 — atomic backup via SQLite online backup API. The
    // server is stopped first so the backup bundle is consistent
    // with operator expectations even though `db.backup()` is safe
    // under concurrent writes.
    const result = await runWithServerRestart(async () => {
      await access(DB_PATH);
      await ensureParentDirectoryExists(filePath);
      const deviceIdPath = getDeviceIdPath();
      return createBackupBundle({
        dbPath: DB_PATH,
        deviceIdPath,
        outZipPath: filePath,
        manifest: { appVersion: app.getVersion() },
      });
    });

    backupLog.info(
      { zipPath: result.zipPath, zipBytes: result.zipBytes },
      'backup created'
    );

    return {
      success: true,
      cancelled: false,
      path: result.zipPath,
      sizeBytes: result.zipBytes,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : t('backup.createFailed');
    backupLog.error({ err: error }, 'failed to create backup');
    return {
      success: false,
      cancelled: false,
      error: message,
    };
  }
}

async function handleRestoreDatabaseBackup(): Promise<DesktopDatabaseActionResult> {
  const openDialogOptions: OpenDialogOptions = {
    title: t('backup.restoreDialogTitle'),
    properties: ['openFile'],
    filters: [
      {
        name: t('backup.fileFilterName'),
        // Accept legacy raw `.db` AND the new ZIP bundle.
        extensions: ['zip', 'db', 'sqlite', 'sqlite3'],
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

  // ENG-066 — VALIDATE the bundle BEFORE the swap. The integrity
  // check + format detection happens against an extracted staging
  // copy, so a corrupted file never touches the live DB.
  const stagingDir = await mkdtemp(join(tmpdir(), 'puntovivo-restore-'));
  try {
    await access(selectedBackupPath);

    const extracted = await extractBackupBundle(selectedBackupPath, stagingDir);
    await assertSqliteIntegrity(extracted.dbPath);

    await runWithServerRestart(
      async () => {
        await ensureParentDirectoryExists(DB_PATH);
        await removeSqliteSidecars(DB_PATH);
        await copyFile(extracted.dbPath, DB_PATH);
        await removeSqliteSidecars(DB_PATH);

        // ENG-066 — preserve the bundled device identity when present;
        // legacy raw `.db` restores keep the destination identity
        // since the bundle didn't carry one.
        if (extracted.deviceIdPath) {
          try {
            const deviceId = (await readFile(extracted.deviceIdPath, 'utf8')).trim();
            if (deviceId) {
              await writeDeviceIdToDir(app.getPath('userData'), deviceId);
            }
          } catch (err) {
            backupLog.warn(
              { err },
              'restore: failed to preserve device-id from bundle; keeping destination identity'
            );
          }
        }
      },
      { reloadWindow: true }
    );

    backupLog.info(
      { source: selectedBackupPath, format: extracted.format },
      'backup restored'
    );

    return {
      success: true,
      cancelled: false,
      path: selectedBackupPath,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : t('backup.restoreFailed');
    backupLog.error(
      { err: error, source: selectedBackupPath },
      'failed to restore backup'
    );
    return {
      success: false,
      cancelled: false,
      error: message,
    };
  } finally {
    await rm(stagingDir, { recursive: true, force: true });
  }
}


// Initialize the application
app.whenReady().then(async () => {
  // Initialize main-process locale from Electron's detected system locale.
  // The renderer will push updates via the 'update-main-locale' IPC channel
  // when the user changes the preference in settings.
  setMainLocale(normalizeMainLocale(app.getLocale()));
  refreshAutoUpdateTranslations();

  // Initialize auto-updater (configurable via env)
  initAutoUpdater();

  // Start embedded Fastify server
  try {
    server = await startEmbeddedServer();
    applyThemePreference(await getThemePreference());
    currentTraySettings = await getTraySettings();
  } catch (err) {
    mainLog.fatal({ err }, 'embedded server failed to start');
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
// The fallback string is only returned before the embedded server has
// started. ENG-072 — once the server is up, `getUrl()` returns the
// real bind address resolved from the Authority Node runtime config.
ipcMain.handle('get-server-url', () => server?.getUrl() || 'http://127.0.0.1:8090');
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
ipcMain.handle('update-main-locale', async (_event, locale: unknown): Promise<MainLocale> => {
  const next = normalizeMainLocale(typeof locale === 'string' ? locale : null);
  setMainLocale(next);
  refreshAutoUpdateTranslations();
  mainWindow?.setTitle(t('app.windowTitle'));
  refreshTray();
  return next;
});
// ENG-052b — persistent device id under the user's data folder. The
// renderer prefers this path over localStorage so a browser cache
// wipe does not lose the device registration; the localStorage copy
// stays as a fallback for the pure-browser build. The atomic
// read/write helpers live in `./device-id-store.ts` so they can be
// unit-tested without spinning up Electron.
ipcMain.handle('device:get-id', async (): Promise<string | null> => {
  try {
    return await readDeviceIdFromDir(app.getPath('userData'));
  } catch (error) {
    mainLog.warn(
      { err: error, dir: app.getPath('userData') },
      'device:get-id failed reading persisted device id'
    );
    return null;
  }
});

ipcMain.handle('device:set-id', async (_event, deviceId: unknown): Promise<void> => {
  if (typeof deviceId !== 'string') {
    throw new Error('DEVICE_SET_ID_REJECTED');
  }
  await writeDeviceIdToDir(app.getPath('userData'), deviceId);
});

// ENG-025 vector 1 — session lifecycle. `session:register` is called
// by the renderer's AuthProvider after a successful login (or after a
// successful refresh that rotated the access token); `session:clear`
// is called on logout. Until a session is registered, every db:* and
// sync:* handler below throws SESSION_NOT_REGISTERED so the renderer
// can never reach the SQLite store with a tenantId of its choosing.
ipcMain.handle('session:register', async (_event, accessToken: unknown) => {
  if (typeof accessToken !== 'string' || accessToken.length === 0) {
    throw new Error('SESSION_REGISTER_REJECTED');
  }
  if (!server) {
    throw new Error('Embedded server is not started yet');
  }
  const fastifyApp = server.app;
  await desktopSession.register(accessToken, token =>
    verifyTokenWithServer(fastifyApp, token, 'access')
  );
  return { ok: true };
});
ipcMain.handle('session:clear', async () => {
  desktopSession.clear();
  return { ok: true };
});

// ENG-025 vector 1 — every db:* / sync:* handler now derives tenantId
// from the registered desktopSession instead of trusting the
// renderer-supplied argument. The legacy renderer call sites still
// pass a tenantId for backward compatibility while the offlineStorage
// wrapper is migrated; we accept it but IGNORE it. Mismatches are
// logged at warn level so a stale renderer surfaces in the operator
// log instead of silently bypassing the scope.
function activeTenantId(rendererTenantIdHint?: unknown): string {
  const sessionTenantId = desktopSession.requireTenantId();
  if (
    typeof rendererTenantIdHint === 'string' &&
    rendererTenantIdHint.length > 0 &&
    rendererTenantIdHint !== sessionTenantId
  ) {
    mainLog.warn(
      { sessionTenantId, rendererTenantId: rendererTenantIdHint },
      'ENG-025: ignored renderer-supplied tenantId — desktopSession wins'
    );
  }
  return sessionTenantId;
}

ipcMain.handle('db:getAll', async (_event, table: string, rendererTenantId?: unknown) => {
  return handleDesktopGetAll(table, activeTenantId(rendererTenantId));
});
ipcMain.handle('db:getById', async (_event, table: string, id: string) => {
  const validatedTable = getAllowedDesktopTable(table);
  await assertRowBelongsToActiveTenant(validatedTable, id);
  return handleDesktopGetById(table, id);
});
ipcMain.handle('db:insert', async (_event, table: string, data: Record<string, unknown>) => {
  const validatedTable = getAllowedDesktopTable(table);
  if (validatedTable === 'sale_items') {
    await assertSaleItemWriteBelongsToActiveTenant(data, { requireSaleId: true });
  }
  // Force the tenant scope server-side. Even if the renderer passed a
  // different tenantId (or omitted it) the row lands in the active
  // tenant.
  const tenantScopedData = { ...data, tenantId: activeTenantId(data.tenantId) };
  return handleDesktopInsert(table, tenantScopedData);
});
ipcMain.handle(
  'db:update',
  async (_event, table: string, id: string, data: Record<string, unknown>) => {
    const validatedTable = getAllowedDesktopTable(table);
    await assertRowBelongsToActiveTenant(validatedTable, id);
    if (validatedTable === 'sale_items') {
      await assertSaleItemWriteBelongsToActiveTenant(data, { requireSaleId: false });
    }
    // Block tenant migration via update — same rationale as insert.
    const sessionTenantId = activeTenantId(data.tenantId);
    const tenantScopedData = { ...data, tenantId: sessionTenantId };
    return handleDesktopUpdate(table, id, tenantScopedData);
  }
);
ipcMain.handle('db:delete', async (_event, table: string, id: string) => {
  const validatedTable = getAllowedDesktopTable(table);
  await assertRowBelongsToActiveTenant(validatedTable, id);
  return handleDesktopDelete(table, id);
});
ipcMain.handle(
  'db:getByField',
  async (_event, table: string, fieldName: string, value: unknown) => {
    // Require a registered session even though this op does not take
    // a tenantId argument — without it, the renderer could query
    // arbitrary rows by indexed field across tenants.
    desktopSession.requireTenantId();
    return handleDesktopGetByField(table, fieldName, value);
  }
);
ipcMain.handle('db:deleteByTenant', async (_event, table: string, rendererTenantId?: unknown) => {
  return handleDesktopDeleteByTenant(table, activeTenantId(rendererTenantId));
});
ipcMain.handle('db:countByTenant', async (_event, table: string, rendererTenantId?: unknown) => {
  return handleDesktopCountByTenant(table, activeTenantId(rendererTenantId));
});
ipcMain.handle('db:addToSyncQueue', async (_event, item: DesktopSyncQueueInput) => {
  // Force the tenantId of the queued item to the active session,
  // ignoring whatever the renderer claimed.
  const sessionTenantId = activeTenantId(item?.tenantId);
  return handleDesktopAddToSyncQueue({ ...item, tenantId: sessionTenantId });
});
ipcMain.handle('db:getPendingSyncItems', async (_event, rendererTenantId?: unknown) => {
  return handleDesktopGetPendingSyncItems(activeTenantId(rendererTenantId));
});
ipcMain.handle('sync:getStatus', async (_event, rendererTenantId?: unknown) => {
  return getDesktopSyncStatus(activeTenantId(rendererTenantId));
});
ipcMain.handle('sync:triggerSync', async (_event, rendererTenantId?: unknown) => {
  return handleDesktopTriggerSync(activeTenantId(rendererTenantId));
});
ipcMain.handle('sync:setConfig', async (_event, config: Record<string, unknown>) => {
  // No tenant data crosses here, but a registered session is still
  // required so unauthenticated renderer code cannot reconfigure sync.
  desktopSession.requireTenantId();
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
    printLog.error({ err: error }, 'receipt printing failed');
    return {
      success: false,
      error: message,
    };
  }
});
