import { app, BrowserWindow, dialog, safeStorage, session, type OpenDialogOptions } from 'electron';
import { join } from 'node:path';
import {
  captureProcessCrash,
  createModuleLogger,
  flushServerTelemetry,
  resolveRuntimeConfig,
  writeAuditLog,
} from '@puntovivo/server';
import { sweepStaleBackupStaging } from './backup/backup-bundle.js';
import { createBackupCloudVault } from './backup/cloud-vault.js';
import { createBackupOperationQueue } from './backup/operation-queue.js';
import { createBackupRestoreDrill } from './backup/restore-drill.js';
import { backupTenantPathSegment, createBackupScheduler } from './backup/scheduler.js';
import { initAutoUpdater, refreshAutoUpdateTranslations, stopAutoUpdater } from './auto-updater';
import { installProcessCrashHandlers } from './crash-telemetry.js';
import { createEncryptionSetup } from './encryption-setup.js';
import { setMainLocale, normalizeMainLocale, t } from './i18n';
import { registerAppLifecycleIpc } from './ipc/app-lifecycle.js';
import { registerBackupIpc, clearPendingRestore } from './ipc/backup.js';
import { getDeviceIdPath } from './ipc/backup/runtime.js';
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
import { buildRendererSecurityHeaders, isFastifyApiResponse } from './renderer-security-headers.js';
import { getServerDatabase, getSqliteClient, setServer } from './runtime.js';
import { createServerLifecycle } from './server-lifecycle.js';
import { createTrayController } from './tray-controller.js';
import { createWindowLifecycle } from './window-lifecycle.js';

// ENG-006 — structured main/renderer/backup child loggers.
const mainLog = createModuleLogger('electron-main');
const rendererLog = createModuleLogger('renderer');
const backupLog = createModuleLogger('backup');

// Handle creating/removing shortcuts on Windows when installing/uninstalling.
if (require('electron-squirrel-startup')) app.quit();

// ENG-135b — install crash handling before any asynchronous boot work.
installProcessCrashHandlers({
  log: mainLog,
  captureCrash: captureProcessCrash,
  flushTelemetry: flushServerTelemetry,
  exit: code => app.exit(code),
  proc: process,
});

// Pin the name before the first userData lookup. Development Electron would
// otherwise store its DB/key envelope under the generic Electron directory.
app.setName('Puntovivo');

const WEB_DEV_SERVER_URL = process.env.WEB_DEV_SERVER_URL || 'http://localhost:3000';
const isDev = !app.isPackaged;
// ENG-166 — a packaged build never opens DevTools from an inherited env var.
const shouldOpenDevTools = !app.isPackaged && process.env.PUNTOVIVO_OPEN_DEVTOOLS === 'true';
process.env.PUNTOVIVO_RUNTIME_ENV ??= isDev ? 'development' : 'production';
mainLog.info({ isPackaged: app.isPackaged, isDev }, 'electron runtime detected');

let isQuitting = false;
let serverShutdownComplete = false;

const encryptionSetup = createEncryptionSetup({
  app,
  safeStorage,
  log: mainLog,
});

const windowLifecycleRef: {
  current: ReturnType<typeof createWindowLifecycle> | null;
} = { current: null };
const trayControllerRef: {
  current: ReturnType<typeof createTrayController> | null;
} = { current: null };

const serverLifecycle = createServerLifecycle({
  dbPath: encryptionSetup.dbPath,
  migrationsPath: encryptionSetup.migrationsPath,
  isDev,
  appVersion: app.getVersion(),
  log: mainLog,
  prepareDatabaseEncryption: encryptionSetup.prepareDatabaseEncryption,
  getMainWindow: () => windowLifecycleRef.current?.getWindow() ?? null,
});

