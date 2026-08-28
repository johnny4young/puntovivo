import { app, safeStorage } from 'electron';
import { autoUpdater, type ProgressInfo, type UpdateInfo } from 'electron-updater';
import { createModuleLogger } from '@puntovivo/server';
import { join } from 'node:path';
import { mapReleaseFields, redactAutoUpdaterError } from './auto-update-status';
import type {
  AutoUpdateActionResult,
  AutoUpdateInstallMode,
  AutoUpdateStatus,
} from './auto-updater/contracts';
import { fetchLatestRelease, isNewerRelease, REPO_SLUG } from './auto-updater/release-notification';
import {
  canAcceptDownloadedArtifact,
  recordDownloadedUpdate,
  recordVersionTransition,
  type DownloadedUpdateRecord,
} from './auto-updater/update-history';
import { loadOrAdvanceUpdateFloor } from './auto-updater/update-floor-store';
import {
  fetchUpdatePolicy,
  isCandidateAllowedByPolicy,
  type UpdatePolicy,
} from './auto-updater/update-policy';
import {
  applyInstallPolicy,
  resolveUpdateInstallPolicy,
  type UpdateInstallPolicy,
} from './auto-updater/install-policy';
import { t } from './i18n';

export type {
  AutoUpdateActionResult,
  AutoUpdateInstallMode,
  AutoUpdateRolloutMode,
  AutoUpdateState,
  AutoUpdateStatus,
} from './auto-updater/contracts';

const log = createModuleLogger('auto-updater');

const AUTO_UPDATE_ENABLED = process.env.AUTO_UPDATE !== 'false';
const E2E_UPDATE_SIMULATION =
  process.env.PUNTOVIVO_E2E === '1' && process.env.PUNTOVIVO_E2E_UPDATER === '1';
// electron-updater auto-installs on all three: mac (Squirrel.Mac zip), windows
// (NSIS), linux (AppImage, when the app is launched as the .AppImage).
const SUPPORTED_AUTO_UPDATE_PLATFORMS = new Set(['darwin', 'win32', 'linux']);

// Release repository coordinates. The auto-updater runs in one of two modes,
// chosen by REPO_IS_PRIVATE so the SAME code works whether the repo is closed
// or open source:
//
//   - PUBLIC (default, today): the repo is open source, so electron-updater
//     reads the self-hosted feed (the latest-*.yml app-update.yml points at) and
//     downloads + installs the platform-native package in the background. No
//     credentials are embedded in the client — the feed and the release binaries
//     are public.
//   - PRIVATE (PUNTOVIVO_UPDATE_REPO_PRIVATE=true): a NOTIFY-ONLY fallback —
//     poll the Releases API, surface the new version, and let the user download
//     it from the release page. Used for internal / pre-public builds; flipping
//     the env flag is the only change needed, no code edit.
const REPO_IS_PRIVATE = process.env.PUNTOVIVO_UPDATE_REPO_PRIVATE === 'true';

const NOTIFY_POLL_INTERVAL_MS = 60 * 60 * 1000; // 1h, mirrors the prior '1 hour'
// electron-updater has no built-in poll, so the auto mode drives its own check
// loop on the same cadence the notify poll uses.
const AUTO_CHECK_INTERVAL_MS = 60 * 60 * 1000;
const INSTALL_MODE: AutoUpdateInstallMode = REPO_IS_PRIVATE ? 'manual' : 'auto';

// Windows has no signing certificate yet, so nothing verifies a downloaded
// installer and silent install stays closed. This is passed explicitly rather
// than read from the packaged app-update.yml: electron-updater YAML-loads that
// file and skips verification for `publisherName: null`, and a per-user NSIS
// install leaves it writable without elevation — so a config read could be made
// to claim a protection the updater would not apply. Re-opening win32 is a
// reviewed code change, proven against a real signed artifact.
const INSTALL_POLICY: UpdateInstallPolicy = resolveUpdateInstallPolicy({
  platform: process.platform,
  windowsPublisherName: null,
});

