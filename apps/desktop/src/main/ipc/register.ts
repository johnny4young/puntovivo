/**
 * ENG-178 — the thin registration layer that wires the Electron-free
 * `db:*` / `sync:*` handler bodies (./db.ts, ./sync.ts) to
 * `ipcMain.handle`, extracted verbatim from the former monolithic
 * `main/index.ts`. This is the only place the desktop data bridge
 * touches `electron`, so the handler logic stays unit-testable under
 * `node --test`.
 *
 * @module main/ipc/register
 */

import { ipcMain } from 'electron';
import type { createModuleLogger } from '@puntovivo/server';
import * as desktopSession from '../session/desktopSession.js';
// ENG-178 — desktop database-bridge handlers extracted to ipc/db.ts.
import {
  assertRowBelongsToActiveTenant,
  assertSaleItemWriteBelongsToActiveTenant,
  getAllowedDesktopTable,
  handleDesktopCountByTenant,
  handleDesktopDelete,
  handleDesktopDeleteByTenant,
  handleDesktopGetAll,
  handleDesktopGetById,
  handleDesktopGetByField,
  handleDesktopInsert,
  handleDesktopUpdate,
} from './db.js';
// ENG-178 — desktop sync-bridge handlers extracted to ipc/sync.ts.
import {
  assertDesktopSyncOperation,
  getDesktopSyncStatus,
  handleDesktopAddToSyncQueue,
  handleDesktopGetPendingSyncItems,
  handleDesktopSetSyncConfig,
  handleDesktopTriggerSync,
  type DesktopSyncQueueInput,
} from './sync.js';

export interface DataBridgeIpcDeps {
  /** The `electron-main` module logger owned by index.ts. */
  log: ReturnType<typeof createModuleLogger>;
}

export function registerDataBridgeIpc(deps: DataBridgeIpcDeps): void {
  // ENG-025 vector 1 — every db:* / sync:* handler now derives tenantId
  // from the registered desktopSession instead of trusting the
  // renderer-supplied argument. The legacy renderer call sites still
  // pass a tenantId for backward compatibility while the offlineStorage
  // wrapper is migrated; we accept it but IGNORE it. Mismatches are
  // logged at warn level so a stale renderer surfaces in the operator
  // log instead of silently bypassing the scope.
  function activeTenantId(rendererTenantIdHint?: unknown): string {
    const sessionTenantId = desktopSession.requireTenantId();
    if (
      typeof rendererTenantIdHint === 'string' &&
      rendererTenantIdHint.length > 0 &&
      rendererTenantIdHint !== sessionTenantId
    ) {
      deps.log.warn(
        { sessionTenantId, rendererTenantId: rendererTenantIdHint },
        'ENG-025: ignored renderer-supplied tenantId — desktopSession wins'
      );
    }
    return sessionTenantId;
  }

  ipcMain.handle('db:getAll', async (_event, table: string, rendererTenantId?: unknown) => {
    return handleDesktopGetAll(table, activeTenantId(rendererTenantId));
  });
  ipcMain.handle('db:getById', async (_event, table: string, id: string) => {
    const validatedTable = getAllowedDesktopTable(table);
    await assertRowBelongsToActiveTenant(validatedTable, id);
    return handleDesktopGetById(table, id);
  });
  ipcMain.handle('db:insert', async (_event, table: string, data: Record<string, unknown>) => {
    const validatedTable = getAllowedDesktopTable(table);
    if (validatedTable === 'sale_items') {
      await assertSaleItemWriteBelongsToActiveTenant(data, { requireSaleId: true });
    }
    // Force the tenant scope server-side. Even if the renderer passed a
    // different tenantId (or omitted it) the row lands in the active
    // tenant.
    const tenantScopedData = { ...data, tenantId: activeTenantId(data.tenantId) };
    return handleDesktopInsert(table, tenantScopedData);
  });
  ipcMain.handle(
    'db:update',
    async (_event, table: string, id: string, data: Record<string, unknown>) => {
      const validatedTable = getAllowedDesktopTable(table);
      await assertRowBelongsToActiveTenant(validatedTable, id);
      if (validatedTable === 'sale_items') {
        await assertSaleItemWriteBelongsToActiveTenant(data, { requireSaleId: false });
      }
      // Block tenant migration via update — same rationale as insert.
      const sessionTenantId = activeTenantId(data.tenantId);
      const tenantScopedData = { ...data, tenantId: sessionTenantId };
      return handleDesktopUpdate(table, id, tenantScopedData);
    }
  );
  ipcMain.handle('db:delete', async (_event, table: string, id: string) => {
    const validatedTable = getAllowedDesktopTable(table);
    await assertRowBelongsToActiveTenant(validatedTable, id);
    return handleDesktopDelete(table, id);
  });
  ipcMain.handle(
    'db:getByField',
    async (_event, table: string, fieldName: string, value: unknown) => {
      // Require a registered session even though this op does not take
      // a tenantId argument — without it, the renderer could query
      // arbitrary rows by indexed field across tenants.
      desktopSession.requireTenantId();
      return handleDesktopGetByField(table, fieldName, value);
    }
  );
  ipcMain.handle('db:deleteByTenant', async (_event, table: string, rendererTenantId?: unknown) => {
    return handleDesktopDeleteByTenant(table, activeTenantId(rendererTenantId));
  });
  ipcMain.handle('db:countByTenant', async (_event, table: string, rendererTenantId?: unknown) => {
    return handleDesktopCountByTenant(table, activeTenantId(rendererTenantId));
  });
  ipcMain.handle('db:addToSyncQueue', async (_event, item: DesktopSyncQueueInput) => {
    // SEC-003 — validate the renderer-supplied operation against the
    // allowlist before it reaches the DB; an unrecognised value throws.
    const operation = assertDesktopSyncOperation(item?.operation);
    // Force the tenantId of the queued item to the active session,
    // ignoring whatever the renderer claimed.
    const sessionTenantId = activeTenantId(item?.tenantId);
    return handleDesktopAddToSyncQueue({ ...item, operation, tenantId: sessionTenantId });
  });
  ipcMain.handle('db:getPendingSyncItems', async (_event, rendererTenantId?: unknown) => {
    return handleDesktopGetPendingSyncItems(activeTenantId(rendererTenantId));
  });
  ipcMain.handle('sync:getStatus', async (_event, rendererTenantId?: unknown) => {
    return getDesktopSyncStatus(activeTenantId(rendererTenantId));
  });
  ipcMain.handle('sync:triggerSync', async (_event, rendererTenantId?: unknown) => {
    return handleDesktopTriggerSync(activeTenantId(rendererTenantId));
  });
  ipcMain.handle('sync:setConfig', async (_event, config: Record<string, unknown>) => {
    // No tenant data crosses here, but a registered session is still
    // required so unauthenticated renderer code cannot reconfigure sync.
    desktopSession.requireTenantId();
    return handleDesktopSetSyncConfig(config);
  });
}
