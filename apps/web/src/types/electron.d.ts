/**
 * Type declarations for Electron preload APIs
 * These APIs are exposed when the app runs inside Electron
 */

export interface ElectronAPI {
  getAppVersion: () => Promise<string>;
  getAppPath: () => Promise<string>;
  getServerUrl: () => Promise<string>;
  getAutoUpdateStatus: () => Promise<{
    isAvailable: boolean;
    state: 'unavailable' | 'idle' | 'checking' | 'available' | 'downloaded' | 'error';
    installMode?: 'auto' | 'manual';
    currentVersion: string;
    lastCheckedAt: string | null;
    lastUpdatedAt?: string | null;
    rolloutMode?: 'normal' | 'rollback' | null;
    rolloutPercentage?: 10 | 50 | 100 | null;
    rolloutTargetVersion?: string | null;
    rolloutPolicyCheckedAt?: string | null;
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
    installMode?: 'auto' | 'manual';
    currentVersion: string;
    lastCheckedAt: string | null;
    lastUpdatedAt?: string | null;
    rolloutMode?: 'normal' | 'rollback' | null;
    rolloutPercentage?: 10 | 50 | 100 | null;
    rolloutTargetVersion?: string | null;
    rolloutPolicyCheckedAt?: string | null;
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
     * the bundle is encrypted with another device's key;
     * prompt the operator and complete via `provideRestoreKey`.
     */
    needsKey?: boolean;
    token?: string;
  }>;
  /** complete a cross-device restore with the source key. */
  provideRestoreKey?: (
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
   * discard the pending restore staging when the key
   * prompt is dismissed; stale tokens are a silent no-op.
   */
  cancelRestoreStaging?: (token: string) => Promise<{ success: boolean }>;
  /** admin-gated reveal of this install's backup key. */
  getBackupEncryptionKey?: () => Promise<{
    success: boolean;
    key?: string;
    error?: string;
  }>;
  /** non-secret SQLCipher and key-custody attestation. */
  getBackupProtectionStatus?: () => Promise<{
    success: boolean;
    status?: BackupProtectionStatus;
    error?: string;
  }>;
  /** device-local encrypted snapshot schedule. */
  getBackupScheduleStatus?: () => Promise<{
    success: boolean;
    status?: BackupScheduleStatus;
    error?: string;
  }>;
  updateBackupSchedule?: (input: {
    frequency: BackupScheduleFrequency;
    destinationMode?: 'managed';
  }) => Promise<{
    success: boolean;
    status?: BackupScheduleStatus;
    error?: string;
  }>;
  chooseBackupScheduleDestination?: () => Promise<{
    success: boolean;
    status?: BackupScheduleStatus;
    cancelled?: boolean;
    error?: string;
  }>;
  runBackupSnapshotNow?: () => Promise<{
    success: boolean;
    status?: BackupScheduleStatus;
    error?: string;
  }>;
  /** non-destructive comparison against the latest snapshot. */
  runBackupRestoreDrill?: () => Promise<
    | { success: true; report: BackupRestoreDrillReport }
    | { success: false; error: 'snapshot_unavailable' | 'drill_failed' }
  >;
  /** admin-only S3-compatible backup vault; secrets are write-only. */
  getBackupCloudVaultStatus?: () => Promise<BackupCloudVaultResult>;
  configureBackupCloudVault?: (
    input: BackupCloudVaultConfigInput
  ) => Promise<BackupCloudVaultResult>;
  disconnectBackupCloudVault?: () => Promise<BackupCloudVaultResult>;
  testBackupCloudVault?: () => Promise<BackupCloudVaultResult>;
  printReceipt: (receiptHtml: string) => Promise<{ success: boolean; error?: string }>;
  updateMainLocale?: (locale: string) => Promise<'en' | 'es'>;
  runtime?: RuntimeAPI;
  peripherals?: PeripheralsAPI;
}

export type BackupProtectionKeyStorage =
  'environment' | 'os_keychain' | 'basic_text' | 'unavailable';

export type BackupProtectionProvider =
  | 'environment'
  | 'macos_keychain'
  | 'windows_dpapi'
  | 'linux_libsecret'
  | 'linux_kwallet'
  | 'linux_basic_text'
  | 'unknown';

export interface BackupProtectionStatus {
  protected: boolean;
  databaseEncrypted: boolean;
  backupEncryption: 'sqlcipher';
  keyStorage: BackupProtectionKeyStorage;
  provider: BackupProtectionProvider;
  recoveryKeyAvailable: boolean;
}

export type BackupScheduleFrequency = 'off' | 'daily' | 'weekly';
export type BackupDestinationMode = 'managed' | 'custom';

export interface BackupScheduleStatus {
  tenantId: string;
  frequency: BackupScheduleFrequency;
  destinationMode: BackupDestinationMode;
  destinationDirectory: string;
  updatedAt: string;
  nextRunAt: string | null;
  lastAttemptAt: string | null;
  lastSuccessAt: string | null;
  lastPath: string | null;
  lastSizeBytes: number | null;
  lastError: 'snapshot_failed' | null;
  inProgress: boolean;
}

export type BackupCloudVaultErrorCode =
  | 'configuration_invalid'
  | 'configuration_missing'
  | 'secure_storage_unavailable'
  | 'cloud_vault_unavailable'
  | 'connection_failed'
  | 'upload_failed'
  | 'operation_in_progress';

export interface BackupCloudVaultStatus {
  configured: boolean;
  secureStorageAvailable: boolean;
  endpoint: string | null;
  region: string | null;
  bucket: string | null;
  prefix: string | null;
  forcePathStyle: boolean;
  accessKeyHint: string | null;
  configuredAt: string | null;
  updatedAt: string | null;
  lastAttemptAt: string | null;
  lastSuccessAt: string | null;
  lastObjectKey: string | null;
  lastError: 'connection_failed' | 'upload_failed' | null;
  inProgress: boolean;
}

export interface BackupCloudVaultConfigInput {
  endpoint: string;
  region: string;
  bucket: string;
  prefix?: string;
  forcePathStyle: boolean;
  accessKeyId: string;
  secretAccessKey: string;
}

export interface BackupCloudVaultResult {
  success: boolean;
  status?: BackupCloudVaultStatus;
  error?: BackupCloudVaultErrorCode;
}

export type BackupRestoreDrillTable =
  'products' | 'customers' | 'sales' | 'inventory_movements' | 'audit_logs';

export interface BackupRestoreDrillReport {
  outcome: 'passed';
  checkedAt: string;
  snapshotGeneratedAt: string;
  snapshotSchemaVersion: number;
  snapshotSizeBytes: number;
  currentTotal: number;
  snapshotTotal: number;
  tables: Array<{
    table: BackupRestoreDrillTable;
    currentCount: number;
    snapshotCount: number;
    delta: number;
  }>;
}

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
 * local hardware bridge for hub_client terminals. The
 * renderer fetches ESC/POS bytes from the hub via tRPC and pipes
 * them here so the Electron main process writes them to the
 * locally-attached printer / drawer. Per ADR-0008 rule 6 the bridge
 * NEVER touches operational tables.
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
 * vector 1 — tenantId is no longer a wire argument. Main
 * derives it from the registered desktopSession singleton.
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
 * vector 1 — desktop session lifecycle bound to the JWT
 * access token. Renderer registers the token after login and clears
 * on logout; main validates against the embedded server.
 */
export interface SessionAPI {
  register: (accessToken: string) => Promise<{ ok: true }>;
  clear: () => Promise<{ ok: true }>;
  loginHub: (input: { email: string; password: string }) => Promise<HubAuthIpcResult>;
  refreshHub: () => Promise<HubAuthIpcResult>;
  switchStaffHub: (input: { targetUserId: string; pin: string }) => Promise<HubAuthIpcResult>;
  logoutHub: () => Promise<HubAuthIpcResult<{ ok: true }>>;
  requestHub: (input: HubApiRequest) => Promise<HubApiResponse>;
  openHubRealtime: (
    input: HubRealtimeInput,
    listener: (message: HubRealtimeMessage) => void
  ) => string;
  closeHubRealtime: (subscriptionId: string) => Promise<{ ok: boolean }>;
  clearHub: () => Promise<{ ok: true }>;
}

export interface HubApiRequest {
  path: string;
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  headers: Record<string, string>;
  body?: string;
}

export interface HubApiResponse {
  status: number;
  headers: Record<string, string>;
  body: string;
}

export interface HubRealtimeInput {
  collections: string;
  lastEventId?: string;
}

export type HubRealtimeMessage =
  | { kind: 'open' }
  | { kind: 'event'; event: { event: string; data: string; id?: string; retry?: number } }
  | { kind: 'closed' }
  | { kind: 'error'; message: string; status?: number };

export interface HubAccessGrant {
  token: string;
  sessionExpiresAt?: string;
}

export type HubAuthIpcResult<T = HubAccessGrant> =
  | { ok: true; data: T }
  | {
      ok: false;
      error: { message: string; errorCode?: string; trpcCode?: string; status?: number };
    };

export interface DesktopBridgeAPI extends ElectronAPI {
  db: DatabaseAPI;
  sync: SyncAPI;
  session: SessionAPI;
}

declare global {
  // explicit `| undefined` on optional fields.
  interface Window {
    electron?: ElectronAPI | undefined;
    db?: DatabaseAPI | undefined;
    sync?: SyncAPI | undefined;
    session?: SessionAPI | undefined;
    api?: DesktopBridgeAPI | undefined;
  }
}

/**
 * Check if running inside Electron
 */
export function isElectron(): boolean {
  return typeof window !== 'undefined' && window.electron !== undefined;
}