const backupOperationQueue = createBackupOperationQueue();
const backupCloudVault = createBackupCloudVault({
  getStatePath: () => join(app.getPath('userData'), 'backup-cloud-vaults.v1.json'),
  safeStorage,
  allowInsecureLoopback: isDev,
  log: backupLog,
});
const backupScheduler = createBackupScheduler({
  dbPath: encryptionSetup.dbPath,
  getStatePath: () => join(app.getPath('userData'), 'backup-schedules.v1.json'),
  getManagedDirectory: tenantId =>
    join(app.getPath('userData'), 'backups', backupTenantPathSegment(tenantId)),
  getDeviceIdPath,
  getAppVersion: () => app.getVersion(),
  resolveDatabaseEncryptionKey: encryptionSetup.resolveDatabaseEncryptionKey,
  runExclusive: backupOperationQueue.run,
  replicateSnapshot: input => backupCloudVault.replicateSnapshot(input),
  log: backupLog,
});
const backupRestoreDrill = createBackupRestoreDrill({
  backupScheduler,
  getCurrentDatabase: () => getSqliteClient().$client,
  resolveDatabaseEncryptionKey: encryptionSetup.resolveDatabaseEncryptionKey,
  runExclusive: backupOperationQueue.run,
});

const windowLifecycle = createWindowLifecycle({
  webDevServerUrl: WEB_DEV_SERVER_URL,
  isDev,
  shouldOpenDevTools,
  log: mainLog,
  rendererLog,
  stopEmbeddedServer: serverLifecycle.stop,
  shouldCloseToTray: () => {
    const settings = trayControllerRef.current?.getSettings();
    return Boolean(settings?.enabled && settings.closeToTray);
  },
  isQuitting: () => isQuitting,
  onVisibilityChange: () => trayControllerRef.current?.refresh(),
});
windowLifecycleRef.current = windowLifecycle;

const trayController = createTrayController({
  getMainWindow: windowLifecycle.getWindow,
  toggleMainWindow: windowLifecycle.toggleVisibility,
  markQuitting: () => {
    isQuitting = true;
  },
});
trayControllerRef.current = trayController;
windowLifecycle.installGlobalWebContentsPolicy();

// ENG-178 — IPC registration remains synchronous and before app-ready. Every channel is
// still owned by the same focused module; only lifecycle state moved out.
registerAppLifecycleIpc();
registerPeripheralsIpc();
registerBackupIpc({
  dbPath: encryptionSetup.dbPath,
  getMainWindow: windowLifecycle.getWindow,
  resolveDatabaseEncryptionKey: encryptionSetup.resolveDatabaseEncryptionKey,
  getBackupProtectionStatus: encryptionSetup.getBackupProtectionStatus,
  runWithServerRestart: serverLifecycle.restartAround,
  runExclusiveBackupOperation: backupOperationQueue.run,
  backupScheduler,
  backupCloudVault,
  runBackupRestoreDrill: tenantId => backupRestoreDrill.run(tenantId),
  recordBackupRestoreDrillAudit: input => {
    const metadata =
      input.outcome === 'passed'
        ? {
            outcome: input.outcome,
            checkedAt: input.report.checkedAt,
            snapshotGeneratedAt: input.report.snapshotGeneratedAt,
            snapshotSchemaVersion: input.report.snapshotSchemaVersion,
            snapshotSizeBytes: input.report.snapshotSizeBytes,
            currentTotal: input.report.currentTotal,
            snapshotTotal: input.report.snapshotTotal,
            tableDeltas: Object.fromEntries(input.report.tables.map(row => [row.table, row.delta])),
          }
        : {
            outcome: input.outcome,
            errorCode: input.errorCode,
          };
    writeAuditLog({
      tx: getServerDatabase(),
      tenantId: input.tenantId,
      actorId: input.actorId,
      action: 'backup.restore_drill',
      resourceType: 'backup_snapshot',
      resourceId: input.resourceId,
      metadata,
    });
  },
  chooseBackupScheduleDirectory: async () => {
    const options: OpenDialogOptions = {
      title: t('backup.scheduleDialogTitle'),
      properties: ['openDirectory', 'createDirectory'],
    };
    const mainWindow = windowLifecycle.getWindow();
    const result = mainWindow
      ? await dialog.showOpenDialog(mainWindow, options)
      : await dialog.showOpenDialog(options);
    return result.canceled ? null : (result.filePaths[0] ?? null);
  },
});
registerSettingsIpc({
  getMainWindow: windowLifecycle.getWindow,
  refreshTray: trayController.refresh,
});
registerDeviceIpc({ log: mainLog });
registerSessionIpc();
registerDataBridgeIpc({ log: mainLog });
registerPrintIpc();

