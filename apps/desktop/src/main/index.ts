import { app, shell, BrowserWindow, ipcMain } from 'electron';
import { join } from 'path';
import { createServer, type OpenYojobServer } from '@open-yojob/server';
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

// Server configuration
const SERVER_PORT = 8090;
const DB_PATH = join(app.getPath('userData'), 'data', 'local.db');

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

  mainWindow.webContents.setWindowOpenHandler(details => {
    shell.openExternal(details.url);
    return { action: 'deny' };
  });

  // Load the renderer - use web app in development, built web in production
  if (isDev) {
    // In development, load from the web app's Vite dev server
    console.log(`Loading web app from dev server: ${WEB_DEV_SERVER_URL}`);
    mainWindow.loadURL(WEB_DEV_SERVER_URL);
    // Open DevTools in development
    mainWindow.webContents.openDevTools();
  } else {
    // In production, load from the built web app (extraResource)
    // extraResource copies to: resources/dist/ on macOS, or resources/dist/ on Windows/Linux
    const webAppPath = join(process.resourcesPath, 'dist', 'index.html');
    console.log(`Loading web app from: ${webAppPath}`);
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

// Initialize the application
app.whenReady().then(async () => {
  // Initialize auto-updater (configurable via env)
  initAutoUpdater();

  // Start embedded Fastify server
  try {
    console.log(`[Server] Starting embedded server...`);
    console.log(`[Server] Database path: ${DB_PATH}`);

    server = await createServer({
      dbPath: DB_PATH,
      port: SERVER_PORT,
      host: '127.0.0.1',
      verbose: isDev,
    });

    await server.listen();
    console.log(`[Server] ✓ Server started at ${server.getUrl()}`);
  } catch (err) {
    console.error('[Server] Failed to start:', err);
  }

  createWindow();

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

// Quit when all windows are closed
app.on('window-all-closed', async () => {
  if (server) {
    console.log('[Server] Shutting down...');
    await server.close();
    console.log('[Server] ✓ Server stopped');
  }
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// IPC Handlers
ipcMain.handle('get-app-version', () => app.getVersion());
ipcMain.handle('get-app-path', () => app.getPath('userData'));
ipcMain.handle('get-server-url', () => server?.getUrl() || `http://127.0.0.1:${SERVER_PORT}`);
