import { contextBridge, ipcRenderer } from 'electron';
import type { BackupProtectionStatus } from '../main/backup-protection.js';
import type {
  BackupCloudVaultConfigInput,
  BackupCloudVaultErrorCode,
  BackupCloudVaultStatus,
} from '../main/backup/cloud-vault.js';
import type { BackupRestoreDrillReport } from '../main/backup/restore-drill.js';
import type { BackupScheduleFrequency, BackupScheduleStatus } from '../main/backup/scheduler.js';
import type {
  HubAccessGrant,
  HubApiRequest,
  HubApiResponse,
  HubAuthIpcResult,
  HubLoginInput,
  HubSwitchStaffInput,
} from '../main/session/hub-auth-session.js';

// Type definitions for exposed API
export interface ElectronAPI {
  getAppVersion: () => Promise<string>;
  getAppPath: () => Promise<string>;
  getServerUrl: () => Promise<string>;
  getAutoUpdateStatus: () => Promise<{
    isAvailable: boolean;
    state: 'unavailable' | 'idle' | 'checking' | 'available' | 'downloaded' | 'error';
    installMode: 'auto' | 'manual';
    currentVersion: string;
    lastCheckedAt: string | null;
    lastUpdatedAt: string | null;
    rolloutMode: 'normal' | 'rollback' | null;
    rolloutPercentage: 10 | 50 | 100 | null;
    rolloutTargetVersion: string | null;
    rolloutPolicyCheckedAt: string | null;
    releaseName: string | null;
    releaseNotes: string | null;
    releaseDate: string | null;
    updateUrl: string | null;
    error: string | null;
    reason: string | null;
  }>;
  checkForAppUpdates: () => Promise<{
    isAvailable: boolean;
    state: 'unavailable' | 'idle' | 'checking' | 'available' | 'downloaded' | 'error';
    installMode: 'auto' | 'manual';
    currentVersion: string;
    lastCheckedAt: string | null;
    lastUpdatedAt: string | null;
    rolloutMode: 'normal' | 'rollback' | null;
    rolloutPercentage: 10 | 50 | 100 | null;
    rolloutTargetVersion: string | null;
    rolloutPolicyCheckedAt: string | null;
    releaseName: string | null;
    releaseNotes: string | null;
    releaseDate: string | null;
    updateUrl: string | null;
    error: string | null;
    reason: string | null;
  }>;
  restartToApplyAppUpdate: () => Promise<{
    success: boolean;
    error?: string;
  }>;
  getTraySettings: () => Promise<{
    enabled: boolean;
    closeToTray: boolean;
  }>;
  updateTraySettings: (settings: { enabled: boolean; closeToTray: boolean }) => Promise<{
    enabled: boolean;
    closeToTray: boolean;
  }>;
  getThemePreference: () => Promise<'light' | 'dark' | 'system'>;
  updateThemePreference: (
    preference: 'light' | 'dark' | 'system'
  ) => Promise<'light' | 'dark' | 'system'>;
  getReceiptPrintSettings: () => Promise<{
    silent: boolean;
    printBackground: boolean;
  }>;
  updateReceiptPrintSettings: (settings: { silent: boolean; printBackground: boolean }) => Promise<{
    silent: boolean;
    printBackground: boolean;
  }>;
  createDatabaseBackup: () => Promise<{
    success: boolean;
    cancelled: boolean;
    path?: string;
    error?: string;
  }>;
  restoreDatabaseBackup: () => Promise<{
    success: boolean;
    cancelled: boolean;
    path?: string;
    error?: string;
    /**
     * the selected bundle is encrypted with a DIFFERENT
     * device's key; the renderer must prompt for it and complete the
     * restore via `provideRestoreKey(token, keyHex)`.
     */
    needsKey?: boolean;
    token?: string;
  }>;
  /**
   * complete a cross-device restore with the SOURCE
   * device's 64-hex backup key. A wrong key returns
   * `{ needsKey: true, error }` and keeps the staged bundle so the
   * operator can retry.
   */
  provideRestoreKey: (
    token: string,
    keyHex: string
  ) => Promise<{
    success: boolean;
    cancelled: boolean;
    path?: string;
    error?: string;
    needsKey?: boolean;
    token?: string;
  }>;
  /**
   * discard the pending cross-device restore staging when
   * the operator dismisses the key prompt. A stale token is a silent
   * no-op (`success: false`).
   */
  cancelRestoreStaging: (token: string) => Promise<{ success: boolean }>;
  /**
   * reveal THIS install's backup encryption key (admin
   * only; the renderer gates the reveal behind an explicit
   * confirmation). Needed to restore this device's bundles on
   * another machine.
   */
  getBackupEncryptionKey: () => Promise<{
    success: boolean;
    key?: string;
    error?: string;
  }>;
  /** admin-only protection metadata; never includes the key. */
  getBackupProtectionStatus: () => Promise<{
    success: boolean;
    status?: BackupProtectionStatus;
    error?: string;
  }>;
  /** device-local encrypted snapshot schedule. */
  getBackupScheduleStatus: () => Promise<{
    success: boolean;
    status?: BackupScheduleStatus;
    error?: string;
  }>;
  updateBackupSchedule: (input: {
    frequency: BackupScheduleFrequency;
    destinationMode?: 'managed';
  }) => Promise<{
    success: boolean;
    status?: BackupScheduleStatus;
    error?: string;
  }>;
  chooseBackupScheduleDestination: () => Promise<{
    success: boolean;
    status?: BackupScheduleStatus;
    cancelled?: boolean;
    error?: string;
  }>;
  runBackupSnapshotNow: () => Promise<{
    success: boolean;
    status?: BackupScheduleStatus;
    error?: string;
  }>;
  /** admin-only, non-destructive restore readiness drill. */
  runBackupRestoreDrill: () => Promise<
    | { success: true; report: BackupRestoreDrillReport }
    | { success: false; error: 'snapshot_unavailable' | 'drill_failed' }
  >;
  /** admin-only S3-compatible backup vault; secrets are write-only. */
  getBackupCloudVaultStatus: () => Promise<{
    success: boolean;
    status?: BackupCloudVaultStatus;
    error?: BackupCloudVaultErrorCode;
  }>;
  configureBackupCloudVault: (input: BackupCloudVaultConfigInput) => Promise<{
    success: boolean;
    status?: BackupCloudVaultStatus;
    error?: BackupCloudVaultErrorCode;
  }>;
  disconnectBackupCloudVault: () => Promise<{
    success: boolean;
    status?: BackupCloudVaultStatus;
    error?: BackupCloudVaultErrorCode;
  }>;
  testBackupCloudVault: () => Promise<{
    success: boolean;
    status?: BackupCloudVaultStatus;
    error?: BackupCloudVaultErrorCode;
  }>;
  printReceipt: (receiptHtml: string) => Promise<{ success: boolean; error?: string }>;
  updateMainLocale: (locale: string) => Promise<'en' | 'es'>;
  device: DeviceAPI;
  runtime: RuntimeAPI;
  peripherals: PeripheralsAPI;
}

