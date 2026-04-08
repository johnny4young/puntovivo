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
import { access, copyFile, mkdir, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { createServer, type OpenYojobServer, appSettings } from '@open-yojob/server';
import { eq } from 'drizzle-orm';
import { initAutoUpdater } from './auto-updater';

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

const RECEIPT_PRINT_SETTINGS_KEY = 'receipt_print_settings';
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
