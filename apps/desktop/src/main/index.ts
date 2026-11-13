import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  net,
  protocol,
  safeStorage,
  session,
  type OpenDialogOptions,
} from 'electron';
import { join } from 'node:path';
import {
  captureProcessCrash,
  createModuleLogger,
  flushServerTelemetry,
  initServerTelemetryAdapter,
  resolveRuntimeConfig,
} from '@puntovivo/server/desktop-main';
import { sweepStaleBackupStaging } from './backup/backup-bundle.js';
import { createBackupCloudVault } from './backup/cloud-vault.js';
import { createBackupOperationQueue } from './backup/operation-queue.js';
import { createWorkerBackupBundle } from './backup/backup-worker-host.js';
import { createSaleActivityTracker } from './backup/sale-activity.js';
import { createBackupRestoreDrill } from './backup/restore-drill.js';
import { backupTenantPathSegment, createBackupScheduler } from './backup/scheduler.js';
import {
  getAutoUpdateStatus,
  initAutoUpdater,
  refreshAutoUpdateTranslations,
  restartToApplyAppUpdate,
  stopAutoUpdater,
  subscribeAutoUpdateStatus,
} from './auto-updater';
import { installProcessCrashHandlers } from './crash-telemetry.js';
import { createEncryptionSetup } from './encryption-setup.js';
import { createGracefulQuitHandler } from './graceful-quit.js';
import { setMainLocale, normalizeMainLocale, t } from './i18n';
import { buildApplicationMenuTemplate } from './application-menu.js';
import { registerAppLifecycleIpc } from './ipc/app-lifecycle.js';
import { registerBackupIpc, clearPendingRestore } from './ipc/backup.js';
import { getDeviceIdPath } from './ipc/backup/runtime.js';
import { readDeviceIdFromDir } from './device-id-store.js';
import { registerDeviceIpc } from './ipc/device.js';
import { registerPeripheralsIpc } from './ipc/peripherals.js';
import { registerPrintIpc } from './ipc/print.js';
import { registerDataBridgeIpc } from './ipc/register.js';
import { registerSessionIpc } from './ipc/session-ipc.js';
import { createInstallationClaimHandler } from './session/installation-claim.js';
import { createOwnerRecoveryHandlers } from './session/owner-recovery.js';
import { registerWindowIpc } from './ipc/window.js';
import { createHubAuthSession, HUB_AUTH_STATE_FILE } from './session/hub-auth-session.js';
import { createEmbeddedAuthFetch, EMBEDDED_AUTH_ORIGIN } from './session/embedded-auth-fetch.js';
import {
  registerSettingsIpc,
  applyThemePreference,
  getThemePreference,
  getTraySettings,
  type TraySettings,
} from './ipc/settings.js';
import { buildRendererSecurityHeaders, isFastifyApiResponse } from './renderer-security-headers.js';
import {
  installPackagedRendererProtocol,
  registerPackagedRendererScheme,
} from './renderer-protocol.js';
import { getServerHost, markServerReady, requireServerHost, setServerHost } from './runtime.js';
import { createOsKeyGate } from './os-key-gate.js';
import { createServerLifecycle, type FatalWorkerExit } from './server-lifecycle.js';
import {
  createWorkerCrashLog,
  crashMemory,
  crashErrorCode,
  WORKER_CRASH_LOG_FILE,
} from './server-host/crash-log.js';
import { createWorkerLauncher } from './server-host/worker-host.js';
import type { WorkerMemorySample } from './server-host/protocol.js';
import {
  createMemoryWatch,
  DEFAULT_RSS_ALERT_MB,
  resolveWorkerResourceLimits,
} from './server-host/memory-policy.js';
import { broadcastServerState, registerServerStateIpc } from './ipc/server-state.js';
import { createTrayController } from './tray-controller.js';
import { installSoakMode } from './soak-mode.js';
import { disableBuiltinSpellchecker } from './window-config.js';
import { createWindowLifecycle } from './window-lifecycle.js';
import {
  isPackagedRecoveryRequested,
  parsePackagedRecoveryRequest,
  type PackagedRecoveryRequest,
} from './packaged-recovery/mode.js';

// structured main/renderer/backup child loggers.
const mainLog = createModuleLogger('electron-main');
const rendererLog = createModuleLogger('renderer');
const backupLog = createModuleLogger('backup');

