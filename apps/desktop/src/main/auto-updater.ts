import { app, autoUpdater, type Event } from 'electron';
import { updateElectronApp, UpdateSourceType } from 'update-electron-app';
import { createModuleLogger } from '@puntovivo/server';
import { t } from './i18n';
import { isNewerVersion } from './version-compare';

const log = createModuleLogger('auto-updater');

const AUTO_UPDATE_ENABLED = process.env.AUTO_UPDATE !== 'false';
const UPDATE_INTERVAL = process.env.AUTO_UPDATE_INTERVAL || '1 hour';
const SUPPORTED_AUTO_UPDATE_PLATFORMS = new Set(['darwin', 'win32']);

// Release repository coordinates. The auto-updater runs in one of two modes,
// chosen by REPO_IS_PRIVATE so the SAME code works whether the repo is closed
// or open source:
//
//   - PRIVATE (default, today): GitHub's public update service
//     (update.electronjs.org / Squirrel) cannot see a private repo's releases,
//     so we run a NOTIFY-ONLY mode — poll the Releases API, surface the new
//     version, and let the user download it from the release page. No binary is
//     auto-downloaded, so no credentials are ever embedded in the client.
//   - PUBLIC (PUNTOVIVO_UPDATE_REPO_PRIVATE=false): the existing Squirrel
//     auto-download path takes over (update.electronjs.org), which only works on
//     public repos. Flipping the env flag is the ONLY change needed when the
//     source is released — no code edit.
const REPO_OWNER = 'johnny4young';
const REPO_NAME = 'puntovivo';
const REPO_SLUG = `${REPO_OWNER}/${REPO_NAME}`;
const REPO_IS_PRIVATE = process.env.PUNTOVIVO_UPDATE_REPO_PRIVATE !== 'false';

// Optional read-only token so the notify-only check can reach a PRIVATE repo's
// Releases API (internal / QA builds set it in the environment). It is NEVER
// embedded in the bundle; a distributed private build without it simply reports
// "requires repo access" rather than failing loudly. A public repo needs no
// token at all.
const UPDATE_READ_TOKEN =
  process.env.PUNTOVIVO_UPDATE_TOKEN || process.env.GH_TOKEN || undefined;

const NOTIFY_POLL_INTERVAL_MS = 60 * 60 * 1000; // 1h, mirrors the prior '1 hour'
const RELEASE_FETCH_TIMEOUT_MS = 15_000;

export type AutoUpdateState =
  | 'unavailable'
  | 'idle'
  | 'checking'
  | 'available'
  | 'downloaded'
  | 'error';

/**
 * How an available update is delivered to the user:
 *   - `auto`: Squirrel downloads + installs in the background (public repo).
 *   - `manual`: the updater only detects + notifies; the user downloads the
 *     release themselves (private repo, notify-only mode).
 */
export type AutoUpdateInstallMode = 'auto' | 'manual';

export interface AutoUpdateStatus {
  isAvailable: boolean;
  state: AutoUpdateState;
  /** Whether updates install automatically (`auto`) or are user-driven (`manual`). */
  installMode: AutoUpdateInstallMode;
  currentVersion: string;
  lastCheckedAt: string | null;
  releaseName: string | null;
  releaseNotes: string | null;
  releaseDate: string | null;
  /** In `manual` mode this is the release PAGE the user opens to download. */
  updateUrl: string | null;
  error: string | null;
  reason: string | null;
}

export interface AutoUpdateActionResult {
  success: boolean;
  error?: string;
}

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

// ---------------------------------------------------------------------------
// Notify-only mode (private repo): poll the Releases API, never download
// ---------------------------------------------------------------------------

type LatestReleaseResult =
  | { kind: 'ok'; version: string; name: string; notes: string | null; date: string | null; url: string }
  | { kind: 'inaccessible' }
  | { kind: 'error'; message: string };

async function fetchLatestRelease(): Promise<LatestReleaseResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), RELEASE_FETCH_TIMEOUT_MS);
  try {
    const headers: Record<string, string> = {
      'User-Agent': 'puntovivo-desktop',
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    };
    if (UPDATE_READ_TOKEN) {
      headers.Authorization = `Bearer ${UPDATE_READ_TOKEN}`;
    }
    const response = await fetch(`https://api.github.com/repos/${REPO_SLUG}/releases/latest`, {
      headers,
      signal: controller.signal,
    });
    // GitHub returns 404 (not 401/403) for a private repo the caller cannot see.
    if (response.status === 404) {
      return { kind: 'inaccessible' };
    }
    if (!response.ok) {
      return { kind: 'error', message: `GitHub API responded ${response.status}` };
    }
    const payload = (await response.json()) as {
      tag_name?: string;
      name?: string;
      body?: string;
      published_at?: string;
      html_url?: string;
    };
    if (!payload.tag_name) {
      return { kind: 'error', message: 'malformed release payload (no tag_name)' };
    }
    return {
      kind: 'ok',
      version: payload.tag_name,
      name: payload.name || payload.tag_name,
      notes: payload.body || null,
      date: payload.published_at || null,
      url: payload.html_url || `https://github.com/${REPO_SLUG}/releases/latest`,
    };
  } catch (error) {
    return { kind: 'error', message: error instanceof Error ? error.message : String(error) };
  } finally {
    clearTimeout(timeout);
  }
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

  if (isNewerVersion(result.version, app.getVersion())) {
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
// Auto mode (public repo): Squirrel background download + install
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

  autoUpdater.on('update-available', () => {
    updateStatus({
      isAvailable: true,
      state: 'available',
      error: null,
      reason: null,
      lastCheckedAt: currentTimestamp(),
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

  autoUpdater.on(
    'update-downloaded',
    (
      _event: Event,
      releaseNotes: string,
      releaseName: string,
      releaseDate: Date | string,
      updateURL: string
    ) => {
      updateStatus({
        isAvailable: true,
        state: 'downloaded',
        error: null,
        reason: null,
        lastCheckedAt: currentTimestamp(),
        releaseName,
        releaseNotes,
        releaseDate:
          releaseDate instanceof Date ? releaseDate.toISOString() : new Date(releaseDate).toISOString(),
        updateUrl: updateURL,
      });
    }
  );

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
    updateElectronApp({
      updateSource: {
        type: UpdateSourceType.ElectronPublicUpdateService,
        repo: REPO_SLUG,
      },
      updateInterval: UPDATE_INTERVAL,
      notifyUser: false,
      // update-electron-app expects a subset of a console-like interface
      // (log, warn, error, info). pino's child logger satisfies each of
      // those signatures, so the module logger threads directly into the
      // library's internal diagnostics and everything flows through the
      // shared NDJSON stream with module="auto-updater".
      logger: {
        log: (...args: unknown[]) => log.info({ args }, 'auto-update log'),
        warn: (...args: unknown[]) => log.warn({ args }, 'auto-update warn'),
        error: (...args: unknown[]) => log.error({ args }, 'auto-update error'),
        info: (...args: unknown[]) => log.info({ args }, 'auto-update info'),
      },
    });

    log.info({ updateInterval: UPDATE_INTERVAL }, 'auto-updater initialized (auto mode)');
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

  log.info({ pollIntervalMs: NOTIFY_POLL_INTERVAL_MS }, 'auto-updater initialized (notify-only mode)');
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

  autoUpdater.checkForUpdates();
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

/** Clear the notify-only poll timer. Call on app shutdown. */
export function stopAutoUpdater(): void {
  if (notifyPollHandle) {
    clearInterval(notifyPollHandle);
    notifyPollHandle = null;
  }
}
