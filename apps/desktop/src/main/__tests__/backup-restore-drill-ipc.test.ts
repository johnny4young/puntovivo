import { beforeEach, describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import type { AuthTokenPayload } from '@puntovivo/server';
import type { BackupRestoreDrillReport } from '../backup/restore-drill.ts';
import { BackupRestoreDrillError } from '../backup/restore-drill.ts';
import type { BackupIpcDeps, BackupRestoreDrillAuditInput } from '../ipc/backup/contracts.ts';
import { handleRunBackupRestoreDrill } from '../ipc/backup/drill.ts';
import {
  __resetForTests,
  register,
  SESSION_NOT_REGISTERED,
  SESSION_ROLE_FORBIDDEN,
} from '../session/desktopSession.ts';
import { createBackupCloudVaultStub } from './helpers/backup-cloud-vault.ts';

const REPORT: BackupRestoreDrillReport = {
  outcome: 'passed',
  checkedAt: '2026-07-14T12:05:00.000Z',
  snapshotGeneratedAt: '2026-07-14T12:00:00.000Z',
  snapshotSchemaVersion: 1,
  snapshotSizeBytes: 2_048,
  currentTotal: 12,
  snapshotTotal: 9,
  tables: [
    { table: 'products', currentCount: 3, snapshotCount: 2, delta: 1 },
    { table: 'customers', currentCount: 2, snapshotCount: 1, delta: 1 },
    { table: 'sales', currentCount: 2, snapshotCount: 2, delta: 0 },
    { table: 'inventory_movements', currentCount: 4, snapshotCount: 3, delta: 1 },
    { table: 'audit_logs', currentCount: 1, snapshotCount: 1, delta: 0 },
  ],
};

function makeDeps(overrides: Partial<BackupIpcDeps> = {}): BackupIpcDeps {
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
    backupCloudVault: createBackupCloudVaultStub(),
    backupScheduler: {
      start: async () => {},
      stop: async () => {},
      tick: async () => {},
      getStatus: async () => {
        throw new Error('not expected in restore drill IPC tests');
      },
      updateSchedule: async () => {
        throw new Error('not expected in restore drill IPC tests');
      },
      setCustomDestination: async () => {
        throw new Error('not expected in restore drill IPC tests');
      },
      runNow: async () => {
        throw new Error('not expected in restore drill IPC tests');
      },
    },
    runBackupRestoreDrill: async () => REPORT,
    recordBackupRestoreDrillAudit: () => {},
    ...overrides,
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

describe('backup restore drill IPC (ENG-136b)', () => {
  beforeEach(() => {
    __resetForTests();
  });

  it('rejects missing and non-admin desktop sessions before running the drill', async () => {
    let invoked = false;
    const deps = makeDeps({
      runBackupRestoreDrill: async () => {
        invoked = true;
        return REPORT;
      },
    });

    await assert.rejects(handleRunBackupRestoreDrill(deps), {
      message: SESSION_NOT_REGISTERED,
    });
    await registerRole('manager');
    await assert.rejects(handleRunBackupRestoreDrill(deps), {
      message: SESSION_ROLE_FORBIDDEN,
    });
    assert.equal(invoked, false);
  });

  it('derives tenant and actor from the admin session and records bounded pass evidence', async () => {
    await registerRole('admin');
    const audit: BackupRestoreDrillAuditInput[] = [];
    const tenants: string[] = [];

    const result = await handleRunBackupRestoreDrill(
      makeDeps({
        runBackupRestoreDrill: async tenantId => {
          tenants.push(tenantId);
          return REPORT;
        },
        recordBackupRestoreDrillAudit: input => audit.push(input),
      })
    );

    assert.deepEqual(result, { success: true, report: REPORT });
    assert.deepEqual(tenants, ['tenant-1']);
    assert.deepEqual(audit, [
      {
        tenantId: 'tenant-1',
        actorId: 'user-admin',
        resourceId: REPORT.snapshotGeneratedAt,
        outcome: 'passed',
        report: REPORT,
      },
    ]);
    assert.doesNotMatch(JSON.stringify(result), /tmp|key|path/i);
  });

  it('normalizes failures and still writes tenant-scoped failed evidence', async () => {
    await registerRole('admin');
    const audit: BackupRestoreDrillAuditInput[] = [];

    const result = await handleRunBackupRestoreDrill(
      makeDeps({
        runBackupRestoreDrill: async () => {
          throw new BackupRestoreDrillError('snapshot_unavailable', {
            cause: new Error('/secret/path with key abc123'),
          });
        },
        recordBackupRestoreDrillAudit: input => audit.push(input),
      })
    );

    assert.deepEqual(result, { success: false, error: 'snapshot_unavailable' });
    assert.deepEqual(audit, [
      {
        tenantId: 'tenant-1',
        actorId: 'user-admin',
        resourceId: 'latest',
        outcome: 'failed',
        errorCode: 'snapshot_unavailable',
      },
    ]);
    assert.doesNotMatch(JSON.stringify(result), /secret|path|abc123/i);
  });

  it('does not report success when immutable audit evidence cannot be written', async () => {
    await registerRole('admin');

    const result = await handleRunBackupRestoreDrill(
      makeDeps({
        recordBackupRestoreDrillAudit: () => {
          throw new Error('database read-only');
        },
      })
    );

    assert.deepEqual(result, { success: false, error: 'drill_failed' });
  });
});