// Custom schemes must be registered before app readiness. The handler itself
// is installed after ready, when Electron's net module can serve resources.
registerPackagedRendererScheme(protocol);

// install crash handling before any asynchronous boot work.
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
const isE2e = process.env.PUNTOVIVO_E2E === '1';
const packagedRecoveryRequested = isPackagedRecoveryRequested(process.argv);
let packagedRecoveryRequest: PackagedRecoveryRequest | null = null;
let packagedRecoveryRequestError: Error | null = null;
try {
  packagedRecoveryRequest = parsePackagedRecoveryRequest({
    argv: process.argv,
    env: process.env,
    isPackaged: app.isPackaged,
  });
} catch (error) {
  packagedRecoveryRequestError =
    error instanceof Error ? error : new Error('invalid packaged recovery request');
}
// Exit before Electron opens Local State: on a fresh Windows profile a second
// copy would otherwise create its own safeStorage key and save it over ours.
if (!packagedRecoveryRequested && !app.requestSingleInstanceLock()) {
  process.stderr.write('Puntovivo is already running for this user; switching to it.\n');
  app.exit(0);
}
// a packaged build never opens DevTools from an inherited env var.
const shouldOpenDevTools = !app.isPackaged && process.env.PUNTOVIVO_OPEN_DEVTOOLS === 'true';
process.env.PUNTOVIVO_RUNTIME_ENV ??= isDev ? 'development' : 'production';
// The server registers its own telemetry inside its worker; main crashes
// need this thread's adapter. A no-op without a DSN.
void initServerTelemetryAdapter({ appVersion: app.getVersion() });
mainLog.info({ isPackaged: app.isPackaged, isDev }, 'electron runtime detected');
const authorityRuntime = resolveRuntimeConfig({ env: process.env });
const hubAuthSession = (() => {
  if (authorityRuntime.authorityMode !== 'hub_client') return undefined;
  if (!authorityRuntime.hubUrl) {
    throw new Error('PUNTOVIVO_HUB_URL is required when PUNTOVIVO_AUTHORITY_MODE=hub_client');
  }
  return createHubAuthSession({
    hubUrl: authorityRuntime.hubUrl,
    getStatePath: () => join(app.getPath('userData'), HUB_AUTH_STATE_FILE),
    getDeviceId: () => readDeviceIdFromDir(app.getPath('userData')),
    safeStorage,
    allowInsecureLoopback: isDev,
  });
})();

// The embedded authority keeps renewable credentials only for this process.
// No cookie flags, token lifetimes or server checks are relaxed.
const localAuthSession =
  authorityRuntime.authorityMode !== 'hub_client'
    ? createHubAuthSession({
        hubUrl: EMBEDDED_AUTH_ORIGIN,
        credentialPersistence: 'memory',
        getDeviceId: () => readDeviceIdFromDir(app.getPath('userData')),
        fetchImpl: createEmbeddedAuthFetch(getServerHost),
      })
    : undefined;

let isQuitting = false;
const bootAbort = new AbortController();
let servicesBoot: Promise<TraySettings> | null = null;

const waitForOsKey = createOsKeyGate({
  platform: process.platform,
  localStatePath: join(app.getPath('sessionData'), 'Local State'),
  log: mainLog,
  onWait: () => windowLifecycleRef.current?.reveal(),
  signal: bootAbort.signal,
});

const encryptionSetup = createEncryptionSetup({
  app,
  safeStorage,
  log: mainLog,
  waitForOsKey,
});

const windowLifecycleRef: {
  current: ReturnType<typeof createWindowLifecycle> | null;
} = { current: null };
const trayControllerRef: {
  current: ReturnType<typeof createTrayController> | null;
} = { current: null };

const workerCrashLog = createWorkerCrashLog({
  getPath: () => join(app.getPath('userData'), WORKER_CRASH_LOG_FILE),
});

let lastWorkerStats: WorkerMemorySample | null = null;
const workerMemoryWatch = createMemoryWatch({
  onAlert: sample => {
    mainLog.warn({ ...sample, thresholdMb: DEFAULT_RSS_ALERT_MB }, 'server worker memory high');
    void workerCrashLog.append({
      at: new Date().toISOString(),
      kind: 'unknown',
      exitCode: 0,
      errorCode: null,
      uptimeMs: 0,
      pendingCalls: 0,
      restartAttempt: 0,
      outcome: 'memory-alert',
      fatalCause: null,
      appVersion: app.getVersion(),
      memory: crashMemory(sample),
    });
  },
});

