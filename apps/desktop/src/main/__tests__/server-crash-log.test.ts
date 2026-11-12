import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  crashErrorCode,
  createWorkerCrashLog,
  type WorkerCrashEntry,
} from '../server-host/crash-log.ts';

const DAY = 24 * 60 * 60_000;

function entry(at: number, outcome: WorkerCrashEntry['outcome']): WorkerCrashEntry {
  return {
    at: new Date(at).toISOString(),
    kind: 'uncaught',
    exitCode: 1,
    errorCode: null,
    uptimeMs: 10,
    pendingCalls: 0,
    restartAttempt: 1,
    outcome,
    fatalCause: null,
    appVersion: '1.0.0',
  };
}

describe('worker crash log', () => {
  it('keeps the last 50 entries and counts restarts of the last 7 days', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'pv-crash-log-'));
    const path = join(dir, 'worker-crashes.ndjson');
    const now = 100 * DAY;
    const log = createWorkerCrashLog({ getPath: () => path, now: () => now });
    for (let i = 0; i < 55; i += 1) await log.append(entry(now - 30 * DAY, 'restarted'));
    await log.append(entry(now - 2 * DAY, 'restarted'));
    await log.append(entry(now - DAY, 'restart-failed'));

    const stats = await log.stats();
    assert.equal(stats.entries.length, 50);
    assert.equal(stats.restartsLast7Days, 1);
    assert.equal(stats.lastCrashAt, new Date(now - DAY).toISOString());
    assert.equal((await readFile(path, 'utf8')).trim().split('\n').length, 50);
  });

  it('skips a torn line and survives a missing file', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'pv-crash-log-'));
    const path = join(dir, 'worker-crashes.ndjson');
    const log = createWorkerCrashLog({ getPath: () => path });
    assert.deepEqual((await log.stats()).entries, []);
    await writeFile(path, `${JSON.stringify(entry(Date.now(), 'restarted'))}\n{"at":"tor`);
    assert.equal((await log.stats()).restartsLast7Days, 1);
  });

  it('records only closed error codes, never free text', () => {
    assert.equal(
      crashErrorCode(Object.assign(new Error('x'), { code: 'SQLITE_BUSY' })),
      'SQLITE_BUSY'
    );
    assert.equal(crashErrorCode(new Error('AUDIT_ANCHOR_DIVERGENCE')), 'AUDIT_ANCHOR_DIVERGENCE');
    assert.equal(crashErrorCode(new Error('customer Ana Pérez not found')), null);
  });
});