/**
 * Hub-client local hardware bridge API. The renderer in
 * `authorityMode === 'hub_client'` fetches ESC/POS bytes from the
 * hub and pipes them here so the main process can write them to the
 * locally-attached printer / drawer. Per ADR-0008 rule 6 the bridge
 * NEVER touches operational tables; the IPC payload is just bytes
 * + transport hint.
 */
export interface LocalEscPosTransportHint {
  channel: 'usb' | 'tcp' | 'serial' | 'mock';
  host?: string | null;
  port?: number | null;
  vendorId?: number | null;
  productId?: number | null;
  devicePath?: string | null;
  timeoutMs?: number | null;
}

export interface PeripheralsAPI {
  dispatchLocalEscpos: (payload: {
    bytes: number[];
    transport: LocalEscPosTransportHint;
  }) => Promise<{ success: boolean; error?: string; errorCode?: string }>;
}

/**
 * Authority Node runtime config exposed to the renderer
 * synchronously so `apps/web/src/lib/trpc.ts` can resolve the tRPC
 * base URL at module init (the alternative — async fetch — would
 * race against the first tRPC call). The shape mirrors the server's
 * `RuntimeConfig` projection used by /api/health, minus the bind
 * surface (the renderer never needs `bindHost` / `bindPort` because
 * it talks to the URL it was told to talk to, not to its own bind).
 */
export interface RendererRuntimeConfig {
  authorityMode: 'device_local' | 'site_hub' | 'hub_client';
  hubUrl: string | null;
  siteId: string | null;
  deviceId: string | null;
}

export interface RuntimeAPI {
  getConfigSync: () => RendererRuntimeConfig;
}

/**
 * Persistent device id under the user's data folder. The
 * id is server-issued by `auth.registerDevice`; the renderer caches
 * it in localStorage AND mirrors it here so a localStorage clear
 * does not lose the registration.
 *
 * The renderer accesses this via
 * `(window.electron.device).getId/setId` — see
 * `apps/web/src/lib/deviceId.ts`.
 */
export interface DeviceAPI {
  getId: () => Promise<string | null>;
  setId: (id: string) => Promise<void>;
}