function createDefaultStatus(): AutoUpdateStatus {
  return {
    isAvailable: false,
    state: 'unavailable',
    installMode: INSTALL_MODE,
    currentVersion: app.getVersion(),
    lastCheckedAt: null,
    lastUpdatedAt: null,
    downloadedVersion: null,
    downloadedAt: null,
    installReady: false,
    updateFloorVersion: null,
    rolloutMode: null,
    rolloutPercentage: null,
    rolloutTargetVersion: null,
    rolloutPolicyCheckedAt: null,
    releaseName: null,
    releaseNotes: null,
    releaseDate: null,
    updateUrl: null,
    error: null,
    reason: t('autoUpdate.notInitialized'),
  };
}

let autoUpdateStatus = createDefaultStatus();
let listenersAttached = false;
let initialized = false;
let notifyPollHandle: ReturnType<typeof setInterval> | null = null;
let autoCheckHandle: ReturnType<typeof setInterval> | null = null;
let autoCheckInFlight: Promise<AutoUpdateStatus> | null = null;
let updateHistoryInitialized = false;
let activeUpdatePolicy: UpdatePolicy | null = null;
let activeUpdateFloorVersion: string | null = null;
let pendingDownloadedUpdate: DownloadedUpdateRecord | null = null;
let reconfirmedArtifactIdentity: string | null = null;
let e2eRestartRequested = false;
const statusListeners = new Set<(status: AutoUpdateStatus) => void>();

// Keep Electron's OS support check, then add one narrow rollback invariant.
// Capturing the original callback avoids duplicating electron-updater's evolving
// minimumSystemVersion policy in Puntovivo.
const defaultIsUpdateSupported = autoUpdater.isUpdateSupported;
autoUpdater.isUpdateSupported = async info =>
  (await Promise.resolve(defaultIsUpdateSupported(info))) &&
  activeUpdateFloorVersion !== null &&
  isCandidateAllowedByPolicy(activeUpdatePolicy, info.version, activeUpdateFloorVersion);

function currentTimestamp(): string {
  return new Date().toISOString();
}

function updateStatus(nextStatus: Partial<AutoUpdateStatus>): AutoUpdateStatus {
  autoUpdateStatus = {
    ...autoUpdateStatus,
    ...nextStatus,
    installMode: INSTALL_MODE,
    currentVersion: app.getVersion(),
  };

  const snapshot = getAutoUpdateStatus();
  for (const listener of statusListeners) {
    try {
      listener(snapshot);
    } catch (error) {
      log.warn({ err: error }, 'auto-update status listener failed');
    }
  }
  return snapshot;
}

function setUnavailable(reason: string): AutoUpdateStatus {
  return updateStatus({
    isAvailable: false,
    state: 'unavailable',
    reason,
    error: null,
    releaseName: null,
    releaseNotes: null,
    releaseDate: null,
    updateUrl: null,
  });
}

function ensureUpdateHistory(): void {
  if (updateHistoryInitialized) return;
  updateHistoryInitialized = true;

  try {
    const history = recordVersionTransition(
      join(app.getPath('userData'), 'auto-update-history.json'),
      app.getVersion()
    );
    pendingDownloadedUpdate = history.downloaded;
    updateStatus({
      lastUpdatedAt: history.updatedAt,
      downloadedVersion: history.downloaded?.version ?? null,
      downloadedAt: history.downloaded?.downloadedAt ?? null,
      installReady: false,
      ...(history.downloaded
        ? {
            state: 'downloaded' as const,
            releaseName: history.downloaded.releaseName,
            releaseNotes: history.downloaded.releaseNotes,
            releaseDate: history.downloaded.releaseDate,
            updateUrl: history.downloaded.updateUrl,
          }
        : {}),
    });
    if (history.recovered) {
      log.warn('recovered malformed auto-update history with a safe baseline');
    }
  } catch (error) {
    log.warn({ err: error }, 'failed to persist auto-update history');
  }
}

