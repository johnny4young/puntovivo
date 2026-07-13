import { app } from 'electron';
import { autoUpdater, type ProgressInfo, type UpdateInfo } from 'electron-updater';
import { createModuleLogger } from '@puntovivo/server';
import { mapReleaseFields } from './auto-update-status';
import type {
  AutoUpdateActionResult,
  AutoUpdateInstallMode,
  AutoUpdateStatus,
} from './auto-updater/contracts';
import { fetchLatestRelease, isNewerRelease, REPO_SLUG } from './auto-updater/release-notification';
import { t } from './i18n';

export type {
  AutoUpdateActionResult,
  AutoUpdateInstallMode,
  AutoUpdateState,
  AutoUpdateStatus,
} from './auto-updater/contracts';

const log = createModuleLogger('auto-updater');

const AUTO_UPDATE_ENABLED = process.env.AUTO_UPDATE !== 'false';
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

function createDefaultStatus(): AutoUpdateStatus {
  return {
    isAvailable: false,
    state: 'unavailable',
    installMode: INSTALL_MODE,
    currentVersion: app.getVersion(),
    lastCheckedAt: null,
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

  return getAutoUpdateStatus();
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
      ...mapReleaseFields(info, REPO_SLUG),
    });
  });

  autoUpdater.on('update-not-available', () => {
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
    updateStatus({
      isAvailable: true,
      state: 'downloaded',
      error: null,
      reason: null,
      lastCheckedAt: currentTimestamp(),
      ...mapReleaseFields(info, REPO_SLUG),
    });
  });

  autoUpdater.on('error', error => {
    updateStatus({
      isAvailable: initialized,
      state: 'error',
      error: error instanceof Error ? error.message : String(error),
      lastCheckedAt: currentTimestamp(),
    });
  });
}

function initAutoMode(): AutoUpdateStatus {
  attachListeners();
  initialized = true;

  updateStatus({
    isAvailable: true,
    state: 'idle',
    error: null,
    reason: null,
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
    autoUpdater.autoInstallOnAppQuit = true;

    // electron-updater has no built-in poll, so drive the initial check + the
    // interval ourselves (this is what update-electron-app's updateInterval did).
    void autoUpdater.checkForUpdates()?.catch(err => {
      log.warn({ err }, 'initial auto-update check failed');
    });
    if (!autoCheckHandle) {
      autoCheckHandle = setInterval(() => {
        void autoUpdater.checkForUpdates()?.catch(err => {
          log.warn({ err }, 'scheduled auto-update check failed');
        });
      }, AUTO_CHECK_INTERVAL_MS);
      autoCheckHandle.unref?.();
    }

    log.info({ checkIntervalMs: AUTO_CHECK_INTERVAL_MS }, 'auto-updater initialized (auto mode)');
  } catch (error) {
    const message = error instanceof Error ? error.message : t('autoUpdate.initFailed');
    log.error({ err: error }, 'failed to initialize auto-updater');

    return updateStatus({
      isAvailable: true,
      state: 'error',
      error: message,
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
  if (!app.isPackaged) {
    return setUnavailable(getUnavailableReason());
  }

  if (!AUTO_UPDATE_ENABLED) {
    return setUnavailable(getUnavailableReason());
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

  void autoUpdater.checkForUpdates()?.catch(err => {
    log.warn({ err }, 'manual auto-update check failed');
  });
  return getAutoUpdateStatus();
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

  if (autoUpdateStatus.state !== 'downloaded') {
    return {
      success: false,
      error: t('autoUpdate.noDownloadedUpdate'),
    };
  }

  autoUpdater.quitAndInstall();
  return { success: true };
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
