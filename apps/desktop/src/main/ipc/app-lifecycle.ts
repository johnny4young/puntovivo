/**
 * app metadata / runtime-config / auto-update IPC handlers,
 * extracted verbatim from the former monolithic `main/index.ts`.
 *
 * @module main/ipc/app-lifecycle
 */

import { app, ipcMain } from 'electron';
import { resolveRuntimeConfig } from '@puntovivo/server';
import { checkForAppUpdates, getAutoUpdateStatus, restartToApplyAppUpdate } from '../auto-updater';
import { getServerUrl } from '../runtime.js';

export function registerAppLifecycleIpc(): void {
  ipcMain.handle('get-app-version', () => app.getVersion());
  ipcMain.handle('get-app-path', () => app.getPath('userData'));

  // Runtime config IPC for the renderer. Resolves once per
  // boot (env vars do not change after Electron starts), so the
  // handler is cheap. The renderer reads this synchronously at module
  // init via `ipcRenderer.sendSync('runtime:get-config')` exposed
  // through the preload bridge — synchronous IPC is the only way to
  // make the tRPC base URL deterministic at module init without a
  // chicken-and-egg between auth init and tRPC client construction.
  const cachedRendererRuntimeConfig = (() => {
    const runtime = resolveRuntimeConfig({ env: process.env });
    return {
      authorityMode: runtime.authorityMode,
      hubUrl: runtime.hubUrl,
      siteId: runtime.siteId,
      deviceId: runtime.deviceId,
    };
  })();
  ipcMain.on('runtime:get-config', event => {
    event.returnValue = cachedRendererRuntimeConfig;
  });

  // The fallback string is only returned before the embedded server has
  // started.  — once the server is up, `getUrl()` returns the
  // real bind address resolved from the Authority Node runtime config.
  ipcMain.handle('get-server-url', () => getServerUrl());
  ipcMain.handle('get-auto-update-status', () => getAutoUpdateStatus());
  ipcMain.handle('check-for-app-updates', () => checkForAppUpdates());
  ipcMain.handle('restart-to-apply-app-update', () => restartToApplyAppUpdate());
}
