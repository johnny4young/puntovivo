import { describe, expect, it } from 'vitest';
import type { BackupCloudVaultStatus } from '@/types/electron';
import { cloudVaultFormFromStatus, EMPTY_CLOUD_VAULT_FORM } from '../backupCloudVaultForm';

function makeStatus(overrides: Partial<BackupCloudVaultStatus> = {}): BackupCloudVaultStatus {
  return {
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
    ...overrides,
  };
}

describe('cloudVaultFormFromStatus', () => {
  it('uses safe provider defaults for an unconfigured vault', () => {
    expect(cloudVaultFormFromStatus(makeStatus())).toEqual(EMPTY_CLOUD_VAULT_FORM);
  });

  it('copies connection metadata but never projects credential hints into inputs', () => {
    expect(
      cloudVaultFormFromStatus(
        makeStatus({
          configured: true,
          endpoint: 'https://objects.example.test',
          region: 'us-east-1',
          bucket: 'merchant-backups',
          prefix: 'puntovivo/production',
          forcePathStyle: false,
          accessKeyHint: '••••1234',
        })
      )
    ).toEqual({
      endpoint: 'https://objects.example.test',
      region: 'us-east-1',
      bucket: 'merchant-backups',
      prefix: 'puntovivo/production',
      forcePathStyle: false,
      accessKeyId: '',
      secretAccessKey: '',
    });
  });
});
