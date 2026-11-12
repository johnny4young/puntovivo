/**
 * The only way main-thread code reaches the embedded server.
 *
 * Every argument and result is structured-clone safe so the same contract can
 * cross a worker boundary. Code that runs next to the server implements it in
 * `operations.ts`; main receives a handle from `server-lifecycle.ts`.
 */

import type { BackupRestoreDrillCounts } from '../backup/backup-bundle/inspection.ts';

/** The routes main may inject; the server side refuses any other. */
export const MAIN_INJECT_PATHS = [
  '/api/trpc/auth.login',
  '/api/trpc/auth.refresh',
  '/api/trpc/auth.switchStaff',
  '/api/trpc/auth.logout',
  '/api/trpc/auth.completeSetup',
  '/api/trpc/health.check',
] as const;

/** The only app_settings rows main reads and writes. */
export const MAIN_APP_SETTING_KEYS = [
  'receipt_print_settings',
  'theme_preference',
  'tray_settings',
] as const;

export type MainAppSettingKey = (typeof MAIN_APP_SETTING_KEYS)[number];

/** A fixed in-process HTTP request; main never gets a general network proxy. */
export interface InjectRequest {
  method: 'GET' | 'POST';
  url: string;
  headers: Record<string, string>;
  payload?: string | Record<string, unknown>;
  cookies?: Record<string, string>;
  remoteAddress?: string;
}

/** Status, headers and the raw body text of an injected request. */
export interface InjectResponse {
  statusCode: number;
  headers: Record<string, string | string[]>;
  body: string;
}

/** Audit events that main records itself; the server validates the list. */
export const MAIN_RECORDED_AUDIT_ACTIONS = [
  'backup.restore_drill',
  'backup.encryption_key_reveal',
  'security.db_key_rotation',
] as const;

export type MainRecordedAuditAction = (typeof MAIN_RECORDED_AUDIT_ACTIONS)[number];

export const MAIN_RECORDED_AUDIT_RESOURCE_TYPES = ['backup_snapshot', 'backup_key'] as const;

export type MainRecordedAuditResourceType = (typeof MAIN_RECORDED_AUDIT_RESOURCE_TYPES)[number];

/** The resource each main-recorded action is about. */
export const MAIN_RECORDED_AUDIT_RESOURCE: Record<
  MainRecordedAuditAction,
  MainRecordedAuditResourceType
> = {
  'backup.restore_drill': 'backup_snapshot',
  'backup.encryption_key_reveal': 'backup_key',
  'security.db_key_rotation': 'backup_key',
};

/** One audit row written in its own transaction, so the hash chain stays atomic. */
export interface MainAuditEvent {
  tenantId: string;
  actorId: string;
  action: MainRecordedAuditAction;
  resourceType: MainRecordedAuditResourceType;
  resourceId: string;
  metadata: Record<string, unknown>;
}

/** Identity of a verified access token, as the desktop session stores it. */
export interface VerifiedAccessToken {
  userId: string;
  tenantId: string;
  email: string;
  role: string;
  sessionVersion: number;
}

/** Only a stable error code ever reaches the renderer. */
export type OwnerRecoveryResult = { ok: true } | { ok: false; errorCode: string };

/** Pending sync work and conflicts for the desktop status badge. */
export interface DesktopSyncStatusResult {
  isOnline: boolean;
  lastSync: string | null;
  pendingItems: number;
  conflicts: number;
}

/** Outcome of draining the local sync queue once. */
export interface DesktopSyncTriggerResult extends DesktopSyncStatusResult {
  success: boolean;
  synced: number;
  errors: string[];
}

/** Every operation main may ask of the server. */
export interface EmbeddedServerOperations {
  inject(request: InjectRequest): Promise<InjectResponse>;
  verifyAccessToken(token: string): Promise<VerifiedAccessToken | null>;
  /** Launcher-only first-run capability; null once an owner exists. */
  getSetupToken(): Promise<string | null>;
  isOwnerRecoveryAvailable(): Promise<boolean>;
  recoverOwner(input: unknown): Promise<OwnerRecoveryResult>;
  recordAudit(event: MainAuditEvent): Promise<void>;
  readAppSetting(key: MainAppSettingKey): Promise<unknown>;
  writeAppSetting(key: MainAppSettingKey, value: unknown): Promise<void>;
  getSyncStatus(tenantId: string): Promise<DesktopSyncStatusResult>;
  triggerSync(tenantId: string): Promise<DesktopSyncTriggerResult>;
  setSyncConfig(config: Record<string, unknown>): Promise<void>;
  /** Live row counts of the restore-drill tables for one tenant. */
  readRestoreDrillCounts(tenantId: string): Promise<BackupRestoreDrillCounts>;
}

/** A started server as main sees it. */
export interface EmbeddedServerHost extends EmbeddedServerOperations {
  readonly url: string;
  close(): Promise<void>;
  /** Present only in E2E and soak runs: makes the worker throw an uncaught error. */
  simulateCrash?: () => void;
}
