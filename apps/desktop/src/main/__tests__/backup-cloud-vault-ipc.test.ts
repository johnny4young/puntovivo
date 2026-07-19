import { beforeEach, describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import type { AuthTokenPayload } from '@puntovivo/server';
import type { BackupIpcDeps } from '../ipc/backup/contracts.ts';
import {
  handleConfigureBackupCloudVault,
  handleDisconnectBackupCloudVault,
  handleGetBackupCloudVaultStatus,
  handleTestBackupCloudVault,
} from '../ipc/backup/cloud-vault.ts';
import {
  __resetForTests,
  register,
  SESSION_NOT_REGISTERED,
  SESSION_ROLE_FORBIDDEN,
} from '../session/desktopSession.ts';
import {
  createBackupCloudVaultStub,
  EMPTY_BACKUP_CLOUD_VAULT_STATUS,
} from './helpers/backup-cloud-vault.ts';

const CONFIGURED_STATUS = {
  ...EMPTY_BACKUP_CLOUD_VAULT_STATUS,
  configured: true,
  endpoint: 'https://objects.example.test',
  region: 'auto',
  bucket: 'merchant-backups',
  prefix: 'puntovivo',
  accessKeyHint: '••••1234',
  configuredAt: '2026-07-14T12:00:00.000Z',
  updatedAt: '2026-07-14T12:00:00.000Z',
};

const CONFIG = {
  endpoint: 'https://objects.example.test',
  region: 'auto',
  bucket: 'merchant-backups',
  prefix: 'puntovivo',
  forcePathStyle: true,
  accessKeyId: 'ACCESS1234',
  secretAccessKey: 'secret-value',
};

function makeDeps(
  vaultOverrides: Parameters<typeof createBackupCloudVaultStub>[0] = {}
): BackupIpcDeps {
  return {
    dbPath: '/tmp/puntovivo-test.db',
    getMainWindow: () => null,
    resolveDatabaseEncryptionKey: async () => 'a'.repeat(64),
    getBackupProtectionStatus: () => ({
      protected: true,
      databaseEncrypted: true,
      backupEncryption: 'sqlcipher',
      keyStorage: 'os_keychain',
      provider: 'macos_keychain',
      recoveryKeyAvailable: true,
    }),
    runWithServerRestart: async operation => operation(),
    runExclusiveBackupOperation: async operation => operation(),
    chooseBackupScheduleDirectory: async () => null,
    runBackupRestoreDrill: async () => {
      throw new Error('not expected in cloud vault IPC tests');
    },
    recordBackupRestoreDrillAudit: () => {},
    backupCloudVault: createBackupCloudVaultStub(vaultOverrides),
    backupScheduler: {
      start: async () => {},
      stop: async () => {},
      tick: async () => {},
      getStatus: async () => {
        throw new Error('not expected in cloud vault IPC tests');
      },
      updateSchedule: async () => {
        throw new Error('not expected in cloud vault IPC tests');
      },
      setCustomDestination: async () => {
        throw new Error('not expected in cloud vault IPC tests');
      },
      runNow: async () => {
        throw new Error('not expected in cloud vault IPC tests');
      },
    },
  };
}

async function registerRole(role: AuthTokenPayload['role']): Promise<void> {
  await register('valid-token', async () => ({
    userId: `user-${role}`,
    tenantId: 'tenant-1',
    email: `${role}@puntovivo.test`,
    role,
    sessionVersion: 1,
    tokenType: 'access' as const,
  }));
}

describe('backup cloud vault IPC permissions and validation (ENG-136c)', () => {
  beforeEach(() => {
    __resetForTests();
  });

  it('rejects missing and non-admin desktop sessions before reading vault state', async () => {
    let inspected = false;
    const deps = makeDeps({
      getStatus: async () => {
        inspected = true;
        return CONFIGURED_STATUS;
      },
    });

    await assert.rejects(handleGetBackupCloudVaultStatus(deps), {
      message: SESSION_NOT_REGISTERED,
    });
    await registerRole('manager');
    await assert.rejects(handleGetBackupCloudVaultStatus(deps), {
      message: SESSION_ROLE_FORBIDDEN,
    });
    assert.equal(inspected, false);
  });

  it('derives the tenant from the admin session for configure, test and disconnect', async () => {
    await registerRole('admin');
    const calls: Array<{ operation: string; tenantId: string }> = [];
    const deps = makeDeps({
      configure: async (tenantId, input) => {
        calls.push({ operation: `configure:${input.bucket}`, tenantId });
        return CONFIGURED_STATUS;
      },
      testConnection: async tenantId => {
        calls.push({ operation: 'test', tenantId });
        return { success: true, status: CONFIGURED_STATUS };
      },
      disconnect: async tenantId => {
        calls.push({ operation: 'disconnect', tenantId });
        return EMPTY_BACKUP_CLOUD_VAULT_STATUS;
      },
    });

    assert.equal((await handleConfigureBackupCloudVault(deps, CONFIG)).success, true);
    assert.equal((await handleTestBackupCloudVault(deps)).success, true);
    assert.equal((await handleDisconnectBackupCloudVault(deps)).success, true);
    assert.deepEqual(calls, [
      { operation: 'configure:merchant-backups', tenantId: 'tenant-1' },
      { operation: 'test', tenantId: 'tenant-1' },
      { operation: 'disconnect', tenantId: 'tenant-1' },
    ]);
  });

  it('rejects malformed or tenant-bearing renderer input before storing credentials', async () => {
    await registerRole('admin');
    let configured = false;
    const result = await handleConfigureBackupCloudVault(
      makeDeps({
        configure: async () => {
          configured = true;
          return CONFIGURED_STATUS;
        },
      }),
      { ...CONFIG, tenantId: 'other-tenant' }
    );

    assert.deepEqual(result, { success: false, error: 'configuration_invalid' });
    assert.equal(configured, false);
    assert.doesNotMatch(JSON.stringify(result), /other-tenant|secret-value/);
  });

  it('returns only bounded cloud failure codes from connection tests', async () => {
    await registerRole('admin');
    const result = await handleTestBackupCloudVault(
      makeDeps({
        testConnection: async () => ({
          success: false,
          status: { ...CONFIGURED_STATUS, lastError: 'connection_failed' },
          error: 'connection_failed',
        }),
      })
    );

    assert.equal(result.success, false);
    assert.equal(result.error, 'connection_failed');
    assert.doesNotMatch(JSON.stringify(result), /credential|Authorization|secret/);
  });
});
