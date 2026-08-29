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
import { createDeviceHandlers } from './device-handlers.js';
import { captureDesktopIpcSessionResult } from './session-authorization.js';

export interface DeviceIpcDeps {
  /** The `electron-main` module logger owned by index.ts. */
  log: ReturnType<typeof createModuleLogger>;
}

export function registerDeviceIpc(deps: DeviceIpcDeps): void {
  const handlers = createDeviceHandlers({
    session: desktopSession,
    getUserDataPath: () => app.getPath('userData'),
    readDeviceId: readDeviceIdFromDir,
    writeDeviceId: writeDeviceIdToDir,
    log: deps.log,
  });

  ipcMain.handle('device:get-id', () => handlers.getId());

  ipcMain.handle('device:set-id', async (_event, deviceId: unknown) => {
    return captureDesktopIpcSessionResult(() => handlers.setId(deviceId));
  });
}
