import { after, before, describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { randomUUID } from 'node:crypto';
import {
  BACKUP_STATUS_SETTING_KEY as SERVER_KEY,
  createServer,
  readBackupStatus,
  type PuntovivoServer,
} from '@puntovivo/server';
import type { BackupScheduleRecord } from '../backup/scheduler.ts';
import { BACKUP_STATUS_SETTING_KEY, projectBackupStatus } from '../backup/status-publisher.ts';
import { createServerOperations } from '../server-host/operations.ts';

let server: PuntovivoServer;

before(async () => {
  const previous = process.env.PUNTOVIVO_DEV_ADMIN_PASSWORD;
  process.env.PUNTOVIVO_DEV_ADMIN_PASSWORD = `Aa!${randomUUID()}`;
  try {
    server = await createServer({ dbPath: ':memory:', verbose: false });
  } finally {
    if (previous === undefined) delete process.env.PUNTOVIVO_DEV_ADMIN_PASSWORD;
    else process.env.PUNTOVIVO_DEV_ADMIN_PASSWORD = previous;
  }
});

after(async () => {
  await server?.close();
});

function record(tenantId: string, overrides: Partial<BackupScheduleRecord> = {}) {
  return {
    tenantId,
    frequency: 'daily',
    destinationMode: 'managed',
    destinationDirectory: '/var/backups/private',
    updatedAt: '2026-07-14T12:00:00.000Z',
    nextRunAt: '2026-07-15T03:00:00.000Z',
    lastAttemptAt: '2026-07-14T03:00:00.000Z',
    lastSuccessAt: '2026-07-14T03:01:00.000Z',
    lastPath: '/var/backups/private/snapshot.zip',
    lastSizeBytes: 42,
    lastError: null,
    ...overrides,
  } satisfies BackupScheduleRecord;
}

describe('backup status publisher', () => {
  it('lets the server read each tenant outcome, without paths', async () => {
    assert.equal(BACKUP_STATUS_SETTING_KEY, SERVER_KEY);
    const operations = createServerOperations(server);
    await operations.writeAppSetting(
      BACKUP_STATUS_SETTING_KEY,
      projectBackupStatus({
        'tenant-a': record('tenant-a'),
        'tenant-b': record('tenant-b', { lastError: 'snapshot_failed' }),
      })
    );

    const stored = await operations.readAppSetting(BACKUP_STATUS_SETTING_KEY);
    assert.deepEqual(Object.keys(stored as object).sort(), ['tenant-a', 'tenant-b']);
    assert.doesNotMatch(JSON.stringify(stored), /private/);
    const now = new Date('2026-07-14T12:00:00.000Z');
    assert.deepEqual(readBackupStatus(server.db, 'tenant-a', now), {
      state: 'ok',
      at: '2026-07-14T03:01:00.000Z',
    });
    assert.equal(readBackupStatus(server.db, 'tenant-b', now)?.state, 'failed');
  });
});
