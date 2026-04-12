import { app, autoUpdater, type Event } from 'electron';
import { updateElectronApp, UpdateSourceType } from 'update-electron-app';

const AUTO_UPDATE_ENABLED = process.env.AUTO_UPDATE !== 'false';
const UPDATE_INTERVAL = process.env.AUTO_UPDATE_INTERVAL || '1 hour';
const SUPPORTED_AUTO_UPDATE_PLATFORMS = new Set(['darwin', 'win32']);

export type AutoUpdateState =
  | 'unavailable'
  | 'idle'
  | 'checking'
  | 'available'
  | 'downloaded'
  | 'error';

export interface AutoUpdateStatus {
  isAvailable: boolean;
  state: AutoUpdateState;
  currentVersion: string;
  lastCheckedAt: string | null;
  releaseName: string | null;
  releaseNotes: string | null;
  releaseDate: string | null;
  updateUrl: string | null;
  error: string | null;
  reason: string | null;
}

export interface AutoUpdateActionResult {
  success: boolean;
  error?: string;
}

function createDefaultStatus(): AutoUpdateStatus {
  return {
    isAvailable: false,
    state: 'unavailable',
    currentVersion: app.getVersion(),
    lastCheckedAt: null,
    releaseName: null,
    releaseNotes: null,
    releaseDate: null,
    updateUrl: null,
    error: null,
    reason: 'Automatic updates have not been initialized yet.',
  };
}

let autoUpdateStatus = createDefaultStatus();
let listenersAttached = false;
let initialized = false;

function currentTimestamp(): string {
  return new Date().toISOString();
}

function updateStatus(nextStatus: Partial<AutoUpdateStatus>): AutoUpdateStatus {
  autoUpdateStatus = {
    ...autoUpdateStatus,
    ...nextStatus,
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

export function getAutoUpdateStatus(): AutoUpdateStatus {
  return { ...autoUpdateStatus };
}

export function initAutoUpdater(): AutoUpdateStatus {
  if (!app.isPackaged) {
    return setUnavailable('Automatic updates are unavailable in development builds.');
  }

  if (!AUTO_UPDATE_ENABLED) {
    return setUnavailable('Automatic updates are disabled by the AUTO_UPDATE environment variable.');
  }

  if (!SUPPORTED_AUTO_UPDATE_PLATFORMS.has(process.platform)) {
    return setUnavailable(`Automatic updates are not supported on ${process.platform}.`);
  }

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
        repo: 'johnny4young/puntovivo',
      },
      updateInterval: UPDATE_INTERVAL,
      notifyUser: false,
      logger: {
        log: (...args: unknown[]) => console.log('[Auto-Update]', ...args),
        warn: (...args: unknown[]) => console.warn('[Auto-Update]', ...args),
        error: (...args: unknown[]) => console.error('[Auto-Update]', ...args),
        info: (...args: unknown[]) => console.info('[Auto-Update]', ...args),
      },
    });

    console.log('Auto-updater initialized successfully');
    console.log(`Update interval: ${UPDATE_INTERVAL}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to initialize auto-updater';
    console.error('Failed to initialize auto-updater:', error);

    return updateStatus({
      isAvailable: true,
      state: 'error',
      error: message,
      reason: null,
    });
  }

  return getAutoUpdateStatus();
}

export function checkForAppUpdates(): AutoUpdateStatus {
  if (!initialized) {
    initAutoUpdater();
  }

  if (!autoUpdateStatus.isAvailable) {
    return getAutoUpdateStatus();
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
  if (autoUpdateStatus.state !== 'downloaded') {
    return {
      success: false,
      error: 'No downloaded update is ready to install.',
    };
  }

  autoUpdater.quitAndInstall();
  return { success: true };
}
