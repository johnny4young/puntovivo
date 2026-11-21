/** Binds the scale IPC core to ipcMain; one serial read at a time on this device. */
import { app, ipcMain } from 'electron';
import { join } from 'node:path';
import * as desktopSession from '../session/desktopSession.js';
import { createScalePreferences } from '../scale/preferences.js';
import { readScaleWeight } from '../scale/reader.js';
import { listSerialPorts, loadSerialBinding, openSerialScalePort } from '../scale/serial-port.js';
import type { ScaleConfig, ScaleReadResult } from '../scale/protocol.js';
import { captureDesktopIpcSessionResult } from './session-authorization.js';
import {
  getScaleSettings,
  getScaleStatus,
  readScale,
  saveScaleSettings,
  testScale,
  type ScaleDependencies,
} from './scale-handlers.js';

export function registerScaleIpc(): void {
  const preferences = createScalePreferences(join(app.getPath('userData'), 'scale-preferences'));
  let queue: Promise<unknown> = Promise.resolve();
  // Two reads on one serial port would interleave their frames.
  const readWeight = (config: ScaleConfig): Promise<ScaleReadResult> => {
    const next = queue.then(() => readScaleWeight(config, openSerialScalePort));
    queue = next.catch(() => {});
    return next;
  };
  const deps: ScaleDependencies = {
    session: desktopSession,
    captureSession: desktopSession.captureSessionGuard,
    driverAvailable: async () => (await loadSerialBinding()) !== null,
    listPorts: listSerialPorts,
    read: preferences.read,
    write: preferences.write,
    readWeight,
  };

  ipcMain.handle('scale:get-status', () =>
    captureDesktopIpcSessionResult(() => getScaleStatus(deps))
  );
  ipcMain.handle('scale:get-settings', () =>
    captureDesktopIpcSessionResult(() => getScaleSettings(deps))
  );
  ipcMain.handle('scale:save-settings', (_event, config: unknown) =>
    captureDesktopIpcSessionResult(() => saveScaleSettings(config, deps))
  );
  ipcMain.handle('scale:test', (_event, config: unknown) =>
    captureDesktopIpcSessionResult(() => testScale(config, deps))
  );
  ipcMain.handle('scale:read', () => captureDesktopIpcSessionResult(() => readScale(deps)));
}
