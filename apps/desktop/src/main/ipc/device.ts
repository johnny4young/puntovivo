/**
 * persistent-device-id IPC handlers, extracted verbatim from
 * the former monolithic `main/index.ts`.
 *
 * persistent device id under the user's data folder. The
 * renderer prefers this path over localStorage so a browser cache
 * wipe does not lose the device registration; the localStorage copy
 * stays as a fallback for the pure-browser build. The atomic
 * read/write helpers live in `../device-id-store.ts` so they can be
 * unit-tested without spinning up Electron.
 *
 * @module main/ipc/device
 */

import { app, ipcMain } from 'electron';
import type { createModuleLogger } from '@puntovivo/server';
import { readDeviceIdFromDir, writeDeviceIdToDir } from '../device-id-store.js';
import * as desktopSession from '../session/desktopSession.js';

export interface DeviceIpcDeps {
  /** The `electron-main` module logger owned by index.ts. */
  log: ReturnType<typeof createModuleLogger>;
}

export function registerDeviceIpc(deps: DeviceIpcDeps): void {
  ipcMain.handle('device:get-id', async (): Promise<string | null> => {
    try {
      return await readDeviceIdFromDir(app.getPath('userData'));
    } catch (error) {
      deps.log.warn(
        { err: error, dir: app.getPath('userData') },
        'device:get-id failed reading persisted device id'
      );
      return null;
    }
  });

  ipcMain.handle('device:set-id', async (_event, deviceId: unknown): Promise<void> => {
    // The device id is server-issued during login, which registers the
    // desktop session first (AuthProvider order) — so a pre-login renderer
    // has no business persisting an id. The renderer treats a rejection as
    // non-fatal (localStorage stays authoritative).
    desktopSession.requireTenantId();
    if (typeof deviceId !== 'string' || deviceId.length === 0 || deviceId.length > 256) {
      throw new Error('DEVICE_SET_ID_REJECTED');
    }
    await writeDeviceIdToDir(app.getPath('userData'), deviceId);
  });
}
