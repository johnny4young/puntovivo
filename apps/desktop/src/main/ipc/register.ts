/**
 * Thin Electron registration layer for the authenticated db and sync bridge.
 * The handler core in data-bridge-handlers.ts owns every authorization and
 * tenant decision; this file only binds it to ipcMain.
 *
 * @module main/ipc/register
 */

import { ipcMain } from 'electron';
import type { createModuleLogger } from '@puntovivo/server';
import * as desktopSession from '../session/desktopSession.js';
import {
  createDataBridgeHandlers,
  type DataBridgeOperations,
  type DataBridgeSyncQueueInput,
} from './data-bridge-handlers.js';
import { captureDesktopIpcSessionResult } from './session-authorization.js';
import {
  assertRowBelongsToTenant,
  assertSaleItemWriteBelongsToTenant,
  getAllowedDesktopTable,
  handleDesktopCountByTenant,
  handleDesktopDelete,
  handleDesktopDeleteByTenant,
  handleDesktopGetAll,
  handleDesktopGetByField,
  handleDesktopGetById,
  handleDesktopInsert,
  handleDesktopUpdate,
} from './db.js';
import {
  assertDesktopSyncOperation,
  getDesktopSyncStatus,
  handleDesktopAddToSyncQueue,
  handleDesktopGetPendingSyncItems,
  handleDesktopSetSyncConfig,
  handleDesktopTriggerSync,
} from './sync.js';

export interface DataBridgeIpcDeps {
  /** The electron-main module logger owned by index.ts. */
  log: ReturnType<typeof createModuleLogger>;
}

const dataBridgeOperations: DataBridgeOperations = {
  getAllowedTable: getAllowedDesktopTable,
  assertRowBelongsToTenant: (table, id, tenantId) =>
    assertRowBelongsToTenant(getAllowedDesktopTable(table), id, tenantId),
  assertSaleItemWriteBelongsToTenant,
  getAll: handleDesktopGetAll,
  getById: handleDesktopGetById,
  insert: handleDesktopInsert,
  update: handleDesktopUpdate,
  delete: handleDesktopDelete,
  getByField: handleDesktopGetByField,
  deleteByTenant: handleDesktopDeleteByTenant,
  countByTenant: handleDesktopCountByTenant,
  assertSyncOperation: assertDesktopSyncOperation,
  addToSyncQueue: handleDesktopAddToSyncQueue,
  getPendingSyncItems: handleDesktopGetPendingSyncItems,
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

  ipcMain.handle('db:getAll', (_event, table: string, rendererTenantId?: unknown) =>
    captureDesktopIpcSessionResult(() => handlers.getAll(table, rendererTenantId))
  );
  ipcMain.handle('db:getById', (_event, table: string, id: string) =>
    captureDesktopIpcSessionResult(() => handlers.getById(table, id))
  );
  ipcMain.handle('db:insert', (_event, table: string, data: Record<string, unknown>) =>
    captureDesktopIpcSessionResult(() => handlers.insert(table, data))
  );
  ipcMain.handle('db:update', (_event, table: string, id: string, data: Record<string, unknown>) =>
    captureDesktopIpcSessionResult(() => handlers.update(table, id, data))
  );
  ipcMain.handle('db:delete', (_event, table: string, id: string) =>
    captureDesktopIpcSessionResult(() => handlers.delete(table, id))
  );
  ipcMain.handle('db:getByField', (_event, table: string, fieldName: string, value: unknown) =>
    captureDesktopIpcSessionResult(() => handlers.getByField(table, fieldName, value))
  );
  ipcMain.handle('db:deleteByTenant', (_event, table: string, rendererTenantId?: unknown) =>
    captureDesktopIpcSessionResult(() => handlers.deleteByTenant(table, rendererTenantId))
  );
  ipcMain.handle('db:countByTenant', (_event, table: string, rendererTenantId?: unknown) =>
    captureDesktopIpcSessionResult(() => handlers.countByTenant(table, rendererTenantId))
  );
  ipcMain.handle('db:addToSyncQueue', (_event, item: DataBridgeSyncQueueInput) =>
    captureDesktopIpcSessionResult(() => handlers.addToSyncQueue(item))
  );
  ipcMain.handle('db:getPendingSyncItems', (_event, rendererTenantId?: unknown) =>
    captureDesktopIpcSessionResult(() => handlers.getPendingSyncItems(rendererTenantId))
  );
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
