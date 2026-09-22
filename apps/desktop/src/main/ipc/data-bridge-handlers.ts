/**
 * Electron-free authenticated handler core for the desktop sync bridge.
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

export interface DataBridgeOperations {
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

/** Only sync summaries/configuration remain; domain data uses tRPC. */
export function createDataBridgeHandlers(deps: DataBridgeHandlerDeps) {
  const { operations } = deps;
  const activeTenant = (sessionTenantId: string, hint?: unknown) =>
    resolveActiveTenantId(sessionTenantId, hint, deps.log);

  return {
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