app.whenReady().then(async () => {
  setMainLocale(normalizeMainLocale(app.getLocale()));
  refreshAutoUpdateTranslations();

  // ENG-166 — baseline CSP for renderer-served responses. Fastify API responses already
  // carry Helmet's CSP and must not receive a duplicate concatenated header.
  const isPackagedBuild = app.isPackaged;
  const rendererSecurityRuntime = resolveRuntimeConfig({ env: process.env });
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    const url = details.url ?? '';
    if (isFastifyApiResponse(url, rendererSecurityRuntime)) {
      // ENG-179b — omit responseHeaders rather than passing explicit undefined.
      callback(
        details.responseHeaders === undefined ? {} : { responseHeaders: details.responseHeaders }
      );
      return;
    }
    callback({
      responseHeaders: {
        ...(details.responseHeaders ?? {}),
        ...buildRendererSecurityHeaders({
          isPackagedBuild,
          runtime: rendererSecurityRuntime,
          webDevServerUrl: WEB_DEV_SERVER_URL,
          // ENG-135b — allow the configured renderer telemetry origin only.
          sentryDsn: process.env.PUNTOVIVO_SENTRY_DSN,
        }),
      },
    });
  });

  initAutoUpdater();

  // Best-effort cleanup of backup staging directories orphaned by a crash.
  void sweepStaleBackupStaging()
    .then(removed => {
      if (removed.length > 0) {
        backupLog.info({ removed }, 'swept stale backup/restore staging directories');
      }
    })
    .catch(err => {
      backupLog.warn({ err }, 'failed to sweep stale backup staging directories');
    });

  let initialTraySettings: TraySettings;
  try {
    setServer(await serverLifecycle.start());
    await backupScheduler.start();
    applyThemePreference(await getThemePreference());
    initialTraySettings = await getTraySettings();
  } catch (err) {
    // DK-004 — every app API depends on the in-process Fastify server; fail loud.
    mainLog.fatal({ err }, 'embedded server failed to start');
    const detail = err instanceof Error ? err.message : String(err);
    dialog.showErrorBox(t('app.name'), detail);
    isQuitting = true;
    app.quit();
    return;
  }

  windowLifecycle.create();
  trayController.refresh(initialTraySettings);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      windowLifecycle.create();
      trayController.refresh();
      return;
    }
    windowLifecycle.show();
  });
});

app.on('before-quit', () => {
  isQuitting = true;
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('will-quit', event => {
  trayController.destroy();
  stopAutoUpdater();
  if (serverShutdownComplete) return;

  // DK-005 — Electron quit listeners are synchronous. Defer exit until the embedded
  // server, pending restore staging, and SQLite handles have closed.
  event.preventDefault();
  void backupScheduler
    .stop()
    .then(() => backupOperationQueue.drain())
    .then(() => serverLifecycle.stop())
    .catch(err => {
      mainLog.error({ err }, 'failed to stop embedded server during shutdown');
    })
    .then(() => clearPendingRestore())
    .catch(err => {
      backupLog.warn({ err }, 'failed to discard pending restore staging during shutdown');
    })
    .finally(() => {
      serverShutdownComplete = true;
      app.quit();
    });
});
