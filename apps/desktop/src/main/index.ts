import {
  app,
  shell,
  BrowserWindow,
  dialog,
  Menu,
  safeStorage,
  session,
  Tray,
  nativeImage,
} from 'electron';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { getDbKeyDir, getOrCreateDbKey } from './db-key-store.js';
import { sweepStaleBackupStaging } from './backup/backup-bundle.js';
// ENG-167b — one-shot first-boot encryption of pre-Step-1 databases.
import { migrateCleartextDatabase } from './db-migrate-encryption.js';
import {
  createServer,
  createModuleLogger,
  resolveRuntimeConfig,
  type PuntovivoServer,
  type RuntimeConfig,
} from '@puntovivo/server';

// ENG-006 — child loggers for the Electron main. `electron-main`
// covers the embedded Fastify lifecycle, window loading, and the
// renderer-console forwarding hook. `backup` and `print` split out
// two frequent-error surfaces so operators can filter the stream by
// module=backup or module=print without additional tagging (the
// `print` child now lives in ./ipc/print.ts, and ./ipc/backup.ts
// creates its own `backup` child for the extracted handlers; the
// instance below covers the backup-staging sweep + shutdown paths
// that stayed in this module).
const mainLog = createModuleLogger('electron-main');
const rendererLog = createModuleLogger('renderer');
const backupLog = createModuleLogger('backup');

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
  initAutoUpdater,
  refreshAutoUpdateTranslations,
  stopAutoUpdater,
} from './auto-updater';
import { t, setMainLocale, normalizeMainLocale } from './i18n';
import { buildMainWindowWebPreferences } from './window-config.js';
import {
  buildRendererSecurityHeaders,
  isFastifyApiResponse,
} from './renderer-security-headers.js';
import { isAllowedExternalUrl } from './external-url-policy.js';
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
import { getServer, setServer } from './runtime.js';
// ENG-178 — the IPC handler registration blocks live in focused modules
// under ./ipc/. Main-process state they need (main window, DB path,
// encryption-key cache, server-restart choreography, tray refresh) is
// passed explicitly through each register function's deps, so none of
// them imports back into this module.
import { registerAppLifecycleIpc } from './ipc/app-lifecycle.js';
import { registerBackupIpc, clearPendingRestore } from './ipc/backup.js';
import { registerDeviceIpc } from './ipc/device.js';
import { registerPeripheralsIpc } from './ipc/peripherals.js';
import { registerPrintIpc } from './ipc/print.js';
import { registerDataBridgeIpc } from './ipc/register.js';
import { registerSessionIpc } from './ipc/session-ipc.js';
import {
  registerSettingsIpc,
  applyThemePreference,
  getThemePreference,
  getTraySettings,
  type TraySettings,
} from './ipc/settings.js';

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
// ENG-178 — registration blocks extracted into focused modules under
// ./ipc/ (same channels, validation and error strings; registered here,
// before app-ready, exactly as the inline blocks were). Main-process
// state is handed over through explicit deps: a `getMainWindow` getter
// (the window is created later and can be recreated), the live DB path,
// the encryption-key cache resolver and the embedded-server restart
// choreography for backup/restore, the tray refresher for the settings
// surface, and the `electron-main` logger where the extracted handlers
// logged through it.
registerAppLifecycleIpc();
registerPeripheralsIpc();
registerBackupIpc({
  dbPath: DB_PATH,
  getMainWindow: () => mainWindow,
  resolveDatabaseEncryptionKey,
  runWithServerRestart,
});
registerSettingsIpc({
  getMainWindow: () => mainWindow,
  refreshTray,
});
registerDeviceIpc({ log: mainLog });
registerSessionIpc();
registerDataBridgeIpc({ log: mainLog });
registerPrintIpc();
