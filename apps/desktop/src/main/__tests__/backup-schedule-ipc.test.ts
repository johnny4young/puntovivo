import { beforeEach, describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import type { BackupIpcDeps } from '../ipc/backup/contracts.ts';
import {
  handleChooseBackupScheduleDestination,
  handleGetBackupScheduleStatus,
  handleRunBackupSnapshotNow,
  handleUpdateBackupSchedule,
} from '../ipc/backup/schedule.ts';
import {
  __resetForTests,
  register,
  SESSION_NOT_REGISTERED,
  SESSION_ROLE_FORBIDDEN,
} from '../session/desktopSession.ts';

const STATUS = {
  tenantId: 'tenant-1',
  frequency: 'daily' as const,
  destinationMode: 'managed' as const,
  destinationDirectory: '/tmp/puntovivo/backups/tenant-1',
  updatedAt: '2026-07-14T12:00:00.000Z',
  nextRunAt: '2026-07-15T12:00:00.000Z',
  lastAttemptAt: null,
  lastSuccessAt: null,
  lastPath: null,
  lastSizeBytes: null,
  lastError: null,
  inProgress: false,
};

function makeDeps(
  schedulerOverrides: Partial<BackupIpcDeps['backupScheduler']> = {}
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
    runBackupRestoreDrill: async () => {
      throw new Error('not expected in schedule IPC tests');
    },
    recordBackupRestoreDrillAudit: () => {},
    chooseBackupScheduleDirectory: async () => null,
    backupScheduler: {
      start: async () => {},
      stop: async () => {},
      tick: async () => {},
      getStatus: async () => STATUS,
      updateSchedule: async () => STATUS,
      setCustomDestination: async () => STATUS,
      runNow: async () => ({ success: true, status: STATUS }),
      ...schedulerOverrides,
    },
  };
}

async function registerRole(role: string): Promise<void> {
  await register('valid-token', async () => ({
    userId: `user-${role}`,
    tenantId: 'tenant-1',
    email: `${role}@puntovivo.test`,
    role,
    sessionVersion: 1,
    tokenType: 'access' as const,
  }));
}

describe('backup schedule IPC permissions and validation (ENG-136a)', () => {
  beforeEach(() => {
    __resetForTests();
  });

  it('rejects callers without a registered desktop session', async () => {
    await assert.rejects(handleGetBackupScheduleStatus(makeDeps()), {
      message: SESSION_NOT_REGISTERED,
    });
  });

  it('rejects non-admin roles before reading schedule state', async () => {
    await registerRole('manager');
    let inspected = false;
    const deps = makeDeps({
      getStatus: async () => {
        inspected = true;
        return STATUS;
      },
    });

    await assert.rejects(handleGetBackupScheduleStatus(deps), {
      message: SESSION_ROLE_FORBIDDEN,
    });
    assert.equal(inspected, false);
  });

  it('derives the tenant from the admin session for status and updates', async () => {
    await registerRole('admin');
    const calls: Array<{ tenantId: string; frequency?: string }> = [];
    const deps = makeDeps({
      getStatus: async tenantId => {
        calls.push({ tenantId });
        return STATUS;
      },
      updateSchedule: async (tenantId, update) => {
        calls.push({ tenantId, frequency: update.frequency });
        return STATUS;
      },
    });

    assert.deepEqual(await handleGetBackupScheduleStatus(deps), {
      success: true,
      status: STATUS,
    });
    assert.deepEqual(await handleUpdateBackupSchedule(deps, { frequency: 'daily' }), {
      success: true,
      status: STATUS,
    });
    assert.deepEqual(calls, [
      { tenantId: 'tenant-1' },
      { tenantId: 'tenant-1', frequency: 'daily' },
    ]);
  });

  it('fails closed on malformed renderer input before mutating the schedule', async () => {
    await registerRole('admin');
    let updated = false;
    const result = await handleUpdateBackupSchedule(
      makeDeps({
        updateSchedule: async () => {
          updated = true;
          return STATUS;
        },
      }),
      { frequency: 'daily', destinationMode: 'custom', path: '/arbitrary/path' }
    );

    assert.deepEqual(result, { success: false, error: 'schedule_unavailable' });
    assert.equal(updated, false);
    assert.doesNotMatch(JSON.stringify(result), /arbitrary/);
  });

  it('normalizes run-now failures without exposing provider diagnostics', async () => {
    await registerRole('admin');
    const failedStatus = { ...STATUS, lastError: 'snapshot_failed' as const };
    const result = await handleRunBackupSnapshotNow(
      makeDeps({
        runNow: async () => ({
          success: false,
          status: failedStatus,
          error: 'snapshot_failed',
        }),
      })
    );

    assert.deepEqual(result, {
      success: false,
      status: failedStatus,
      error: 'snapshot_failed',
    });
  });

  it('normalizes native picker failures without mutating the destination', async () => {
    await registerRole('admin');
    let updated = false;
    const deps = makeDeps({
      setCustomDestination: async () => {
        updated = true;
        return STATUS;
      },
    });
    deps.chooseBackupScheduleDirectory = async () => {
      throw new Error('/secret/provider/path was unavailable');
    };

    const result = await handleChooseBackupScheduleDestination(deps);

    assert.deepEqual(result, { success: false, error: 'schedule_unavailable' });
    assert.equal(updated, false);
    assert.doesNotMatch(JSON.stringify(result), /secret|provider|path/);
  });
});
