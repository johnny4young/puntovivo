import { app } from 'electron';
import { updateElectronApp, UpdateSourceType } from 'update-electron-app';

/**
 * Auto-Updater Configuration
 *
 * This module sets up automatic updates from GitHub Releases.
 * Auto-updates can be disabled via environment variable: AUTO_UPDATE=false
 *
 * Requirements:
 * - Repository must be public on GitHub
 * - Releases must be tagged with semver (e.g., v1.0.0)
 * - Uses update.electronjs.org as free update server
 */

const AUTO_UPDATE_ENABLED = process.env.AUTO_UPDATE !== 'false';
const UPDATE_INTERVAL = process.env.AUTO_UPDATE_INTERVAL || '1 hour';

/**
 * Initialize the auto-updater
 * Call this in the main process after app.whenReady()
 */
export function initAutoUpdater(): void {
  // Skip auto-update in development mode
  if (!app.isPackaged) {
    console.log('Auto-update disabled in development mode');
    return;
  }

  // Check if auto-update is disabled via environment
  if (!AUTO_UPDATE_ENABLED) {
    console.log('Auto-update disabled via AUTO_UPDATE environment variable');
    return;
  }

  try {
    updateElectronApp({
      updateSource: {
        type: UpdateSourceType.ElectronPublicUpdateService,
        repo: 'johnny4young/open_yojob',
      },
      updateInterval: UPDATE_INTERVAL,
      notifyUser: true,
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
    console.error('Failed to initialize auto-updater:', error);
  }
}