/**
 * vector 1 — the `tenantId` argument is no longer accepted on
 * tenant-scoped methods. Main process derives it from the registered
 * desktopSession (set via `session.register` after login). Legacy
 * arities are kept marked deprecated for one release so the
 * IndexedDB browser fallback can keep its current call shape; the
 * Electron path drops them.
 */
export interface DatabaseAPI {
  getAll: (table: string) => Promise<unknown[]>;
  getById: (table: string, id: string) => Promise<unknown>;
  insert: (table: string, data: Record<string, unknown>) => Promise<unknown>;
  update: (table: string, id: string, data: Record<string, unknown>) => Promise<unknown>;
  delete: (table: string, id: string) => Promise<boolean>;
  getByField: (table: string, fieldName: string, value: unknown) => Promise<unknown[]>;
  deleteByTenant: (table: string) => Promise<number>;
  countByTenant: (table: string) => Promise<number>;
  addToSyncQueue: (item: Record<string, unknown>) => Promise<void>;
  getPendingSyncItems: () => Promise<unknown[]>;
}

export interface SyncAPI {
  getStatus: () => Promise<{
    isOnline: boolean;
    lastSync: string | null;
    pendingItems: number;
    conflicts: number;
  }>;
  triggerSync: () => Promise<{
    success: boolean;
    synced: number;
    errors: string[];
    isOnline: boolean;
    lastSync: string | null;
    pendingItems: number;
    conflicts: number;
  }>;
  setConfig: (config: Record<string, unknown>) => Promise<void>;
}

/**
 * vector 1 — desktop session lifecycle. Renderer's
 * AuthProvider calls `register(accessToken)` after a successful login
 * (and after every successful `auth.refresh` rotation), and `clear()`
 * after logout. Until `register` succeeds, every `db.*` / `sync.*`
 * call rejects with `SESSION_NOT_REGISTERED`.
 */
export interface SessionAPI {
  register: (accessToken: string) => Promise<{ ok: true }>;
  clear: () => Promise<{ ok: true }>;
  loginHub: (input: HubLoginInput) => Promise<HubAuthIpcResult<HubAccessGrant>>;
  refreshHub: () => Promise<HubAuthIpcResult<HubAccessGrant>>;
  switchStaffHub: (input: HubSwitchStaffInput) => Promise<HubAuthIpcResult<HubAccessGrant>>;
  logoutHub: () => Promise<HubAuthIpcResult<{ ok: true }>>;
  requestHub: (input: HubApiRequest) => Promise<HubApiResponse>;
  clearHub: () => Promise<{ ok: true }>;
}

export interface DesktopBridgeAPI extends ElectronAPI {
  db: DatabaseAPI;
  sync: SyncAPI;
  session: SessionAPI;
}

const deviceAPI: DeviceAPI = {
  getId: () => ipcRenderer.invoke('device:get-id'),
  setId: (id: string) => ipcRenderer.invoke('device:set-id', id),
};

// sync IPC for runtime config so the renderer's tRPC client
// can pick the right base URL at module init. The handler in main is
// `ipcMain.on('runtime:get-config', e => e.returnValue = config)`,
// resolved once at boot and cached.
const runtimeAPI: RuntimeAPI = {
  getConfigSync: () => ipcRenderer.sendSync('runtime:get-config') as RendererRuntimeConfig,
};

// Hub-client local hardware bridge API. Async IPC; the
// main side calls `dispatchLocalEscpos` from the local-bridge
// module which writes the bytes to the resolved transport. Returns
// {success, error?, errorCode?} so the renderer can surface a
// translatable toast on failure.
const peripheralsAPI: PeripheralsAPI = {
  dispatchLocalEscpos: payload => ipcRenderer.invoke('peripherals:dispatch-local-escpos', payload),
};

