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
  MAIN_APP_SETTING_KEYS,
  MAIN_INJECT_PATHS,
  MAIN_RECORDED_AUDIT_ACTIONS,
  MAIN_RECORDED_AUDIT_RESOURCE,
  type EmbeddedServerOperations,
  type InjectResponse,
  type MainAuditEvent,
} from './contract.ts';
import { getDesktopSyncStatus, handleDesktopTriggerSync } from './desktop-sync.ts';
import { sqliteOf, upsertAppSetting } from './desktop-sync-helpers.ts';

function isOneOf(list: readonly string[], value: unknown): boolean {
  return typeof value === 'string' && list.includes(value);
}

function assertMainInject(method: unknown, url: string): void {
  const { pathname } = new URL(url, 'http://embedded.invalid');
  if (!isOneOf(['GET', 'POST'], method) || !isOneOf(MAIN_INJECT_PATHS, pathname)) {
    throw new Error('MAIN_INJECT_REJECTED');
  }
}

function assertMainAppSettingKey(key: unknown): void {
  if (!isOneOf(MAIN_APP_SETTING_KEYS, key)) throw new Error('MAIN_APP_SETTING_REJECTED');
}

function ownerRecoveryErrorCode(error: unknown): string {
  const code = (error as { cause?: { errorCode?: unknown } } | null)?.cause?.errorCode;
  return typeof code === 'string' && /^AUTH_[A-Z_]+$/.test(code) ? code : 'INTERNAL_SERVER_ERROR';
}

function assertTenantId(tenantId: unknown): void {
  if (typeof tenantId !== 'string' || tenantId.length === 0) {
    throw new Error('MAIN_TENANT_REQUIRED');
  }
}

function assertMainAuditEvent(event: MainAuditEvent): void {
  const nonEmpty = (value: unknown) => typeof value === 'string' && value.length > 0;
  if (
    !event ||
    !isOneOf(MAIN_RECORDED_AUDIT_ACTIONS, event.action) ||
    !nonEmpty(event.tenantId) ||
    !nonEmpty(event.actorId) ||
    MAIN_RECORDED_AUDIT_RESOURCE[event.action] !== event.resourceType ||
    typeof event.resourceId !== 'string' ||
    typeof event.metadata !== 'object' ||
    event.metadata === null ||
    Array.isArray(event.metadata)
  ) {
    throw new Error('MAIN_AUDIT_EVENT_REJECTED');
  }
}

/** Operations bound to one started server. */
export function createServerOperations(server: PuntovivoServer): EmbeddedServerOperations {
  return {
    async inject(request) {
      assertMainInject(request.method, request.url);
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
      // Only the checked fields reach the chain; the head read, row insert and
      // head upsert stay atomic in this one transaction.
      server.db.transaction(tx =>
        writeAuditLog({
          tx,
          tenantId: event.tenantId,
          actorId: event.actorId,
          action: event.action,
          resourceType: event.resourceType,
          resourceId: event.resourceId,
          metadata: event.metadata,
        })
      );
    },
    async readAppSetting(key) {
      assertMainAppSettingKey(key);
      const row = await server.db
        .select({ value: appSettings.value })
        .from(appSettings)
        .where(eq(appSettings.key, key))
        .get();
      return row?.value;
    },
    async writeAppSetting(key, value) {
      assertMainAppSettingKey(key);
      await upsertAppSetting(server.db, key, value);
    },
    async getSyncStatus(tenantId) {
      assertTenantId(tenantId);
      return getDesktopSyncStatus(server.db, tenantId);
    },
    async triggerSync(tenantId) {
      assertTenantId(tenantId);
      return handleDesktopTriggerSync(server.db, tenantId);
    },
    async readRestoreDrillCounts(tenantId) {
      assertTenantId(tenantId);
      const sqlite = sqliteOf(server.db);
      return sqlite.transaction(() => readTenantRestoreDrillCounts(sqlite, tenantId))();
    },
  };
}
