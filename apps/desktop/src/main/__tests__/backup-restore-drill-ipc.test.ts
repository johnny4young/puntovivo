import { beforeEach, describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { __withExpectedTestLogs } from '@puntovivo/server';
import type { BackupRestoreDrillReport } from '../backup/restore-drill.ts';
import { BackupRestoreDrillError } from '../backup/restore-drill.ts';
import type { BackupIpcDeps, BackupRestoreDrillAuditInput } from '../ipc/backup/contracts.ts';
import { handleRunBackupRestoreDrill } from '../ipc/backup/drill.ts';
import {
  __resetForTests,
  SESSION_NOT_REGISTERED,
  SESSION_ROLE_FORBIDDEN,
} from '../session/desktopSession.ts';
import { makeBackupIpcDeps } from './helpers/backup-ipc-deps.ts';
import { registerRole } from './helpers/desktop-session.ts';

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
  return makeBackupIpcDeps({
    runBackupRestoreDrill: async () => REPORT,
    ...overrides,
  });
}

describe('backup restore drill IPC', () => {
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

    const result = await __withExpectedTestLogs(
      [
        {
          level: 'warn',
          module: 'backup',
          message: 'backup restore drill failed',
        },
      ],
      () =>
        handleRunBackupRestoreDrill(
          makeDeps({
            runBackupRestoreDrill: async () => {
              throw new BackupRestoreDrillError('snapshot_unavailable', {
                cause: new Error('/secret/path with key abc123'),
              });
            },
            recordBackupRestoreDrillAudit: input => audit.push(input),
          })
        )
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

    const result = await __withExpectedTestLogs(
      [
        {
          level: 'error',
          module: 'backup',
          message: 'restore drill passed but audit evidence could not be recorded',
        },
      ],
      () =>
        handleRunBackupRestoreDrill(
          makeDeps({
            recordBackupRestoreDrillAudit: () => {
              throw new Error('database read-only');
            },
          })
        )
    );

    assert.deepEqual(result, { success: false, error: 'drill_failed' });
  });
});
