/** Embedded server state for the renderer: current value, pushes and restart stats. */
import { BrowserWindow, ipcMain } from 'electron';
import type { WorkerRestartStats } from '../server-host/crash-log.ts';
import type { EmbeddedServerState } from '../server-lifecycle.ts';
import { getServerHost } from '../runtime.js';

export const SERVER_STATE_CHANNEL = 'server:state';

export function registerServerStateIpc(deps: {
  getState: () => EmbeddedServerState;
  getRestartStats: () => Promise<WorkerRestartStats>;
}): void {
  ipcMain.handle('server:get-state', () => deps.getState());
  ipcMain.handle('server:get-restart-stats', () => deps.getRestartStats());
  if (process.env.PUNTOVIVO_E2E === '1') {
    ipcMain.handle('e2e:crash-server-worker', () => {
      const host = getServerHost();
      if (!host?.simulateCrash) return { ok: false };
      host.simulateCrash();
      return { ok: true };
    });
  }
}

export function broadcastServerState(state: EmbeddedServerState): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) window.webContents.send(SERVER_STATE_CHANNEL, state);
  }
}