function ensureUpdateFloor(): boolean {
  try {
    const floor = loadOrAdvanceUpdateFloor({
      dataDir: app.getPath('userData'),
      currentVersion: app.getVersion(),
      safeStorage,
    });
    activeUpdateFloorVersion = floor.floorVersion;
    updateStatus({ updateFloorVersion: floor.floorVersion });
    if (floor.advanced) {
      log.info({ floorVersion: floor.floorVersion }, 'advanced sealed auto-update floor');
    }
    return true;
  } catch (error) {
    activeUpdateFloorVersion = null;
    log.error({ err: error }, 'sealed auto-update floor unavailable');
    updateStatus({
      isAvailable: false,
      state: 'error',
      error: t('autoUpdate.floorUnavailable'),
      reason: null,
      installReady: false,
      updateFloorVersion: null,
    });
    return false;
  }
}

function restorePendingDownloadStatus(): AutoUpdateStatus | null {
  if (!pendingDownloadedUpdate) return null;
  return updateStatus({
    isAvailable: true,
    state: 'downloaded',
    error: null,
    reason: t('autoUpdate.downloadNeedsVerification'),
    releaseName: pendingDownloadedUpdate.releaseName,
    releaseNotes: pendingDownloadedUpdate.releaseNotes,
    releaseDate: pendingDownloadedUpdate.releaseDate,
    updateUrl: pendingDownloadedUpdate.updateUrl,
    downloadedVersion: pendingDownloadedUpdate.version,
    downloadedAt: pendingDownloadedUpdate.downloadedAt,
    installReady: false,
  });
}

async function refreshUpdatePolicy(): Promise<void> {
  const result = await fetchUpdatePolicy();
  if (result.kind === 'error') {
    activeUpdatePolicy = null;
    autoUpdater.allowDowngrade = false;
    updateStatus({
      rolloutMode: null,
      rolloutPercentage: null,
      rolloutTargetVersion: null,
      rolloutPolicyCheckedAt: result.checkedAt,
    });
    log.warn({ message: result.message }, 'update policy unavailable; downgrade remains disabled');
    return;
  }

  activeUpdatePolicy = result.policy;
  // The feed and policy share one mutable origin, so neither may authorize a
  // downgrade. A rollback policy remains visible but requires a separately
  // delivered manual installer.
  autoUpdater.allowDowngrade = false;
  updateStatus({
    rolloutMode: result.policy.mode,
    rolloutPercentage: result.policy.rolloutPercentage,
    rolloutTargetVersion: result.policy.targetVersion,
    rolloutPolicyCheckedAt: result.checkedAt,
  });
}

function runAutoCheck(logMessage: string): Promise<AutoUpdateStatus> {
  if (!autoCheckInFlight) {
    autoCheckInFlight = (async () => {
      await refreshUpdatePolicy();
      try {
        await autoUpdater.checkForUpdates();
      } catch (error) {
        log.warn({ err: error }, logMessage);
      }
      return getAutoUpdateStatus();
    })().finally(() => {
      autoCheckInFlight = null;
    });
  }

  return autoCheckInFlight;
}

function getUnavailableReason(): string {
  if (!app.isPackaged) {
    return t('autoUpdate.devBuild');
  }

  if (!AUTO_UPDATE_ENABLED) {
    return t('autoUpdate.disabledByEnv');
  }

  // Squirrel (the auto-download path) only runs on macOS + Windows. The
  // notify-only path is platform-agnostic — it is just an HTTPS check — so it
  // stays available on Linux too.
  if (INSTALL_MODE === 'auto' && !SUPPORTED_AUTO_UPDATE_PLATFORMS.has(process.platform)) {
    return t('autoUpdate.platformUnsupported', { platform: process.platform });
  }

  return t('autoUpdate.notInitialized');
}

