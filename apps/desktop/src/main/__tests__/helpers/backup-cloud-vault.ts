import type { BackupCloudVault, BackupCloudVaultStatus } from '../../backup/cloud-vault.ts';

export const EMPTY_BACKUP_CLOUD_VAULT_STATUS: BackupCloudVaultStatus = {
  configured: false,
  secureStorageAvailable: true,
  endpoint: null,
  region: null,
  bucket: null,
  prefix: null,
  forcePathStyle: false,
  accessKeyHint: null,
  configuredAt: null,
  updatedAt: null,
  lastAttemptAt: null,
  lastSuccessAt: null,
  lastObjectKey: null,
  lastError: null,
  inProgress: false,
};

export function createBackupCloudVaultStub(
  overrides: Partial<BackupCloudVault> = {}
): BackupCloudVault {
  return {
    getStatus: async () => EMPTY_BACKUP_CLOUD_VAULT_STATUS,
    configure: async () => EMPTY_BACKUP_CLOUD_VAULT_STATUS,
    disconnect: async () => EMPTY_BACKUP_CLOUD_VAULT_STATUS,
    testConnection: async () => ({
      success: true,
      status: EMPTY_BACKUP_CLOUD_VAULT_STATUS,
    }),
    replicateSnapshot: async () => ({
      success: false,
      skipped: true,
      status: EMPTY_BACKUP_CLOUD_VAULT_STATUS,
      error: 'configuration_missing',
    }),
    ...overrides,
  };
}
