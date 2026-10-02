/**
 * Thin Electron registration layer for the authenticated sync bridge.
 * The handler core in data-bridge-handlers.ts owns every authorization and
 * tenant decision; this file only binds it to ipcMain.
 *
 * @module main/ipc/register
 */

import { ipcMain } from 'electron';
import type { createModuleLogger } from '@puntovivo/server';
import * as desktopSession from '../session/desktopSession.js';
import { createDataBridgeHandlers, type DataBridgeOperations } from './data-bridge-handlers.js';
import { captureDesktopIpcSessionResult } from './session-authorization.js';
import {
  getDesktopSyncStatus,
  handleDesktopSetSyncConfig,
  handleDesktopTriggerSync,
} from './sync.js';

export interface DataBridgeIpcDeps {
  /** The electron-main module logger owned by index.ts. */
  log: ReturnType<typeof createModuleLogger>;
}

const dataBridgeOperations: DataBridgeOperations = {
  getSyncStatus: getDesktopSyncStatus,
  triggerSync: handleDesktopTriggerSync,
  setSyncConfig: handleDesktopSetSyncConfig,
};

export function registerDataBridgeIpc(deps: DataBridgeIpcDeps): void {
  const handlers = createDataBridgeHandlers({
    session: desktopSession,
    log: deps.log,
    operations: dataBridgeOperations,
  });

  ipcMain.handle('sync:getStatus', (_event, rendererTenantId?: unknown) =>
    captureDesktopIpcSessionResult(() => handlers.getSyncStatus(rendererTenantId))
  );
  ipcMain.handle('sync:triggerSync', (_event, rendererTenantId?: unknown) =>
    captureDesktopIpcSessionResult(() => handlers.triggerSync(rendererTenantId))
  );
  ipcMain.handle('sync:setConfig', (_event, config: Record<string, unknown>) =>
    captureDesktopIpcSessionResult(() => handlers.setSyncConfig(config))
  );
}