async function runNotifyCheck(): Promise<AutoUpdateStatus> {
  updateStatus({
    state: 'checking',
    error: null,
    reason: null,
    lastCheckedAt: currentTimestamp(),
  });

  const result = await fetchLatestRelease();

  if (result.kind === 'inaccessible') {
    // Private repo + no read token: we genuinely cannot check. Be honest rather
    // than report a transient error the user could "retry" forever.
    return setUnavailable(t('autoUpdate.requiresRepoAccess'));
  }

  if (result.kind === 'error') {
    log.warn({ message: result.message }, 'notify-only update check failed');
    return updateStatus({
      isAvailable: true,
      state: 'error',
      error: t('autoUpdate.checkFailed'),
      lastCheckedAt: currentTimestamp(),
    });
  }

  if (isNewerRelease(result, app.getVersion())) {
    return updateStatus({
      isAvailable: true,
      state: 'available',
      error: null,
      reason: null,
      lastCheckedAt: currentTimestamp(),
      releaseName: result.name,
      releaseNotes: result.notes,
      releaseDate: result.date ? new Date(result.date).toISOString() : null,
      updateUrl: result.url,
    });
  }

  return updateStatus({
    isAvailable: true,
    state: 'idle',
    error: null,
    reason: null,
    lastCheckedAt: currentTimestamp(),
    releaseName: null,
    releaseNotes: null,
    releaseDate: null,
    updateUrl: null,
  });
}

// ---------------------------------------------------------------------------
// Auto mode: electron-updater background download + install
// ---------------------------------------------------------------------------

function attachListeners(): void {
  if (listenersAttached) {
    return;
  }

  listenersAttached = true;

  autoUpdater.on('checking-for-update', () => {
    updateStatus({
      isAvailable: true,
      state: 'checking',
      error: null,
      reason: null,
      lastCheckedAt: currentTimestamp(),
    });
  });

  autoUpdater.on('update-available', (info: UpdateInfo) => {
    updateStatus({
      isAvailable: true,
      state: 'available',
      error: null,
      reason: null,
      lastCheckedAt: currentTimestamp(),
      downloadedVersion: null,
      downloadedAt: null,
      installReady: false,
      ...mapReleaseFields(info, REPO_SLUG),
    });
  });

  autoUpdater.on('update-not-available', () => {
    if (restorePendingDownloadStatus()) return;
    updateStatus({
      isAvailable: true,
      state: 'idle',
      error: null,
      reason: null,
      lastCheckedAt: currentTimestamp(),
      releaseName: null,
      releaseNotes: null,
      releaseDate: null,
      updateUrl: null,
      downloadedVersion: null,
      downloadedAt: null,
      installReady: false,
    });
  });

  // autoDownload is on, so electron-updater pulls the package in the background
  // after 'update-available'. Keep the 'available' state during the download
  // (the prior update-electron-app path surfaced no progress either) and only
  // flip to 'downloaded' once it is ready to install.
  autoUpdater.on('download-progress', (progress: ProgressInfo) => {
    log.info({ percent: Math.round(progress.percent) }, 'auto-update downloading');
  });

  autoUpdater.on('update-downloaded', (info: UpdateInfo) => {
    const artifactSha512 = info.sha512 || info.files.find(file => file.sha512)?.sha512;
    if (
      !artifactSha512 ||
      !activeUpdateFloorVersion ||
      !isCandidateAllowedByPolicy(activeUpdatePolicy, info.version, activeUpdateFloorVersion) ||
      !canAcceptDownloadedArtifact(pendingDownloadedUpdate, {
        version: info.version,
        artifactSha512: artifactSha512 ?? '',
      })
    ) {
      reconfirmedArtifactIdentity = null;
      updateStatus({
        isAvailable: true,
        state: 'error',
        error: t('autoUpdate.downloadRejected'),
        reason: null,
        installReady: false,
        lastCheckedAt: currentTimestamp(),
      });
      log.error(
        { version: info.version, hasArtifactHash: Boolean(artifactSha512) },
        'rejected downloaded update before persistence'
      );
      return;
    }

    try {
      const release = mapReleaseFields(info, REPO_SLUG);
      const history = recordDownloadedUpdate(
        join(app.getPath('userData'), 'auto-update-history.json'),
        app.getVersion(),
        {
          version: info.version,
          artifactSha512,
          ...release,
        }
      );
      pendingDownloadedUpdate = history.downloaded;
      reconfirmedArtifactIdentity = `${info.version}:${artifactSha512}`;
      updateStatus({
        isAvailable: true,
        state: 'downloaded',
        error: null,
        reason: null,
        lastCheckedAt: currentTimestamp(),
        downloadedVersion: info.version,
        downloadedAt: history.downloaded?.downloadedAt ?? null,
        installReady: true,
        ...release,
      });
    } catch (error) {
      reconfirmedArtifactIdentity = null;
      updateStatus({
        isAvailable: true,
        state: 'error',
        error: t('autoUpdate.downloadPersistenceFailed'),
        reason: null,
        installReady: false,
      });
      log.error({ err: error }, 'failed to persist downloaded update identity');
    }
  });

  autoUpdater.on('error', error => {
    // Preserve provider diagnostics in the structured log, but keep the IPC
    // status bounded: the renderer must never display feed URLs, filesystem
    // paths, response bodies, or other electron-updater internals verbatim.
    log.warn({ err: error }, 'auto-update check failed');
    updateStatus({
      isAvailable: initialized,
      state: 'error',
      error: redactAutoUpdaterError(error, t('autoUpdate.checkFailed')),
      lastCheckedAt: currentTimestamp(),
    });
  });
}