// Custom APIs for renderer
const electronAPI: ElectronAPI = {
  getAppVersion: () => ipcRenderer.invoke('get-app-version'),
  getAppPath: () => ipcRenderer.invoke('get-app-path'),
  getServerUrl: () => ipcRenderer.invoke('get-server-url'),
  getAutoUpdateStatus: () => ipcRenderer.invoke('get-auto-update-status'),
  checkForAppUpdates: () => ipcRenderer.invoke('check-for-app-updates'),
  restartToApplyAppUpdate: () => ipcRenderer.invoke('restart-to-apply-app-update'),
  getTraySettings: () => ipcRenderer.invoke('get-tray-settings'),
  updateTraySettings: settings => ipcRenderer.invoke('update-tray-settings', settings),
  getThemePreference: () => ipcRenderer.invoke('get-theme-preference'),
  updateThemePreference: preference => ipcRenderer.invoke('update-theme-preference', preference),
  getReceiptPrintSettings: () => ipcRenderer.invoke('get-receipt-print-settings'),
  updateReceiptPrintSettings: settings =>
    ipcRenderer.invoke('update-receipt-print-settings', settings),
  createDatabaseBackup: () => ipcRenderer.invoke('create-database-backup'),
  restoreDatabaseBackup: () => ipcRenderer.invoke('restore-database-backup'),
  provideRestoreKey: (token, keyHex) => ipcRenderer.invoke('provide-restore-key', token, keyHex),
  cancelRestoreStaging: token => ipcRenderer.invoke('cancel-restore-staging', token),
  getBackupEncryptionKey: () => ipcRenderer.invoke('get-backup-encryption-key'),
  getBackupProtectionStatus: () => ipcRenderer.invoke('get-backup-protection-status'),
  getBackupScheduleStatus: () => ipcRenderer.invoke('get-backup-schedule-status'),
  updateBackupSchedule: input => ipcRenderer.invoke('update-backup-schedule', input),
  chooseBackupScheduleDestination: () => ipcRenderer.invoke('choose-backup-schedule-destination'),
  runBackupSnapshotNow: () => ipcRenderer.invoke('run-backup-snapshot-now'),
  runBackupRestoreDrill: () => ipcRenderer.invoke('run-backup-restore-drill'),
  getBackupCloudVaultStatus: () => ipcRenderer.invoke('get-backup-cloud-vault-status'),
  configureBackupCloudVault: input => ipcRenderer.invoke('configure-backup-cloud-vault', input),
  disconnectBackupCloudVault: () => ipcRenderer.invoke('disconnect-backup-cloud-vault'),
  testBackupCloudVault: () => ipcRenderer.invoke('test-backup-cloud-vault'),
  printReceipt: (receiptHtml: string) => ipcRenderer.invoke('print-receipt', receiptHtml),
  updateMainLocale: (locale: string) => ipcRenderer.invoke('update-main-locale', locale),
  device: deviceAPI,
  runtime: runtimeAPI,
  peripherals: peripheralsAPI,
};

const dbAPI: DatabaseAPI = {
  // vector 1 — tenantId stays out of the wire. Main process
  // reads it from the desktopSession singleton.
  getAll: (table: string) => ipcRenderer.invoke('db:getAll', table),
  getById: (table: string, id: string) => ipcRenderer.invoke('db:getById', table, id),
  insert: (table: string, data: Record<string, unknown>) =>
    ipcRenderer.invoke('db:insert', table, data),
  update: (table: string, id: string, data: Record<string, unknown>) =>
    ipcRenderer.invoke('db:update', table, id, data),
  delete: (table: string, id: string) => ipcRenderer.invoke('db:delete', table, id),
  getByField: (table: string, fieldName: string, value: unknown) =>
    ipcRenderer.invoke('db:getByField', table, fieldName, value),
  deleteByTenant: (table: string) => ipcRenderer.invoke('db:deleteByTenant', table),
  countByTenant: (table: string) => ipcRenderer.invoke('db:countByTenant', table),
  addToSyncQueue: (item: Record<string, unknown>) => ipcRenderer.invoke('db:addToSyncQueue', item),
  getPendingSyncItems: () => ipcRenderer.invoke('db:getPendingSyncItems'),
};

const syncAPI: SyncAPI = {
  getStatus: () => ipcRenderer.invoke('sync:getStatus'),
  triggerSync: () => ipcRenderer.invoke('sync:triggerSync'),
  setConfig: (config: Record<string, unknown>) => ipcRenderer.invoke('sync:setConfig', config),
};

const sessionAPI: SessionAPI = {
  register: (accessToken: string) => ipcRenderer.invoke('session:register', accessToken),
  clear: () => ipcRenderer.invoke('session:clear'),
  loginHub: input => ipcRenderer.invoke('session:hub-login', input),
  refreshHub: () => ipcRenderer.invoke('session:hub-refresh'),
  switchStaffHub: input => ipcRenderer.invoke('session:hub-switch-staff', input),
  logoutHub: () => ipcRenderer.invoke('session:hub-logout'),
  requestHub: input => ipcRenderer.invoke('session:hub-request', input),
  clearHub: () => ipcRenderer.invoke('session:hub-clear'),
};

const desktopBridgeAPI: DesktopBridgeAPI = {
  ...electronAPI,
  db: dbAPI,
  sync: syncAPI,
  session: sessionAPI,
};

// Expose APIs to renderer process
contextBridge.exposeInMainWorld('electron', electronAPI);
contextBridge.exposeInMainWorld('db', dbAPI);
contextBridge.exposeInMainWorld('sync', syncAPI);
contextBridge.exposeInMainWorld('session', sessionAPI);
contextBridge.exposeInMainWorld('api', desktopBridgeAPI);
