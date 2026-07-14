import { afterEach, beforeEach, describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { CreateBackupBundleArgs } from '../backup/backup-bundle.ts';
import {
  backupTenantPathSegment,
  computeNextBackupRunAt,
  createBackupScheduler,
} from '../backup/scheduler.ts';

const ENCRYPTION_KEY = 'a'.repeat(64);
let scratch: string;

beforeEach(async () => {
  scratch = await mkdtemp(join(tmpdir(), 'puntovivo-scheduler-test-'));
});

afterEach(async () => {
  await rm(scratch, { recursive: true, force: true });
});

function makeScheduler(
  options: {
    now?: () => Date;
    createBundle?: (args: CreateBackupBundleArgs) => Promise<{
      zipPath: string;
      zipBytes: number;
      manifest: {
        schemaVersion: number;
        generatedAt: string;
        dbBytes: number;
        tenantSlug?: string;
      };
    }>;
    lifecycleEvents?: string[];
    statePath?: () => string;
  } = {}
) {
  const lifecycleEvents = options.lifecycleEvents ?? [];
  return createBackupScheduler({
    dbPath: join(scratch, 'local.db'),
    getStatePath: options.statePath ?? (() => join(scratch, 'state', 'backup-schedules.v1.json')),
    getManagedDirectory: tenantId => join(scratch, 'managed', tenantId),
    getDeviceIdPath: () => join(scratch, 'device-id.txt'),
    getAppVersion: () => '1.5.1',
    resolveDatabaseEncryptionKey: async () => ENCRYPTION_KEY,
    runWithServerRestart: async operation => {
      lifecycleEvents.push('restart:start');
      const result = await operation();
      lifecycleEvents.push('restart:end');
      return result;
    },
    runExclusive: async operation => {
      lifecycleEvents.push('exclusive:start');
      const result = await operation();
      lifecycleEvents.push('exclusive:end');
      return result;
    },
    createBundle:
      options.createBundle ??
      (async args => ({
        zipPath: args.outZipPath,
        zipBytes: 42,
        manifest: {
          schemaVersion: 1,
          generatedAt: (options.now?.() ?? new Date()).toISOString(),
          dbBytes: 24,
          ...(args.manifest?.tenantSlug ? { tenantSlug: args.manifest.tenantSlug } : {}),
        },
      })),
    ...(options.now ? { now: options.now } : {}),
    tickIntervalMs: 60 * 60 * 1_000,
    log: {
      info: () => {},
      warn: () => {},
      error: () => {},
    },
  });
}

describe('backup scheduler time policy (ENG-136a)', () => {
  it('computes daily and weekly next runs and disables off schedules', () => {
    const anchor = new Date('2026-07-14T12:00:00.000Z');
    assert.equal(computeNextBackupRunAt('off', anchor), null);
    assert.equal(computeNextBackupRunAt('daily', anchor), '2026-07-15T12:00:00.000Z');
    assert.equal(computeNextBackupRunAt('weekly', anchor), '2026-07-21T12:00:00.000Z');
  });

  it('keeps tenant ids inside one portable path segment', () => {
    assert.equal(backupTenantPathSegment('tenant/a b?c'), 'tenant-a-b-c');
    assert.equal(backupTenantPathSegment('../../'), 'tenant');
  });
});

describe('backup scheduler persistence and execution (ENG-136a)', () => {
  it('returns a managed, disabled default when no state exists', async () => {
    const scheduler = makeScheduler({ now: () => new Date('2026-07-14T12:00:00.000Z') });
    const status = await scheduler.getStatus('tenant-a');

    assert.equal(status.frequency, 'off');
    assert.equal(status.destinationMode, 'managed');
    assert.equal(status.destinationDirectory, join(scratch, 'managed', 'tenant-a'));
    assert.equal(status.nextRunAt, null);
    assert.equal(status.inProgress, false);
  });

  it('ignores a corrupted state file instead of trusting arbitrary paths', async () => {
    const statePath = join(scratch, 'state', 'backup-schedules.v1.json');
    await writeFile(statePath, '{not-json', 'utf8').catch(async error => {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      const { mkdir } = await import('node:fs/promises');
      await mkdir(join(scratch, 'state'), { recursive: true });
      await writeFile(statePath, '{not-json', 'utf8');
    });
    const scheduler = makeScheduler();

    const status = await scheduler.getStatus('tenant-a');
    assert.equal(status.frequency, 'off');
    assert.equal(status.destinationMode, 'managed');
  });

  it('persists frequency and custom destination per tenant', async () => {
    const fixed = new Date('2026-07-14T12:00:00.000Z');
    const scheduler = makeScheduler({ now: () => fixed });
    const custom = join(scratch, 'custom');

    await scheduler.setCustomDestination('tenant-a', custom);
    const updated = await scheduler.updateSchedule('tenant-a', { frequency: 'weekly' });

    assert.equal(updated.destinationMode, 'custom');
    assert.equal(updated.destinationDirectory, custom);
    assert.equal(updated.nextRunAt, '2026-07-21T12:00:00.000Z');
    assert.equal((await scheduler.getStatus('tenant-b')).frequency, 'off');

    const persisted = JSON.parse(
      await readFile(join(scratch, 'state', 'backup-schedules.v1.json'), 'utf8')
    ) as { schedules: Record<string, { tenantId: string }> };
    assert.equal(persisted.schedules['tenant-a']?.tenantId, 'tenant-a');
    assert.equal(persisted.schedules['tenant-b'], undefined);
  });

  it('creates an encrypted tenant-labelled snapshot through the exclusive restart boundary', async () => {
    let current = new Date('2026-07-14T12:00:00.000Z');
    const lifecycleEvents: string[] = [];
    let captured: CreateBackupBundleArgs | undefined;
    const scheduler = makeScheduler({
      now: () => current,
      lifecycleEvents,
      createBundle: async args => {
        captured = args;
        current = new Date('2026-07-14T12:00:02.000Z');
        return {
          zipPath: args.outZipPath,
          zipBytes: 128,
          manifest: {
            schemaVersion: 1,
            generatedAt: current.toISOString(),
            dbBytes: 64,
            ...(args.manifest?.tenantSlug ? { tenantSlug: args.manifest.tenantSlug } : {}),
          },
        };
      },
    });
    await scheduler.updateSchedule('tenant-a', { frequency: 'daily' });

    const result = await scheduler.runNow('tenant-a');

    assert.equal(result.success, true);
    assert.equal(captured?.encryptionKey, ENCRYPTION_KEY);
    assert.equal(captured?.manifest?.tenantSlug, 'tenant-a');
    assert.match(captured?.outZipPath ?? '', /puntovivo-backup-tenant-a-.*\.zip$/);
    assert.deepEqual(lifecycleEvents, [
      'exclusive:start',
      'restart:start',
      'restart:end',
      'exclusive:end',
    ]);
    assert.equal(result.status.lastSuccessAt, '2026-07-14T12:00:02.000Z');
    assert.equal(result.status.lastSizeBytes, 128);
    assert.equal(result.status.nextRunAt, '2026-07-15T12:00:02.000Z');
    assert.equal(result.status.inProgress, false);
  });

  it('persists a safe failure code without exposing provider diagnostics', async () => {
    const scheduler = makeScheduler({
      now: () => new Date('2026-07-14T12:00:00.000Z'),
      createBundle: async () => {
        throw new Error('/secret/path failed with key abc123');
      },
    });

    const result = await scheduler.runNow('tenant-a');

    assert.deepEqual(result.error, 'snapshot_failed');
    assert.equal(result.status.lastError, 'snapshot_failed');
    assert.doesNotMatch(JSON.stringify(result), /secret|abc123/);
  });

  it('clears in-progress state when the schedule store cannot be written', async () => {
    const scheduler = makeScheduler({ statePath: () => scratch });

    const result = await scheduler.runNow('tenant-a');

    assert.equal(result.success, false);
    assert.equal(result.error, 'snapshot_failed');
    assert.equal(result.status.inProgress, false);
    assert.equal((await scheduler.getStatus('tenant-a')).inProgress, false);
    assert.doesNotMatch(JSON.stringify(result), /EISDIR|ENOTEMPTY|operation not permitted/i);
  });
});