function initAutoMode(): AutoUpdateStatus {
  // Downloading is always safe; INSTALLING without a verified signature is
  // not. Where the platform cannot check the package, the update waits for the
  // operator's explicit "restart to apply" instead of applying itself on quit.
  // Applied first, outside the try below, because electron-updater's default is
  // to install on quit — a throw anywhere later must not leave that default in
  // place. See auto-updater/install-policy.ts for why each platform lands where
  // it does.
  applyInstallPolicy(autoUpdater, INSTALL_POLICY);

  attachListeners();
  initialized = true;

  updateStatus({
    isAvailable: true,
    state: pendingDownloadedUpdate ? 'downloaded' : 'idle',
    error: null,
    reason: pendingDownloadedUpdate ? t('autoUpdate.downloadNeedsVerification') : null,
    installReady: false,
  });

  try {
    // electron-updater reads the feed from the app-update.yml electron-builder
    // embeds (the publish provider), so no repo coordinates are wired here. Its
    // diagnostics thread through the shared NDJSON logger; pino's child logger
    // satisfies the debug/info/warn/error shape electron-updater expects.
    autoUpdater.logger = {
      debug: (...args: unknown[]) => log.debug({ args }, 'auto-update debug'),
      info: (...args: unknown[]) => log.info({ args }, 'auto-update info'),
      warn: (...args: unknown[]) => log.warn({ args }, 'auto-update warn'),
      error: (...args: unknown[]) => log.error({ args }, 'auto-update error'),
    };
    autoUpdater.autoDownload = true;

    // electron-updater has no built-in poll, so drive the initial check + the
    // interval ourselves (this is what update-electron-app's updateInterval did).
    void runAutoCheck('initial auto-update check failed');
    if (!autoCheckHandle) {
      autoCheckHandle = setInterval(() => {
        void runAutoCheck('scheduled auto-update check failed');
      }, AUTO_CHECK_INTERVAL_MS);
      autoCheckHandle.unref?.();
    }

    log.info(
      {
        checkIntervalMs: AUTO_CHECK_INTERVAL_MS,
        signatureTrust: INSTALL_POLICY.signatureTrust,
        silentInstall: INSTALL_POLICY.allowSilentInstall,
        installPolicyReason: INSTALL_POLICY.reason,
      },
      'auto-updater initialized (auto mode)'
    );
  } catch (error) {
    log.error({ err: error }, 'failed to initialize auto-updater');

    return updateStatus({
      isAvailable: true,
      state: 'error',
      error: redactAutoUpdaterError(error, t('autoUpdate.initFailed')),
      reason: null,
    });
  }

  return getAutoUpdateStatus();
}

