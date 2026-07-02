import {
  app,
  shell,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  nativeTheme,
  safeStorage,
  session,
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
import { getDbKeyDir, getOrCreateDbKey } from './db-key-store.js';
import { sanitisePrintHtml } from './print-html-sanitizer.js';
import {
  createBackupBundle,
  createBackupFileName as createBackupZipFileName,
  extractBackupBundle,
  assertSqliteIntegrity,
  // ENG-167b — cleartext detection + in-place rekey for the
  // cross-device restore completion path.
  isCleartextSqliteFile,
  rekeySqliteDatabase,
  sweepStaleBackupStaging,
  type ExtractBackupBundleResult,
} from './backup/backup-bundle.js';
// ENG-167b — one-shot first-boot encryption of pre-Step-1 databases.
import { migrateCleartextDatabase } from './db-migrate-encryption.js';
import {
  createServer,
  createModuleLogger,
  resolveRuntimeConfig,
  type PuntovivoServer,
  type RuntimeConfig,
  appSettings,
  // Drizzle operators re-exported by the server package: they must come
  // from the same drizzle-orm instance that typed the schema tables above
  // (a direct 'drizzle-orm' import here is a phantom dependency that can
  // resolve to a different module identity and break the typecheck).
  eq,
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
import {
  checkForAppUpdates,
  getAutoUpdateStatus,
  initAutoUpdater,
  refreshAutoUpdateTranslations,
  restartToApplyAppUpdate,
  stopAutoUpdater,
} from './auto-updater';
import { t, setMainLocale, normalizeMainLocale, type MainLocale } from './i18n';
import { buildMainWindowWebPreferences } from './window-config.js';
import {
  buildRendererSecurityHeaders,
  isFastifyApiResponse,
} from './renderer-security-headers.js';
import { isAllowedExternalUrl } from './external-url-policy.js';
// ENG-025 — single source of truth for the authenticated identity at
// the IPC boundary. Every db:* / sync:* handler reads tenantId from
// here instead of trusting the renderer-supplied argument. The
// `SESSION_NOT_REGISTERED` and `SESSION_REGISTER_REJECTED` error
// strings are the stable contract the renderer matches against to
// decide whether to redirect to the login screen.
import * as desktopSession from './session/desktopSession.js';
import { verifyTokenWithServer } from '@puntovivo/server';
// ENG-135b — process crash path: captureProcessCrash forwards a
// tenant-less, redacted crash event to the telemetry sink (live only
// when the operator provisioned PUNTOVIVO_SENTRY_DSN);
// flushServerTelemetry drains the SDK buffer before the exit.
import {
  captureProcessCrash,
  flushServerTelemetry,
} from '@puntovivo/server';
import { installProcessCrashHandlers } from './crash-telemetry.js';
// ENG-178 — the embedded-server handle + DB accessors live in the
// Electron-free runtime hub so the extracted ipc/* concern modules can
// reach the database without importing electron.
import {
  getServer,
  setServer,
  getServerDatabase,
  getServerUrl,
} from './runtime.js';
// ENG-178 — desktop database-bridge handlers extracted to ipc/db.ts.
import {
  assertRowBelongsToActiveTenant,
  assertSaleItemWriteBelongsToActiveTenant,
  getAllowedDesktopTable,
  handleDesktopCountByTenant,
  handleDesktopDelete,
  handleDesktopDeleteByTenant,
  handleDesktopGetAll,
  handleDesktopGetById,
  handleDesktopGetByField,
  handleDesktopInsert,
  handleDesktopUpdate,
} from './ipc/db.js';
// ENG-178 — desktop sync-bridge handlers extracted to ipc/sync.ts.
import {
  assertDesktopSyncOperation,
  getDesktopSyncStatus,
  handleDesktopAddToSyncQueue,
  handleDesktopGetPendingSyncItems,
  handleDesktopSetSyncConfig,
  handleDesktopTriggerSync,
  type DesktopSyncQueueInput,
} from './ipc/sync.js';

// Handle creating/removing shortcuts on Windows when installing/uninstalling.
if (require('electron-squirrel-startup')) {
  app.quit();
}

// ENG-135b — install the crash handlers before ANY async boot work
// (embedded server boot, window creation, IPC registration) so a
// failure in those paths lands a structured log + telemetry event
// instead of dying with Electron's default dialog. uncaughtException
// keeps fail-fast semantics (exit 1 after a bounded flush);
// unhandledRejection logs + captures without exiting.
installProcessCrashHandlers({
  log: mainLog,
  captureCrash: captureProcessCrash,
  flushTelemetry: flushServerTelemetry,
  exit: (code) => app.exit(code),
  proc: process,
});

// Pin the app name BEFORE the first `app.getPath('userData')` read (DB_PATH
// below). Packaged builds inherit the name from the macOS Info.plist /
// Windows metadata `productName` ("Puntovivo", set in forge.config.ts), but
// `electron-forge start` (dev) ships no such metadata, so `app.getName()`
// falls back to the binary default "Electron" and userData resolves to
// ~/Library/Application Support/Electron. Forcing the name keeps dev and
// packaged on the SAME userData path (.../Puntovivo/), so the encrypted
// SQLite DB, key envelope, device id, and license all live in one place
// regardless of how the app was launched. In a packaged build this is a
// no-op (the name already equals "Puntovivo").
app.setName('Puntovivo');

// Web app dev server URL (from apps/web)
const WEB_DEV_SERVER_URL = process.env.WEB_DEV_SERVER_URL || 'http://localhost:3000';
// Check if we're in development mode - electron-forge start sets app.isPackaged = false
const isDev = !app.isPackaged;
// ENG-166 — devtools must NEVER auto-open in a packaged build, even if the
// env var leaks (e.g. an accidental release with developer shell vars in
// the environment). Gating on `!app.isPackaged` short-circuits before the
// env-var check so a staged install cannot expose the DevTools surface.
const shouldOpenDevTools =
  !app.isPackaged && process.env.PUNTOVIVO_OPEN_DEVTOOLS === 'true';
process.env.PUNTOVIVO_RUNTIME_ENV ??= isDev ? 'development' : 'production';

mainLog.info({ isPackaged: app.isPackaged, isDev }, 'electron runtime detected');

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let databaseEncryptionKey: string | null = null;
let isQuitting = false;
// DK-005 — guards the deferred-shutdown handshake in the `will-quit`
// handler so the embedded server's async close runs to completion
// before the process exits, without looping the defer on the re-fired
// `will-quit` after `app.quit()` is called again.
let serverShutdownComplete = false;
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
// Dev-only shared DB (operator request): when running unpackaged
// (`electron-forge start`), honour DATABASE_URL so the embedded server and the
// standalone web server (`pnpm dev:web-stack`) read/write ONE local SQLite
// file — data created in the web stack shows up in the desktop app and vice
// versa. The dev-launcher injects DATABASE_URL + PUNTOVIVO_DB_KEY for the
// integrated dev modes. NEVER honoured in a packaged build: production always
// uses the encrypted DB under userData.
const DEV_SHARED_DB_PATH =
  !app.isPackaged && process.env.DATABASE_URL ? process.env.DATABASE_URL : undefined;
const DB_PATH = DEV_SHARED_DB_PATH ?? join(app.getPath('userData'), 'data', 'local.db');
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
  /**
   * ENG-167b — the selected bundle is encrypted with a DIFFERENT
   * device's key. The staging copy is held server-side under `token`;
   * the renderer prompts the operator for the source device's backup
   * key and completes the restore via `provideRestoreKey(token, key)`.
   */
  needsKey?: boolean;
  token?: string;
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




const RECEIPT_PRINT_SETTINGS_KEY = 'receipt_print_settings';
// DK-006 — upper bound on how long we wait for `webContents.print`'s
// completion callback. The native print path can hang indefinitely if
// the OS print dialog/spooler never returns a result (stuck driver,
// dismissed dialog on some platforms); without a ceiling the print
// promise would never settle and the ephemeral print window would leak.
// On timeout we reject (reusing the same user-visible failure copy) so
// the `finally` always runs and the window is closed.
const RECEIPT_PRINT_TIMEOUT_MS = 60_000;
const THEME_PREFERENCE_KEY = 'theme_preference';
const TRAY_SETTINGS_KEY = 'tray_settings';
const DEFAULT_RECEIPT_PRINT_SETTINGS: ReceiptPrintSettings = {
  silent: false,
  printBackground: true,
};
const DEFAULT_THEME_PREFERENCE: ThemePreference = 'system';
const DEFAULT_TRAY_SETTINGS: TraySettings = {
  enabled: true,
  closeToTray: false,
};

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

  // ENG-167 — resolve the SQLCipher key BEFORE `createServer` so the
  // very first PRAGMA inside `initDatabase` can use it. Fresh installs
  // mint a new 256-bit key sealed by `safeStorage`; subsequent boots
  // recover the same key from the envelope file next to `local.db`.
  // A keychain failure (e.g. revoked Keychain access on macOS, missing
  // libsecret on Linux) throws here and aborts the boot instead of
  // sliding into a cleartext fallback.
  const encryptionKey = await resolveDatabaseEncryptionKey();

  // ENG-167b — one-shot migration of a pre-encryption cleartext
  // database. Runs between key resolution and createServer so the
  // server only ever opens an encrypted file. The dev-shared
  // DATABASE_URL database is excluded: it is already encrypted with
  // the fixed dev key the launcher injects. A migration failure
  // throws (after restoring the cleartext copy) and aborts the boot.
  await migrateCleartextDatabase({
    dbPath: DB_PATH,
    encryptionKey,
    skipReason: DEV_SHARED_DB_PATH
      ? 'dev-shared DATABASE_URL database (already encrypted with the dev key)'
      : undefined,
    log: mainLog,
  });

  mainLog.info(
    {
      dbPath: DB_PATH,
      authorityMode: runtime.authorityMode,
      bindHost: runtime.bindHost,
      bindPort: runtime.bindPort,
      encryptionEnabled: true,
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
    // ENG-073 — surface the installed Electron app version on
    // /api/health so the Operations Center Authority tab (ENG-075)
    // can render it without a separate IPC round-trip.
    appVersion: app.getVersion(),
    encryptionKey,
  });

  await nextServer.listen();
  mainLog.info({ url: nextServer.getUrl() }, 'embedded server started');

  return nextServer;
}

async function resolveDatabaseEncryptionKey(): Promise<string> {
  if (databaseEncryptionKey) {
    return databaseEncryptionKey;
  }
  const devKey = resolveDevDatabaseEncryptionKey();
  databaseEncryptionKey =
    devKey ?? (await getOrCreateDbKey(getDbKeyDir(DB_PATH), safeStorage));
  return databaseEncryptionKey;
}

// In a packaged build the key ALWAYS comes from the safeStorage envelope; an
// env-provided key is ignored so a leaked shell var can never weaken or unlock
// production data. In dev (`electron-forge start`) PUNTOVIVO_DB_KEY is honoured
// in two situations:
//   - Electron E2E (PUNTOVIVO_E2E=1): deterministic key for the throwaway test DB.
//   - Shared dev DB (DATABASE_URL injected by the dev-launcher): the desktop and
//     the standalone web server open the SAME encrypted file with one fixed key,
//     so work in `pnpm dev:web-stack` and `pnpm dev:desktop` shares data.
function resolveDevDatabaseEncryptionKey(): string | undefined {
  if (app.isPackaged) {
    return undefined;
  }
  const isE2e = process.env.PUNTOVIVO_E2E === '1';
  if (!isE2e && !DEV_SHARED_DB_PATH) {
    return undefined;
  }
  const key = process.env.PUNTOVIVO_DB_KEY;
  if (key === undefined) {
    if (DEV_SHARED_DB_PATH) {
      throw new Error(
        'Shared dev DB (DATABASE_URL) requires PUNTOVIVO_DB_KEY (64-character hex). ' +
          'pnpm dev:desktop injects both via the dev-launcher; set them together when ' +
          'launching electron-forge directly.'
      );
    }
    return undefined;
  }
  if (!/^[0-9a-f]{64}$/i.test(key)) {
    throw new Error('PUNTOVIVO_DB_KEY must be a 64-character hex string in Electron dev');
  }
  return key;
}

async function stopEmbeddedServer(): Promise<void> {
  const current = getServer();
  if (!current) {
    return;
  }

  mainLog.info('shutting down embedded server');
  await current.close();
  setServer(null);
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
    setServer(await startEmbeddedServer());

    if (options?.reloadWindow && mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.reload();
    }
  }
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
      .where(eq(appSettings.key, THEME_PREFERENCE_KEY))
      .run();
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

  // DK-007 — detach the 'click' handler before destroying the native
  // tray. A fresh Tray is created on every re-enable (and we attach a
  // new 'click' listener there), so explicitly clearing listeners on
  // the outgoing instance keeps the handler count from accumulating and
  // releases the closure for GC even if a reference to the old Tray
  // briefly survives.
  tray.removeAllListeners('click');
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
      .where(eq(appSettings.key, TRAY_SETTINGS_KEY))
      .run();
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

    // DK-006 — race the print callback against a hard timeout so a
    // native print path that never invokes its callback cannot pin the
    // promise open (which would skip the `finally` and leak the window).
    let timeoutHandle: NodeJS.Timeout | undefined;
    const printDone = new Promise<void>((resolve, reject) => {
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
    const printTimeout = new Promise<never>((_resolve, reject) => {
      timeoutHandle = setTimeout(() => {
        reject(new Error(t('print.receiptFailed')));
      }, RECEIPT_PRINT_TIMEOUT_MS);
    });

    try {
      await Promise.race([printDone, printTimeout]);
    } finally {
      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
      }
    }
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
    if (!isAllowedExternalUrl(details.url)) {
      mainLog.warn({ url: details.url }, 'blocked unsupported external URL');
      return { action: 'deny' };
    }
    void shell.openExternal(details.url);
    return { action: 'deny' };
  });

  // `setWindowOpenHandler` only covers window.open(); a top-frame
  // navigation (location.href = ..., a dragged link, a javascript:/data:
  // URL) bypasses it entirely. The SPA navigates via the history API
  // (which never fires will-navigate), so the only legitimate top-frame
  // navigations are reloads of the app itself: the dev-server origin in
  // dev, or the packaged dist bundle under file:. Everything else is
  // cancelled; https targets are handed to the system browser through
  // the same external-URL policy as window.open.
  const isInAppNavigation = (target: string): boolean => {
    try {
      const url = new URL(target);
      if (isDev) {
        return url.origin === new URL(WEB_DEV_SERVER_URL).origin;
      }
      if (url.protocol !== 'file:') {
        return false;
      }
      const packagedDist = join(process.resourcesPath, 'dist');
      return decodeURIComponent(url.pathname).startsWith(packagedDist);
    } catch {
      return false;
    }
  };
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (isInAppNavigation(url)) {
      return;
    }
    event.preventDefault();
    if (isAllowedExternalUrl(url)) {
      void shell.openExternal(url);
      return;
    }
    mainLog.warn({ url }, 'blocked unsupported renderer navigation');
  });

  // ENG-133b — memory-measurement mode. When launched with
  // PUNTOVIVO_MEASURE_MEMORY=1 (the `scripts/check-electron-memory.mjs`
  // perf gate), wait for the renderer to finish loading + a short settle
  // window, capture each Electron process' working-set via
  // `app.getAppMetrics()`, print ONE machine-parseable line to stdout, then
  // quit. Flag-gated, so dev / packaged runs are completely unaffected.
  //
  // Register before loadURL/loadFile: a warm Vite dev server or packaged file
  // load can finish immediately, and missing this event would leave the
  // measurement launcher waiting until its hard timeout.
  if (process.env.PUNTOVIVO_MEASURE_MEMORY === '1') {
    const measuredWebContents = mainWindow.webContents;
    measuredWebContents.once('did-finish-load', () => {
      // Let the renderer settle, then VERIFY the real app actually mounted
      // before snapshotting memory. `did-finish-load` also fires on the
      // Chromium error page shown when the dev:web server is down, and
      // measuring that blank renderer would report a misleading PASS against
      // the app-calibrated budget. Checking that #root has children is a
      // deterministic "the React app mounted" signal (the error page has no
      // populated #root). If it did not mount, emit a SKIP marker so the perf
      // gate self-skips warn-first. Run with dev:web up — see PERF-BUDGETS.md.
      setTimeout(() => {
        const shutdown = () =>
          void stopEmbeddedServer()
            .catch(err => {
              mainLog.warn({ err }, 'failed to stop embedded server after memory measurement');
            })
            .finally(() => {
              app.exit(0);
            });

        void measuredWebContents
          .executeJavaScript(
            'Boolean(document.getElementById("root") && document.getElementById("root").childElementCount > 0)'
          )
          .catch(() => false)
          .then(appMounted => {
            if (!appMounted) {
              process.stdout.write('PUNTOVIVO_MEMORY_SKIP=app-not-mounted\n');
              shutdown();
              return;
            }

            const metrics = app.getAppMetrics().map(metric => ({
              type: metric.type,
              workingSetKb: metric.memory.workingSetSize,
            }));
            process.stdout.write(
              `PUNTOVIVO_MEMORY_METRICS=${JSON.stringify(metrics)}\n`
            );
            shutdown();
          });
      }, 2000);
    });
  }

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
  desktopSession.requireOneOfRoles(['admin']);
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
      const encryptionKey = await resolveDatabaseEncryptionKey();
      return createBackupBundle({
        dbPath: DB_PATH,
        deviceIdPath,
        outZipPath: filePath,
        encryptionKey,
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
  desktopSession.requireOneOfRoles(['admin']);
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
  let keepStaging = false;
  try {
    await access(selectedBackupPath);

    const extracted = await extractBackupBundle(selectedBackupPath, stagingDir);
    const encryptionKey = await resolveDatabaseEncryptionKey();

    try {
      await assertSqliteIntegrity(extracted.dbPath, { encryptionKey });
    } catch (localKeyError) {
      // ENG-167b — the staged DB does not open with THIS device's
      // key. Two legitimate shapes before giving up:
      //   1. A legacy pre-encryption bundle (cleartext): verify it
      //      keyless and restore as-is — the one-shot migration on
      //      the next boot encrypts it under the local key.
      //   2. A bundle from a DIFFERENT device: hold the staging copy
      //      and ask the renderer to prompt for the source device's
      //      backup key (completed via provideRestoreKey).
      if (await isCleartextSqliteFile(extracted.dbPath)) {
        await assertSqliteIntegrity(extracted.dbPath, {});
        backupLog.info(
          { source: selectedBackupPath },
          'restore: legacy cleartext bundle accepted; next boot will encrypt it'
        );
      } else {
        keepStaging = true;
        const token = await stashPendingRestore(stagingDir, extracted, selectedBackupPath);
        backupLog.info(
          { source: selectedBackupPath },
          'restore: bundle is encrypted with a foreign key; prompting for it'
        );
        return {
          success: false,
          cancelled: false,
          needsKey: true,
          token,
        };
      }
      void localKeyError;
    }

    await swapRestoredDatabase(extracted);

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
    if (!keepStaging) {
      await rm(stagingDir, { recursive: true, force: true });
    }
  }
}

/**
 * ENG-066/167b — promote a validated staging DB into the live
 * location under a server restart, preserving the bundled device
 * identity when present. Shared by the direct restore path and the
 * foreign-key completion path (provideRestoreKey).
 */
async function swapRestoredDatabase(
  extracted: ExtractBackupBundleResult
): Promise<void> {
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
}

/**
 * ENG-167b — single pending cross-device restore slot. Holding ONE
 * staging at a time is deliberate: the restore flow is operator-
 * driven and modal; a new restore invocation discards any previous
 * pending staging. The token is an opaque random id the renderer
 * must echo back so a stale/duplicated prompt cannot complete
 * someone else's staging.
 */
interface PendingRestore {
  token: string;
  stagingDir: string;
  extracted: ExtractBackupBundleResult;
  sourcePath: string;
}

let pendingRestore: PendingRestore | null = null;

async function stashPendingRestore(
  stagingDir: string,
  extracted: ExtractBackupBundleResult,
  sourcePath: string
): Promise<string> {
  await clearPendingRestore();
  const token = randomUUID();
  pendingRestore = { token, stagingDir, extracted, sourcePath };
  return token;
}

async function clearPendingRestore(): Promise<void> {
  if (!pendingRestore) return;
  const stale = pendingRestore;
  pendingRestore = null;
  await rm(stale.stagingDir, { recursive: true, force: true });
}

/**
 * ENG-167b — complete a cross-device restore with the SOURCE
 * device's backup key. Validates the staged DB with the foreign key,
 * rekeys it IN STAGING to this device's key (every install keeps
 * exactly one key envelope — the threat model does not change), and
 * promotes it through the same swap path as a direct restore.
 *
 * A wrong key returns a retryable error WITHOUT discarding the
 * staging; an invalid token or key shape discards nothing either —
 * only a successful completion (or a new restore invocation) clears
 * the slot.
 */
async function handleProvideRestoreKey(
  _event: Electron.IpcMainInvokeEvent,
  token: unknown,
  keyHex: unknown
): Promise<DesktopDatabaseActionResult> {
  desktopSession.requireOneOfRoles(['admin']);

  // Snapshot the slot ONCE so every later read (shape-error token,
  // integrity check, finally guard) sees the same pending restore
  // even if the module slot is concurrently replaced.
  const pending = pendingRestore;
  if (!pending || typeof token !== 'string' || token !== pending.token) {
    return {
      success: false,
      cancelled: false,
      error: t('backup.restoreKeyNoPending'),
    };
  }
  if (typeof keyHex !== 'string' || !/^[0-9a-f]{64}$/i.test(keyHex.trim())) {
    return {
      success: false,
      cancelled: false,
      needsKey: true,
      token: pending.token,
      error: t('backup.restoreKeyInvalidShape'),
    };
  }

  const foreignKey = keyHex.trim().toLowerCase();
  let keepPending = false;
  try {
    try {
      await assertSqliteIntegrity(pending.extracted.dbPath, {
        encryptionKey: foreignKey,
      });
    } catch {
      // Wrong key for this bundle — keep the staging, let the
      // operator retry with a corrected key.
      keepPending = true;
      return {
        success: false,
        cancelled: false,
        needsKey: true,
        token: pending.token,
        error: t('backup.restoreKeyMismatch'),
      };
    }

    const localKey = await resolveDatabaseEncryptionKey();
    rekeySqliteDatabase(pending.extracted.dbPath, {
      fromKey: foreignKey,
      toKey: localKey,
    });
    await assertSqliteIntegrity(pending.extracted.dbPath, {
      encryptionKey: localKey,
    });

    await swapRestoredDatabase(pending.extracted);
    backupLog.info(
      { source: pending.sourcePath },
      'cross-device backup restored and rekeyed to the local key'
    );
    return {
      success: true,
      cancelled: false,
      path: pending.sourcePath,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : t('backup.restoreFailed');
    backupLog.error(
      { err: error, source: pending.sourcePath },
      'failed to complete cross-device restore'
    );
    return { success: false, cancelled: false, error: message };
  } finally {
    // Success or hard failure drops the staging; the wrong-key retry
    // path (keepPending) and the pre-try bad-shape return keep it.
    if (!keepPending && pendingRestore === pending) {
      await clearPendingRestore();
    }
  }
}

/**
 * ENG-167b — discard the pending cross-device restore staging the
 * moment the operator dismisses the key prompt, instead of leaving
 * the staged copy in the tmpdir until the next restore attempt, the
 * app quit, or the startup sweep collects it. Admin-gated BEFORE the
 * token is even looked at (same hardening order as the sibling
 * handlers); a stale or foreign token is a silent no-op so a
 * duplicated prompt cannot discard a newer staging.
 */
async function handleCancelRestoreStaging(
  _event: Electron.IpcMainInvokeEvent,
  token: unknown
): Promise<{ success: boolean }> {
  desktopSession.requireOneOfRoles(['admin']);
  const pending = pendingRestore;
  if (!pending || typeof token !== 'string' || token !== pending.token) {
    return { success: false };
  }
  await clearPendingRestore();
  backupLog.info(
    { source: pending.sourcePath },
    'pending cross-device restore discarded by the operator'
  );
  return { success: true };
}

/**
 * ENG-167b — reveal this install's backup encryption key so the
 * operator can restore its bundles on ANOTHER device. Admin-only;
 * the renderer gates the reveal behind an explicit confirmation with
 * a strong warning (docs/SECURITY.md documents the trade-off: the
 * key is the at-rest secret — whoever holds it can read the
 * backups). The key never leaves the machine through any other
 * channel.
 */
async function handleGetBackupEncryptionKey(): Promise<{
  success: boolean;
  key?: string;
  error?: string;
}> {
  desktopSession.requireOneOfRoles(['admin']);
  try {
    const key = await resolveDatabaseEncryptionKey();
    backupLog.info({}, 'backup encryption key revealed to admin');
    return { success: true, key };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}


// Initialize the application
// Deny-by-default popup/navigation policy for EVERY webContents, current
// and future (print windows, devtools-spawned views, anything a dependency
// opens). The mainWindow handlers below re-state the same policy with the
// in-app-navigation carve-out; this hook is the belt-and-suspenders floor
// so an ephemeral window can never be navigated off the app even if its
// creator forgot to attach handlers.
app.on('web-contents-created', (_event, contents) => {
  contents.setWindowOpenHandler(({ url }) => {
    if (isAllowedExternalUrl(url)) {
      void shell.openExternal(url);
    } else {
      mainLog.warn({ url }, 'blocked window.open from webContents');
    }
    return { action: 'deny' };
  });
  contents.on('will-attach-webview', event => {
    event.preventDefault();
  });
  contents.on('will-navigate', (event, url) => {
    // mainWindow carries its own will-navigate policy with the in-app
    // reload carve-out; every other webContents (print window, etc.)
    // loads exactly one document and must never navigate again.
    if (mainWindow && contents === mainWindow.webContents) {
      return;
    }
    event.preventDefault();
    mainLog.warn({ url }, 'blocked navigation in auxiliary webContents');
  });
});

app.whenReady().then(async () => {
  // Initialize main-process locale from Electron's detected system locale.
  // The renderer will push updates via the 'update-main-locale' IPC channel
  // when the user changes the preference in settings.
  setMainLocale(normalizeMainLocale(app.getLocale()));
  refreshAutoUpdateTranslations();

  // ENG-166 — apply a baseline CSP to every renderer-loaded response.
  // The embedded Fastify already emits its own CSP via @fastify/helmet
  // for /api/* requests; this hook only kicks in for renderer-served
  // pages (file:// in production, http://localhost:3000 in dev), which
  // bypass the Fastify pipeline. The directives mirror helmet's server
  // policy so a hosted-staticfile deployment carries the same posture.
  const isPackagedBuild = app.isPackaged;
  const rendererSecurityRuntime = resolveRuntimeConfig({ env: process.env });
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    const url = details.url ?? '';
    // /api/* responses already carry helmet's CSP — do not double-apply
    // (Electron concatenates duplicate headers with commas, which makes
    // every directive list invalid).
    if (isFastifyApiResponse(url, rendererSecurityRuntime)) {
      // ENG-179b — Electron's `HeadersReceivedResponse.responseHeaders`
      // is `Record<string, string[]>` (no `| undefined`); when
      // `details.responseHeaders` is undefined we must omit the field
      // rather than pass `undefined` explicitly.
      callback(
        details.responseHeaders === undefined
          ? {}
          : { responseHeaders: details.responseHeaders }
      );
      return;
    }
    const responseHeaders = {
      ...(details.responseHeaders ?? {}),
      ...buildRendererSecurityHeaders({
        isPackagedBuild,
        runtime: rendererSecurityRuntime,
        webDevServerUrl: WEB_DEV_SERVER_URL,
        // ENG-135b — let a telemetry-enabled renderer POST envelopes
        // to the DSN origin; unset keeps the strict baseline CSP.
        sentryDsn: process.env.PUNTOVIVO_SENTRY_DSN,
      }),
    };
    callback({ responseHeaders });
  });

  // Initialize auto-updater (configurable via env)
  initAutoUpdater();

  // ENG-167b — best-effort sweep of staging dirs orphaned in the OS
  // tmpdir by a crash or by quitting while a cross-device restore
  // was waiting for its key. Fire-and-forget: boot never waits on
  // tmp hygiene, and the age guard inside the helper protects any
  // concurrently running instance's live staging.
  void sweepStaleBackupStaging()
    .then(removed => {
      if (removed.length > 0) {
        backupLog.info({ removed }, 'swept stale backup/restore staging directories');
      }
    })
    .catch(err => {
      backupLog.warn({ err }, 'failed to sweep stale backup staging directories');
    });

  // Start embedded Fastify server
  try {
    setServer(await startEmbeddedServer());
    applyThemePreference(await getThemePreference());
    currentTraySettings = await getTraySettings();
  } catch (err) {
    // DK-004 — the embedded Fastify server runs in-process and backs
    // every IPC handler (getServerDatabase() throws when it is absent).
    // Continuing into the renderer after a boot failure produced a
    // window where every tRPC/IPC call crashed. Fail loud instead:
    // surface the underlying error in a blocking native dialog (works
    // before any window exists) and quit. The resolver/createServer
    // throw descriptive messages (bad runtime config, keychain failure,
    // migration error), so the dialog body is actionable.
    mainLog.fatal({ err }, 'embedded server failed to start');
    const detail = err instanceof Error ? err.message : String(err);
    dialog.showErrorBox(t('app.name'), detail);
    isQuitting = true;
    app.quit();
    return;
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

app.on('will-quit', event => {
  destroyTray();
  // Stop the notify-only update poll so its timer never outlives the app.
  stopAutoUpdater();

  // DK-005 — `will-quit` listeners are synchronous, so a fire-and-forget
  // `stopEmbeddedServer()` let the process exit while the SQLite/WAL
  // handle and the bound port were still closing. Defer the quit
  // (`event.preventDefault()`), await the async close, then re-trigger
  // the quit. `serverShutdownComplete` makes the re-fired `will-quit`
  // fall through so we do not loop.
  if (serverShutdownComplete) {
    return;
  }

  event.preventDefault();
  void stopEmbeddedServer()
    .catch(err => {
      mainLog.error({ err }, 'failed to stop embedded server during shutdown');
    })
    // ENG-167b — a quit while a cross-device restore is waiting for
    // its key would otherwise orphan the staging dir in the tmpdir
    // (the pending slot deliberately survives between needsKey and
    // provideRestoreKey). Discard it inside the deferred-quit window
    // so the rm completes before the process exits.
    .then(() => clearPendingRestore())
    .catch(err => {
      backupLog.warn({ err }, 'failed to discard pending restore staging during shutdown');
    })
    .finally(() => {
      serverShutdownComplete = true;
      app.quit();
    });
});

// IPC Handlers
ipcMain.handle('get-app-version', () => app.getVersion());
ipcMain.handle('get-app-path', () => app.getPath('userData'));

// ENG-074 — Runtime config IPC for the renderer. Resolves once per
// boot (env vars do not change after Electron starts), so the
// handler is cheap. The renderer reads this synchronously at module
// init via `ipcRenderer.sendSync('runtime:get-config')` exposed
// through the preload bridge — synchronous IPC is the only way to
// make the tRPC base URL deterministic at module init without a
// chicken-and-egg between auth init and tRPC client construction.
const cachedRendererRuntimeConfig = (() => {
  const runtime = resolveRuntimeConfig({ env: process.env });
  return {
    authorityMode: runtime.authorityMode,
    hubUrl: runtime.hubUrl,
    siteId: runtime.siteId,
    deviceId: runtime.deviceId,
  };
})();
ipcMain.on('runtime:get-config', event => {
  event.returnValue = cachedRendererRuntimeConfig;
});

// ENG-074b — Hub-client local hardware bridge IPC. The renderer in
// hub_client mode fetches ESC/POS bytes from the hub via
// `peripherals.buildReceiptBytes` / `buildDrawerKickBytes` and
// pipes them through this handler. The dispatcher reuses the
// server's `resolveTransport` helper but never opens a DB
// connection — see local-bridge.ts for the ADR-0008 rule 6
// invariant.
ipcMain.handle('peripherals:dispatch-local-escpos', async (_event, payload) => {
  // Same renderer-as-attacker posture as the db:*/sync:* handlers: the
  // bridge is a hardware actuator, so it must not be reachable before a
  // verified login registers a session (ENG-025 vector 1). The bridge
  // contract is "never throw across IPC", so the rejection is returned
  // as a failure result the existing onEscposFallback toast can surface.
  try {
    desktopSession.requireTenantId();
  } catch {
    return {
      success: false,
      error: 'No registered desktop session',
      errorCode: 'SESSION_NOT_REGISTERED',
    };
  }
  if (
    typeof payload !== 'object' ||
    payload === null ||
    !('bytes' in payload) ||
    !('transport' in payload)
  ) {
    return {
      success: false,
      error: 'Malformed local ESC/POS dispatch payload',
      errorCode: 'INVALID_PAYLOAD',
    };
  }
  const { dispatchLocalEscpos } = await import('./peripherals/local-bridge.js');
  return dispatchLocalEscpos(payload as import('./peripherals/local-bridge.js').LocalEscPosDispatchInput);
});
// The fallback string is only returned before the embedded server has
// started. ENG-072 — once the server is up, `getUrl()` returns the
// real bind address resolved from the Authority Node runtime config.
ipcMain.handle('get-server-url', () => getServerUrl());
ipcMain.handle('get-auto-update-status', () => getAutoUpdateStatus());
ipcMain.handle('check-for-app-updates', () => checkForAppUpdates());
ipcMain.handle('restart-to-apply-app-update', () => restartToApplyAppUpdate());
ipcMain.handle('create-database-backup', handleCreateDatabaseBackup);
ipcMain.handle('restore-database-backup', handleRestoreDatabaseBackup);
// ENG-167b — cross-device restore completion + admin key reveal.
ipcMain.handle('provide-restore-key', handleProvideRestoreKey);
ipcMain.handle('cancel-restore-staging', handleCancelRestoreStaging);
ipcMain.handle('get-backup-encryption-key', handleGetBackupEncryptionKey);
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
  // The device id is server-issued during login, which registers the
  // desktop session first (AuthProvider order) — so a pre-login renderer
  // has no business persisting an id. The renderer treats a rejection as
  // non-fatal (localStorage stays authoritative).
  desktopSession.requireTenantId();
  if (typeof deviceId !== 'string' || deviceId.length === 0 || deviceId.length > 256) {
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
  const activeServer = getServer();
  if (!activeServer) {
    throw new Error('Embedded server is not started yet');
  }
  const fastifyApp = activeServer.app;
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
  // SEC-003 — validate the renderer-supplied operation against the
  // allowlist before it reaches the DB; an unrecognised value throws.
  const operation = assertDesktopSyncOperation(item?.operation);
  // Force the tenantId of the queued item to the active session,
  // ignoring whatever the renderer claimed.
  const sessionTenantId = activeTenantId(item?.tenantId);
  return handleDesktopAddToSyncQueue({ ...item, operation, tenantId: sessionTenantId });
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

  // ENG-166 — strip every active HTML construct (scripts, iframes,
  // event-handler attributes, non-data: image srcs) at the IPC trust
  // boundary BEFORE the HTML is loaded into the ephemeral print window.
  // The print window already runs sandbox: true, but defense-in-depth
  // makes a corrupted template harmless even if it slipped past the
  // renderer.
  const sanitisedHtml = sanitisePrintHtml(receiptHtml);
  if (sanitisedHtml.trim().length === 0) {
    return {
      success: false,
      error: 'A receipt document is required before printing',
    };
  }

  try {
    const settings = await getReceiptPrintSettings();
    await printReceipt(sanitisedHtml, settings);
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