const serverLifecycle = createServerLifecycle({
  dbPath: encryptionSetup.dbPath,
  migrationsPath: encryptionSetup.migrationsPath,
  isDev,
  appVersion: app.getVersion(),
  log: mainLog,
  prepareDatabaseEncryption: encryptionSetup.prepareDatabaseEncryption,
  prepareAuditAnchorKey: encryptionSetup.resolveAuditAnchorKey,
  getMainWindow: () => windowLifecycleRef.current?.getWindow() ?? null,
  launchHost: createWorkerLauncher({
    workerPath: join(__dirname, 'server-worker.cjs'),
    resolveAuditAnchorStoreLocation: encryptionSetup.resolveAuditAnchorStoreLocation,
    onUnexpectedExit: failure => {
      if (isQuitting) return;
      void serverLifecycle.recoverFromUnexpectedExit(failure);
    },
    allowTestCrash: isE2e || process.env.PUNTOVIVO_SOAK === '1',
    resourceLimits: resolveWorkerResourceLimits(),
    onStats: stats => {
      lastWorkerStats = stats;
      workerMemoryWatch.observe(stats);
    },
  }),
  onStateChange: broadcastServerState,
  onFatalExit: fatal => handleFatalServerExit(fatal),
  recordCrash: entry => {
    const record = { ...entry, at: new Date().toISOString(), appVersion: app.getVersion() };
    captureProcessCrash(new Error(`SERVER_WORKER_${entry.outcome.toUpperCase()}`), {
      source: 'server-worker',
      ...record,
    });
    void workerCrashLog.append(record);
  },
});

const FATAL_DIALOG_KEYS = {
  corruption: 'server.fatalCorruption',
  key: 'server.fatalKey',
  'restart-loop': 'server.fatalRestartLoop',
} as const;

/** A worker that cannot come back closes the app with a support code. */
function handleFatalServerExit({ cause, error }: FatalWorkerExit): void {
  if (isQuitting) return;
  isQuitting = true;
  const code = ['PV-WORKER', cause.toUpperCase(), crashErrorCode(error)].filter(Boolean).join('-');
  mainLog.fatal({ cause, code }, 'embedded server worker cannot be restarted');
  dialog.showErrorBox(t('app.name'), t(FATAL_DIALOG_KEYS[cause], { code }));
  void flushServerTelemetry()
    .catch(() => undefined)
    .finally(() => app.quit());
}

const backupOperationQueue = createBackupOperationQueue();
const createBundleOffMain = createWorkerBackupBundle({
  workerPath: join(__dirname, 'backup-worker.cjs'),
});
const saleActivity = createSaleActivityTracker();
const backupCloudVault = createBackupCloudVault({
  getStatePath: () => join(app.getPath('userData'), 'backup-cloud-vaults.v1.json'),
  safeStorage,
  // Packaged E2E owns an ephemeral loopback-only S3 double. Production
  // launches remain HTTPS-only because the test flag is never set there.
  allowInsecureLoopback: isDev || isE2e,
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
  createBundle: createBundleOffMain,
  getLastSaleAt: saleActivity.lastSaleAt,
  replicateSnapshot: input => backupCloudVault.replicateSnapshot(input),
  log: backupLog,
});
const backupRestoreDrill = createBackupRestoreDrill({
  backupScheduler,
  readCurrentCounts: tenantId => requireServerHost().readRestoreDrillCounts(tenantId),
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
  ...(process.env.PUNTOVIVO_SOAK === '1' && process.env.PUNTOVIVO_SOAK_CONTROL_DIR
    ? {
        beforeRendererLoad: webContents =>
          installSoakMode({
            webContents,
            controlDir: process.env.PUNTOVIVO_SOAK_CONTROL_DIR!,
            log: mainLog,
            getServerHost,
            getServerState: serverLifecycle.getState,
            getWorkerStats: () => lastWorkerStats,
            runBackup: tenantId => backupScheduler.runNow(tenantId),
          }),
      }
    : {}),
});
windowLifecycleRef.current = windowLifecycle;

const trayController = createTrayController({
  getMainWindow: windowLifecycle.getWindow,
  toggleMainWindow: windowLifecycle.toggleVisibility,
  getAutoUpdateStatus,
  restartToApplyAppUpdate,
  markQuitting: () => {
    isQuitting = true;
  },
});
trayControllerRef.current = trayController;
let trayInitialized = false;
subscribeAutoUpdateStatus(() => {
  if (trayInitialized) trayController.refresh();
});
windowLifecycle.installGlobalWebContentsPolicy();