function initNotifyMode(): AutoUpdateStatus {
  initialized = true;

  updateStatus({
    isAvailable: true,
    state: 'idle',
    error: null,
    reason: null,
  });

  // Kick off an initial check + a periodic poll. The poll is the only timer the
  // updater owns; stopAutoUpdater() clears it so it never outlives the app.
  // Both calls are fire-and-forget, so guard against an unhandled rejection
  // (runNotifyCheck should never throw, but a malformed published_at would).
  void runNotifyCheck().catch(err => {
    log.warn({ err }, 'initial notify-only update check failed');
  });
  if (!notifyPollHandle) {
    notifyPollHandle = setInterval(() => {
      void runNotifyCheck().catch(err => {
        log.warn({ err }, 'scheduled notify-only update check failed');
      });
    }, NOTIFY_POLL_INTERVAL_MS);
    // Don't let the poll timer keep the event loop (and thus the process) alive.
    notifyPollHandle.unref?.();
  }

  log.info(
    { pollIntervalMs: NOTIFY_POLL_INTERVAL_MS },
    'auto-updater initialized (notify-only mode)'
  );
  return getAutoUpdateStatus();
}

// ---------------------------------------------------------------------------
// Public API (unchanged surface; consumed by IPC + the renderer card)
// ---------------------------------------------------------------------------

export function getAutoUpdateStatus(): AutoUpdateStatus {
  return { ...autoUpdateStatus };
}

export function refreshAutoUpdateTranslations(): AutoUpdateStatus {
  if (autoUpdateStatus.state !== 'unavailable') {
    return getAutoUpdateStatus();
  }

  return updateStatus({
    reason: getUnavailableReason(),
  });
}

export function initAutoUpdater(): AutoUpdateStatus {
  ensureUpdateHistory();

  if (E2E_UPDATE_SIMULATION) {
    initialized = true;
    activeUpdateFloorVersion = app.getVersion();
    updateStatus({
      isAvailable: true,
      state: pendingDownloadedUpdate ? 'downloaded' : 'idle',
      reason: pendingDownloadedUpdate ? t('autoUpdate.downloadNeedsVerification') : null,
      installReady: false,
      updateFloorVersion: activeUpdateFloorVersion,
    });
    return getAutoUpdateStatus();
  }

  if (!app.isPackaged) {
    return setUnavailable(getUnavailableReason());
  }

  if (!AUTO_UPDATE_ENABLED) {
    return setUnavailable(getUnavailableReason());
  }

  if (!ensureUpdateFloor()) {
    return getAutoUpdateStatus();
  }

  if (INSTALL_MODE === 'auto') {
    if (!SUPPORTED_AUTO_UPDATE_PLATFORMS.has(process.platform)) {
      return setUnavailable(getUnavailableReason());
    }
    return initAutoMode();
  }

  return initNotifyMode();
}

export function checkForAppUpdates(): AutoUpdateStatus | Promise<AutoUpdateStatus> {
  if (!initialized) {
    initAutoUpdater();
  }

  if (!autoUpdateStatus.isAvailable) {
    return getAutoUpdateStatus();
  }

  if (E2E_UPDATE_SIMULATION) {
    if (pendingDownloadedUpdate) {
      reconfirmedArtifactIdentity = `${pendingDownloadedUpdate.version}:${pendingDownloadedUpdate.artifactSha512}`;
      return updateStatus({ installReady: true, reason: null, state: 'downloaded' });
    }
    return getAutoUpdateStatus();
  }

  if (INSTALL_MODE === 'manual') {
    // Await the API check so the caller gets the real result, not a transient
    // "checking" snapshot.
    return runNotifyCheck();
  }

  updateStatus({
    state: 'checking',
    error: null,
    reason: null,
    lastCheckedAt: currentTimestamp(),
  });

  return runAutoCheck('manual auto-update check failed');
}

