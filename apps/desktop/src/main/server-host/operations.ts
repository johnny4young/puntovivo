/**
 * Server-side implementation of the host contract. Runs on the thread that
 * owns the server and must never import Electron.
 */
import {
  appSettings,
  eq,
  verifyTokenWithServer,
  writeAuditLog,
  type PuntovivoServer,
} from '@puntovivo/server';
import { readTenantRestoreDrillCounts } from '../backup/backup-bundle/inspection.ts';
import {
  MAIN_RECORDED_AUDIT_ACTIONS,
  MAIN_RECORDED_AUDIT_RESOURCE_TYPES,
  type EmbeddedServerOperations,
  type InjectResponse,
  type MainAuditEvent,
} from './contract.ts';
import {
  getDesktopSyncStatus,
  handleDesktopSetSyncConfig,
  handleDesktopTriggerSync,
} from './desktop-sync.ts';

function ownerRecoveryErrorCode(error: unknown): string {
  const code = (error as { cause?: { errorCode?: unknown } } | null)?.cause?.errorCode;
  return typeof code === 'string' && /^AUTH_[A-Z_]+$/.test(code) ? code : 'INTERNAL_SERVER_ERROR';
}

function assertMainAuditEvent(event: MainAuditEvent): void {
  if (
    !event ||
    !(MAIN_RECORDED_AUDIT_ACTIONS as readonly string[]).includes(event.action) ||
    typeof event.tenantId !== 'string' ||
    typeof event.actorId !== 'string' ||
    !(MAIN_RECORDED_AUDIT_RESOURCE_TYPES as readonly string[]).includes(event.resourceType) ||
    typeof event.resourceId !== 'string'
  ) {
    throw new Error('MAIN_AUDIT_EVENT_REJECTED');
  }
}

/** Operations bound to one started server. */
export function createServerOperations(server: PuntovivoServer): EmbeddedServerOperations {
  return {
    async inject(request) {
      const result = await server.app.inject({
        method: request.method,
        url: request.url,
        headers: request.headers,
        ...(request.payload === undefined ? {} : { payload: request.payload }),
        ...(request.cookies ? { cookies: request.cookies } : {}),
        ...(request.remoteAddress ? { remoteAddress: request.remoteAddress } : {}),
      });
      const headers: InjectResponse['headers'] = {};
      for (const [name, value] of Object.entries(result.headers)) {
        if (value === undefined) continue;
        headers[name] = Array.isArray(value) ? value.map(String) : String(value);
      }
      return { statusCode: result.statusCode, headers, body: result.body };
    },
    async verifyAccessToken(token) {
      const payload = await verifyTokenWithServer(server.app, token, 'access');
      if (!payload) return null;
      return {
        userId: payload.userId,
        tenantId: payload.tenantId,
        email: payload.email,
        role: payload.role,
        sessionVersion: payload.sessionVersion,
      };
    },
    async getSetupToken() {
      return server.getSetupToken();
    },
    async isOwnerRecoveryAvailable() {
      return server.localOwnerRecovery.isAvailable();
    },
    async recoverOwner(input) {
      try {
        await server.localOwnerRecovery.recover(input);
        return { ok: true };
      } catch (error) {
        return { ok: false, errorCode: ownerRecoveryErrorCode(error) };
      }
    },
    async recordAudit(event) {
      assertMainAuditEvent(event);
      // The chain head read, row insert and head upsert must be atomic.
      server.db.transaction(tx => writeAuditLog({ tx, ...event }));
    },
    async readAppSetting(key) {
      const row = await server.db
        .select({ value: appSettings.value })
        .from(appSettings)
        .where(eq(appSettings.key, key))
        .get();
      return row?.value;
    },
    async writeAppSetting(key, value) {
      const updatedAt = new Date().toISOString();
      await server.db
        .insert(appSettings)
        .values({ key, value, updatedAt })
        .onConflictDoUpdate({ target: appSettings.key, set: { value, updatedAt } })
        .run();
    },
    getSyncStatus: tenantId => getDesktopSyncStatus(tenantId),
    triggerSync: tenantId => handleDesktopTriggerSync(tenantId),
    setSyncConfig: config => handleDesktopSetSyncConfig(config),
    async readRestoreDrillCounts(tenantId) {
      const sqlite = (
        server.db as typeof server.db & { $client: import('better-sqlite3').Database }
      ).$client;
      return sqlite.transaction(() => readTenantRestoreDrillCounts(sqlite, tenantId))();
    },
  };
}