// IPC registration remains synchronous and before app-ready. Every channel is
// still owned by the same focused module; only lifecycle state moved out.
registerAppLifecycleIpc();
registerWindowIpc({ openCustomerDisplay: windowLifecycle.openCustomerDisplay });
registerPeripheralsIpc();
registerBackupIpc({
  dbPath: encryptionSetup.dbPath,
  auditAnchorStatePath: encryptionSetup.auditAnchorStatePath,
  getMainWindow: windowLifecycle.getWindow,
  resolveDatabaseEncryptionKey: encryptionSetup.resolveDatabaseEncryptionKey,
  createBackupBundle: createBundleOffMain,
  resolveAuditAnchorKey: encryptionSetup.resolveAuditAnchorKey,
  replaceAuditAnchorState: encryptionSetup.replaceAuditAnchorState,
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
    return requireServerHost().recordAudit({
      tenantId: input.tenantId,
      actorId: input.actorId,
      action: 'backup.restore_drill',
      resourceType: 'backup_snapshot',
      resourceId: input.resourceId,
      metadata,
    });
  },
  recordBackupKeyRevealAudit: input =>
    // The metadata carries only the outcome — never key material.
    requireServerHost().recordAudit({
      tenantId: input.tenantId,
      actorId: input.actorId,
      action: 'backup.encryption_key_reveal',
      resourceType: 'backup_key',
      resourceId: 'install',
      metadata: { outcome: input.outcome },
    }),
  rotateDatabaseKey: encryptionSetup.rotateDatabaseKey,
  getKeyRotationStatus: encryptionSetup.getKeyRotationStatus,
  recordDbKeyRotationAudit: input =>
    // The metadata carries only the outcome — never key material.
    requireServerHost().recordAudit({
      tenantId: input.tenantId,
      actorId: input.actorId,
      action: 'security.db_key_rotation',
      resourceType: 'backup_key',
      resourceId: 'install',
      metadata: { outcome: input.outcome },
    }),
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
registerSessionIpc({
  ...(hubAuthSession ? { hubAuthSession } : {}),
  ...(localAuthSession ? { localAuthSession } : {}),
});
const localOwnerTrust = {
  getMainWindow: windowLifecycle.getWindow,
  isHubClient: authorityRuntime.authorityMode === 'hub_client',
  isDev,
  webDevServerUrl: WEB_DEV_SERVER_URL,
};
ipcMain.handle(
  'session:complete-setup',
  createInstallationClaimHandler({ ...localOwnerTrust, getServerHost })
);
const ownerRecovery = createOwnerRecoveryHandlers({ ...localOwnerTrust, getServerHost });
ipcMain.handle('session:owner-recovery-status', ownerRecovery.status);
ipcMain.handle('session:recover-owner', ownerRecovery.recover);
registerDataBridgeIpc({ log: mainLog });
registerPrintIpc();
registerServerStateIpc({
  getState: serverLifecycle.getState,
  getRestartStats: () => workerCrashLog.stats(),
});

/**
 * Install the curated menu before the first window exists, so a packaged build
 * never renders Electron's default View -> Toggle Developer Tools. Confirmed
 * reachable on a packaged build: Cmd+Alt+I opened a renderer console. Removing
 * raw database IPC does not remove the need for the curated production menu.
 */
function installApplicationMenu(): void {
  const template = buildApplicationMenuTemplate({
    isPackaged: app.isPackaged,
    platform: process.platform,
    appName: app.getName(),
  });
  if (!template) return;
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
  mainLog.info({ items: template.length }, 'curated application menu installed');
}

app.whenReady().then(async () => {
  installApplicationMenu();
  if (packagedRecoveryRequested) {
    if (packagedRecoveryRequestError || !packagedRecoveryRequest) {
      mainLog.error(
        { reason: packagedRecoveryRequestError?.message ?? 'request missing' },
        'packaged recovery rehearsal request rejected'
      );
      app.exit(2);
      return;
    }
    try {
      // Loaded only in this mode: it creates full servers on this thread.
      const { runPackagedRecoveryRehearsal } = await import('./packaged-recovery/run.js');
      const { report } = await runPackagedRecoveryRehearsal({
        outputDirectory: packagedRecoveryRequest.outputDirectory,
        migrationsFolder: join(process.resourcesPath, 'migrations'),
        appVersion: app.getVersion(),
        candidateSha: packagedRecoveryRequest.candidateSha,
        packaged: true,
        electronVersion: process.versions.electron ?? 'unknown',
      });
      process.stdout.write(
        `PUNTOVIVO_PACKAGED_RECOVERY:${JSON.stringify({
          outcome: report.outcome,
          candidateSha: report.candidateSha,
          failureCode: report.failureCode,
        })}\n`
      );
      app.exit(report.outcome === 'passed' ? 0 : 1);
    } catch (error) {
      mainLog.error(
        { errorName: error instanceof Error ? error.name : 'unknown' },
        'packaged recovery rehearsal could not produce evidence'
      );
      app.exit(2);
    }
    return;
  }

  if (app.isPackaged) {
    installPackagedRendererProtocol({
      protocol,
      net,
      rendererRoot: join(process.resourcesPath, 'dist'),
    });
  }

  setMainLocale(normalizeMainLocale(app.getLocale()));
  refreshAutoUpdateTranslations();

  // No window may open with the builtin spellchecker on; see window-config.ts.
  disableBuiltinSpellchecker(session.defaultSession);

  // baseline CSP for renderer-served responses. Fastify API responses already
  // carry Helmet's CSP and must not receive a duplicate concatenated header.
  const isPackagedBuild = app.isPackaged;
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    const url = details.url ?? '';
    if (isFastifyApiResponse(url, authorityRuntime)) {
      saleActivity.observe(details.method, url, details.statusCode);
      // omit responseHeaders rather than passing explicit undefined.
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
          runtime: authorityRuntime,
          webDevServerUrl: WEB_DEV_SERVER_URL,
          // allow the configured renderer telemetry origin only.
          sentryDsn: process.env.PUNTOVIVO_SENTRY_DSN,
        }),
      },
    });
  });

  // The renderer loads while the server starts and holds the app until it is up.
  // The window shows then, or as soon as the first-launch key wait begins.
  windowLifecycle.create({ deferReveal: true });
  const reopenMainWindow = () => {
    if (isQuitting) return;
    if (BrowserWindow.getAllWindows().length === 0) {
      windowLifecycle.create();
      if (trayInitialized) trayController.refresh();
      return;
    }
    windowLifecycle.show();
  };
  app.on('activate', reopenMainWindow);
  app.on('second-instance', reopenMainWindow);

  // The update floor is sealed on first launch, so it waits like the key envelopes.
  void waitForOsKey()
    .then(initAutoUpdater)
    .catch(err => {
      if (!isQuitting) mainLog.error({ err }, 'auto-updater initialization failed');
    });

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
    servicesBoot = (async () => {
      setServerHost(await serverLifecycle.start());
      await backupScheduler.start();
      applyThemePreference(await getThemePreference());
      return getTraySettings();
    })();
    initialTraySettings = await servicesBoot;
  } catch (err) {
    // Closing the window during the key wait aborts the boot before anything is sealed.
    if (isQuitting) return;
    // Every app API depends on the embedded server; fail loud.
    mainLog.fatal({ err }, 'embedded server failed to start');
    const detail = err instanceof Error ? err.message : String(err);
    dialog.showErrorBox(t('app.name'), detail);
    isQuitting = true;
    app.quit();
    return;
  }
  if (isQuitting) return;

  markServerReady();
  trayController.refresh(initialTraySettings);
  trayInitialized = true;
  windowLifecycle.reveal();
});

app.on('before-quit', () => {
  isQuitting = true;
  bootAbort.abort();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

const handleGracefulQuit = createGracefulQuitHandler({
  quit: () => app.quit(),
  onError: err => mainLog.error({ err }, 'unexpected graceful shutdown failure'),
  shutdown: async () => {
    // A quit during boot stops what boot started, not a half-open server.
    await servicesBoot?.catch(() => undefined);
    await backupScheduler
      .stop()
      .then(() => backupOperationQueue.drain())
      .then(() => serverLifecycle.stop())
      .catch(err => {
        mainLog.error({ err }, 'failed to stop embedded server during shutdown');
      });
    await clearPendingRestore().catch(err => {
      backupLog.warn({ err }, 'failed to discard pending restore staging during shutdown');
    });
  },
});

app.on('will-quit', event => {
  trayController.destroy();
  stopAutoUpdater();
  handleGracefulQuit(event);
});
