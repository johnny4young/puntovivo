type BackupScheduleFrequency = 'off' | 'daily' | 'weekly';
type BackupDestinationMode = 'managed' | 'custom';

interface BackupScheduleStatus {
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

type BackupCloudVaultErrorCode =
  | 'configuration_invalid'
  | 'configuration_missing'
  | 'secure_storage_unavailable'
  | 'cloud_vault_unavailable'
  | 'connection_failed'
  | 'upload_failed'
  | 'operation_in_progress';

interface BackupCloudVaultStatus {
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

interface BackupCloudVaultConfigInput {
  endpoint: string;
  region: string;
  bucket: string;
  prefix?: string;
  forcePathStyle: boolean;
  accessKeyId: string;
  secretAccessKey: string;
}

type BackupRestoreDrillTable =
  'products' | 'customers' | 'sales' | 'inventory_movements' | 'audit_logs';

interface BackupRestoreDrillReport {
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

interface DesktopElectronAPI {
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
  }>;
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
  runBackupRestoreDrill: () => Promise<
    | { success: true; report: BackupRestoreDrillReport }
    | { success: false; error: 'snapshot_unavailable' | 'drill_failed' }
  >;
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
  printReceipt: (receiptHtml: string) => Promise<{
    success: boolean;
    error?: string;
  }>;
  device: DeviceAPI;
}

interface DeviceAPI {
  getId: () => Promise<string | null>;
  setId: (id: string) => Promise<void>;
}

interface DatabaseAPI {
  getAll: (table: string, tenantId: string) => Promise<unknown[]>;
  getById: (table: string, id: string) => Promise<unknown>;
  insert: (table: string, data: Record<string, unknown>) => Promise<unknown>;
  update: (table: string, id: string, data: Record<string, unknown>) => Promise<unknown>;
  delete: (table: string, id: string) => Promise<boolean>;
  getByField: (table: string, fieldName: string, value: unknown) => Promise<unknown[]>;
  deleteByTenant: (table: string, tenantId: string) => Promise<number>;
  countByTenant: (table: string, tenantId: string) => Promise<number>;
  addToSyncQueue: (item: Record<string, unknown>) => Promise<void>;
  getPendingSyncItems: (tenantId: string) => Promise<unknown[]>;
}

interface SyncAPI {
  getStatus: (tenantId?: string) => Promise<{
    isOnline: boolean;
    lastSync: string | null;
    pendingItems: number;
    conflicts: number;
  }>;
  triggerSync: (tenantId?: string) => Promise<{
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

interface DesktopBridgeAPI extends DesktopElectronAPI {
  db: DatabaseAPI;
  sync: SyncAPI;
}

declare global {
  interface Window {
    electron: DesktopElectronAPI;
    db: DatabaseAPI;
    sync: SyncAPI;
    api: DesktopBridgeAPI;
  }
}

export {};
