/**
 * Electron-free authenticated handler core for the desktop db and sync bridge.
 * `register.ts` injects the persistence operations and binds the returned
 * methods to ipcMain. Session authorization and renderer tenant-hint handling
 * remain fully testable without Electron or a live database.
 *
 * @module main/ipc/data-bridge-handlers
 */

import {
  withAuthenticatedDesktopSession,
  type DesktopSessionAuthorizer,
} from './session-authorization.ts';

interface DataBridgeLogger {
  warn: (bindings: Record<string, unknown>, message: string) => void;
}

type DesktopSyncOperation = 'create' | 'update' | 'delete';

export interface DataBridgeSyncQueueInput {
  entityType: string;
  entityId: string;
  operation: unknown;
  payload?: Record<string, unknown>;
  tenantId?: unknown;
}

export interface NormalizedDataBridgeSyncQueueInput {
  entityType: string;
  entityId: string;
  operation: DesktopSyncOperation;
  payload?: Record<string, unknown>;
  tenantId: string;
}

export interface DataBridgeOperations {
  getAllowedTable: (table: string) => string;
  assertRowBelongsToTenant: (table: string, id: string, tenantId: string) => Promise<void>;
  assertSaleItemWriteBelongsToTenant: (
    data: Record<string, unknown>,
    options: { requireSaleId: boolean },
    tenantId: string
  ) => Promise<void>;
  getAll: (table: string, tenantId: string) => Promise<unknown[]>;
  getById: (table: string, id: string) => Promise<unknown>;
  insert: (table: string, data: Record<string, unknown>) => Promise<unknown>;
  update: (table: string, id: string, data: Record<string, unknown>) => Promise<unknown>;
  delete: (table: string, id: string) => Promise<boolean>;
  getByField: (
    table: string,
    fieldName: string,
    value: unknown,
    tenantId: string
  ) => Promise<unknown[]>;
  deleteByTenant: (table: string, tenantId: string) => Promise<number>;
  countByTenant: (table: string, tenantId: string) => Promise<number>;
  assertSyncOperation: (operation: unknown) => DesktopSyncOperation;
  addToSyncQueue: (input: NormalizedDataBridgeSyncQueueInput) => Promise<void>;
  getPendingSyncItems: (tenantId: string) => Promise<unknown[]>;
  getSyncStatus: (tenantId: string) => Promise<unknown>;
  triggerSync: (tenantId: string) => Promise<unknown>;
  setSyncConfig: (config: Record<string, unknown>) => Promise<unknown>;
}

export interface DataBridgeHandlerDeps {
  session: DesktopSessionAuthorizer;
  log: DataBridgeLogger;
  operations: DataBridgeOperations;
}

export function resolveActiveTenantId(
  sessionTenantId: string,
  rendererTenantIdHint: unknown,
  log: DataBridgeLogger
): string {
  if (
    typeof rendererTenantIdHint === 'string' &&
    rendererTenantIdHint.length > 0 &&
    rendererTenantIdHint !== sessionTenantId
  ) {
    log.warn(
      { sessionTenantId, rendererTenantId: rendererTenantIdHint },
      'ignored renderer-supplied tenantId — desktop session wins'
    );
  }
  return sessionTenantId;
}

export function createDataBridgeHandlers(deps: DataBridgeHandlerDeps) {
  const { operations } = deps;
  const activeTenant = (sessionTenantId: string, hint?: unknown) =>
    resolveActiveTenantId(sessionTenantId, hint, deps.log);

  return {
    getAll: withAuthenticatedDesktopSession(
      deps.session,
      async ({ tenantId }, table: string, rendererTenantId?: unknown) =>
        operations.getAll(table, activeTenant(tenantId, rendererTenantId))
    ),
    getById: withAuthenticatedDesktopSession(
      deps.session,
      async ({ tenantId }, table: string, id: string) => {
        const validatedTable = operations.getAllowedTable(table);
        await operations.assertRowBelongsToTenant(validatedTable, id, tenantId);
        return operations.getById(table, id);
      }
    ),
    insert: withAuthenticatedDesktopSession(
      deps.session,
      async ({ tenantId }, table: string, data: Record<string, unknown>) => {
        const validatedTable = operations.getAllowedTable(table);
        if (validatedTable === 'sale_items') {
          await operations.assertSaleItemWriteBelongsToTenant(
            data,
            { requireSaleId: true },
            tenantId
          );
        }
        const tenantScopedData = {
          ...data,
          tenantId: activeTenant(tenantId, data.tenantId),
        };
        return operations.insert(table, tenantScopedData);
      }
    ),
    update: withAuthenticatedDesktopSession(
      deps.session,
      async ({ tenantId }, table: string, id: string, data: Record<string, unknown>) => {
        const validatedTable = operations.getAllowedTable(table);
        await operations.assertRowBelongsToTenant(validatedTable, id, tenantId);
        if (validatedTable === 'sale_items') {
          await operations.assertSaleItemWriteBelongsToTenant(
            data,
            { requireSaleId: false },
            tenantId
          );
        }
        const tenantScopedData = {
          ...data,
          tenantId: activeTenant(tenantId, data.tenantId),
        };
        return operations.update(table, id, tenantScopedData);
      }
    ),
    delete: withAuthenticatedDesktopSession(
      deps.session,
      async ({ tenantId }, table: string, id: string) => {
        const validatedTable = operations.getAllowedTable(table);
        await operations.assertRowBelongsToTenant(validatedTable, id, tenantId);
        return operations.delete(table, id);
      }
    ),
    getByField: withAuthenticatedDesktopSession(
      deps.session,
      async ({ tenantId }, table: string, fieldName: string, value: unknown) =>
        operations.getByField(table, fieldName, value, tenantId)
    ),
    deleteByTenant: withAuthenticatedDesktopSession(
      deps.session,
      async ({ tenantId }, table: string, rendererTenantId?: unknown) =>
        operations.deleteByTenant(table, activeTenant(tenantId, rendererTenantId))
    ),
    countByTenant: withAuthenticatedDesktopSession(
      deps.session,
      async ({ tenantId }, table: string, rendererTenantId?: unknown) =>
        operations.countByTenant(table, activeTenant(tenantId, rendererTenantId))
    ),
    addToSyncQueue: withAuthenticatedDesktopSession(
      deps.session,
      async ({ tenantId }, item: DataBridgeSyncQueueInput) => {
        const operation = operations.assertSyncOperation(item?.operation);
        const sessionTenantId = activeTenant(tenantId, item?.tenantId);
        return operations.addToSyncQueue({
          ...item,
          operation,
          tenantId: sessionTenantId,
        });
      }
    ),
    getPendingSyncItems: withAuthenticatedDesktopSession(
      deps.session,
      async ({ tenantId }, rendererTenantId?: unknown) =>
        operations.getPendingSyncItems(activeTenant(tenantId, rendererTenantId))
    ),
    getSyncStatus: withAuthenticatedDesktopSession(
      deps.session,
      async ({ tenantId }, rendererTenantId?: unknown) =>
        operations.getSyncStatus(activeTenant(tenantId, rendererTenantId))
    ),
    triggerSync: withAuthenticatedDesktopSession(
      deps.session,
      async ({ tenantId }, rendererTenantId?: unknown) =>
        operations.triggerSync(activeTenant(tenantId, rendererTenantId))
    ),
    setSyncConfig: withAuthenticatedDesktopSession(
      deps.session,
      async (_context, config: Record<string, unknown>) => operations.setSyncConfig(config)
    ),
  };
}
