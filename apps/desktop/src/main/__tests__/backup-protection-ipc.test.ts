import { beforeEach, describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import type { AuthTokenPayload } from '@puntovivo/server';
import type { BackupIpcDeps } from '../ipc/backup/contracts.ts';
import { handleGetBackupProtectionStatus } from '../ipc/backup/status.ts';
import {
  __resetForTests,
  register,
  SESSION_NOT_REGISTERED,
  SESSION_ROLE_FORBIDDEN,
} from '../session/desktopSession.ts';
import { createBackupCloudVaultStub } from './helpers/backup-cloud-vault.ts';

const protectedStatus = {
  protected: true,
  databaseEncrypted: true,
  backupEncryption: 'sqlcipher' as const,
  keyStorage: 'os_keychain' as const,
  provider: 'macos_keychain' as const,
  recoveryKeyAvailable: true,
};

function makeDeps(
  getBackupProtectionStatus: BackupIpcDeps['getBackupProtectionStatus'] = () => protectedStatus
): BackupIpcDeps {
  return {
    dbPath: '/tmp/puntovivo-test.db',
    getMainWindow: () => null,
    resolveDatabaseEncryptionKey: async () => 'a'.repeat(64),
    getBackupProtectionStatus,
    runWithServerRestart: async operation => operation(),
    runExclusiveBackupOperation: async operation => operation(),
    runBackupRestoreDrill: async () => {
      throw new Error('not expected in protection IPC tests');
    },
    recordBackupRestoreDrillAudit: () => {},
    chooseBackupScheduleDirectory: async () => null,
    backupCloudVault: createBackupCloudVaultStub(),
    backupScheduler: {
      start: async () => {},
      stop: async () => {},
      tick: async () => {},
      getStatus: async () => {
        throw new Error('not used');
      },
      updateSchedule: async () => {
        throw new Error('not used');
      },
      setCustomDestination: async () => {
        throw new Error('not used');
      },
      runNow: async () => {
        throw new Error('not used');
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

describe('handleGetBackupProtectionStatus (ENG-129e)', () => {
  beforeEach(() => {
    __resetForTests();
  });

  it('rejects callers without a registered desktop session', () => {
    assert.throws(() => handleGetBackupProtectionStatus(makeDeps()), {
      message: SESSION_NOT_REGISTERED,
    });
  });

  it('rejects non-admin roles before reading protection metadata', async () => {
    await registerRole('manager');
    let inspected = false;
    const deps = makeDeps(() => {
      inspected = true;
      return protectedStatus;
    });

    assert.throws(() => handleGetBackupProtectionStatus(deps), {
      message: SESSION_ROLE_FORBIDDEN,
    });
    assert.equal(inspected, false);
  });

  it('returns only non-secret metadata to an admin', async () => {
    await registerRole('admin');
    const result = handleGetBackupProtectionStatus(makeDeps());

    assert.deepEqual(result, { success: true, status: protectedStatus });
    assert.equal((result as unknown as Record<string, unknown>).key, undefined);
    assert.doesNotMatch(JSON.stringify(result), /[0-9a-f]{64}/i);
  });

  it('converts status inspection failures into a safe IPC result', async () => {
    await registerRole('admin');
    const result = handleGetBackupProtectionStatus(
      makeDeps(() => {
        throw new Error('provider probe failed');
      })
    );

    assert.deepEqual(result, {
      success: false,
      error: 'Backup protection status unavailable',
    });
  });
});