export function restartToApplyAppUpdate(): AutoUpdateActionResult {
  // Notify-only mode never downloads, so there is nothing to install in-place;
  // the user opens the release page (updateUrl) instead. The renderer hides the
  // restart button in manual mode, so this is a defensive guard.
  if (INSTALL_MODE === 'manual') {
    return {
      success: false,
      error: t('autoUpdate.manualInstallRequired'),
    };
  }

  const expectedIdentity = pendingDownloadedUpdate
    ? `${pendingDownloadedUpdate.version}:${pendingDownloadedUpdate.artifactSha512}`
    : null;
  if (
    autoUpdateStatus.state !== 'downloaded' ||
    !autoUpdateStatus.installReady ||
    expectedIdentity === null ||
    reconfirmedArtifactIdentity !== expectedIdentity
  ) {
    return {
      success: false,
      error:
        autoUpdateStatus.state === 'downloaded'
          ? t('autoUpdate.downloadNeedsVerification')
          : t('autoUpdate.noDownloadedUpdate'),
    };
  }

  if (E2E_UPDATE_SIMULATION) {
    e2eRestartRequested = true;
    return { success: true };
  }

  try {
    autoUpdater.quitAndInstall();
    return { success: true };
  } catch (error) {
    log.error({ err: error }, 'failed to restart into downloaded update');
    return { success: false, error: t('autoUpdate.restartFailed') };
  }
}

export function simulateDownloadedAppUpdateForE2e(version: string): AutoUpdateStatus {
  if (!E2E_UPDATE_SIMULATION || !activeUpdateFloorVersion) {
    throw new Error('E2E updater simulation is unavailable');
  }
  if (!isCandidateAllowedByPolicy(null, version, activeUpdateFloorVersion)) {
    throw new Error('E2E update candidate rejected by version floor');
  }
  const releaseName = `Puntovivo ${version}`;
  const artifactSha512 = Buffer.alloc(64, version).toString('base64');
  const history = recordDownloadedUpdate(
    join(app.getPath('userData'), 'auto-update-history.json'),
    app.getVersion(),
    {
      version,
      artifactSha512,
      releaseName,
      releaseNotes: 'Deterministic Electron updater smoke artifact',
      releaseDate: currentTimestamp(),
      updateUrl: null,
    }
  );
  pendingDownloadedUpdate = history.downloaded;
  reconfirmedArtifactIdentity = `${version}:${artifactSha512}`;
  e2eRestartRequested = false;
  return updateStatus({
    isAvailable: true,
    state: 'downloaded',
    reason: null,
    error: null,
    releaseName,
    releaseNotes: history.downloaded?.releaseNotes ?? null,
    releaseDate: history.downloaded?.releaseDate ?? null,
    updateUrl: null,
    downloadedVersion: version,
    downloadedAt: history.downloaded?.downloadedAt ?? null,
    installReady: true,
  });
}

export function evaluateAppUpdateCandidateForE2e(
  version: string,
  mode: UpdatePolicy['mode']
): boolean {
  if (!E2E_UPDATE_SIMULATION || !activeUpdateFloorVersion) {
    throw new Error('E2E updater simulation is unavailable');
  }
  if (mode !== 'normal' && mode !== 'rollback') {
    throw new Error('invalid E2E update policy mode');
  }
  const policy: UpdatePolicy = {
    schemaVersion: 1,
    mode,
    targetVersion: version,
    rolloutPercentage: mode === 'rollback' ? 100 : 10,
    publishedAt: currentTimestamp(),
  };
  return isCandidateAllowedByPolicy(policy, version, activeUpdateFloorVersion);
}

export function wasAppUpdateRestartRequestedForE2e(): boolean {
  if (!E2E_UPDATE_SIMULATION) throw new Error('E2E updater simulation is unavailable');
  return e2eRestartRequested;
}

/** Subscribe native shell surfaces without exposing an EventEmitter to them. */
export function subscribeAutoUpdateStatus(
  listener: (status: AutoUpdateStatus) => void
): () => void {
  statusListeners.add(listener);
  return () => statusListeners.delete(listener);
}

/** Clear both update timers (notify poll + auto check). Call on app shutdown. */
export function stopAutoUpdater(): void {
  if (notifyPollHandle) {
    clearInterval(notifyPollHandle);
    notifyPollHandle = null;
  }
  if (autoCheckHandle) {
    clearInterval(autoCheckHandle);
    autoCheckHandle = null;
  }
}
