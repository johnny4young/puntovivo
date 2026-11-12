import { after, before, describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { EventEmitter } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { monitorEventLoopDelay } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { createBackupBundle, extractBackupBundle } from '../backup/backup-bundle.ts';
import { applySqlCipherKey } from '../backup/backup-bundle/encryption.ts';
import { createWorkerBackupBundle, type BackupWorkerLike } from '../backup/backup-worker-host.ts';

const WORKER_PATH = fileURLToPath(new URL('../backup/backup-worker.ts', import.meta.url));
const KEY = 'e'.repeat(64);
const ROWS = 120_000;
let scratch: string;
let dbPath: string;

before(() => {
  scratch = mkdtempSync(join(tmpdir(), 'pv-backup-worker-'));
  dbPath = join(scratch, 'live.db');
  const db = new Database(dbPath);
  applySqlCipherKey(db, KEY);
  db.pragma('journal_mode = WAL');
  db.exec('CREATE TABLE sales (id INTEGER PRIMARY KEY, note TEXT NOT NULL)');
  const insert = db.prepare('INSERT INTO sales (note) VALUES (?)');
  db.transaction(() => {
    for (let i = 0; i < ROWS; i += 1) insert.run(`sale-${i}-${'x'.repeat(200)}`);
  })();
  db.close();
});

after(() => rmSync(scratch, { recursive: true, force: true }));

/** Worst main-thread stall, in ms, while `work` runs. */
async function worstStall(work: () => Promise<unknown>): Promise<number> {
  const histogram = monitorEventLoopDelay({ resolution: 5 });
  histogram.enable();
  // Timers keep the loop sampling while native work runs elsewhere.
  const ticker = setInterval(() => {}, 5);
  try {
    await work();
  } finally {
    clearInterval(ticker);
    histogram.disable();
  }
  return histogram.max / 1e6;
}

describe('backup bundle in a worker thread', () => {
  it('builds a bundle that restores with every row', async () => {
    const out = join(await mkdtemp(join(scratch, 'restore-')), 'backup.zip');
    const create = createWorkerBackupBundle({ workerPath: WORKER_PATH });
    const result = await create({
      dbPath,
      outZipPath: out,
      encryptionKey: KEY,
      manifest: { appVersion: 'test' },
    });
    assert.ok(result.manifest.manifestMac, 'encrypted bundles are authenticated');

    const extracted = await extractBackupBundle(out, await mkdtemp(join(scratch, 'extract-')));
    const restored = new Database(extracted.dbPath, { readonly: true });
    applySqlCipherKey(restored, KEY);
    try {
      const row = restored.prepare('SELECT count(*) AS n FROM sales').get() as { n: number };
      assert.equal(row.n, ROWS);
      assert.equal(restored.pragma('integrity_check', { simple: true }), 'ok');
    } finally {
      restored.close();
    }
  });

  it('keeps the main thread responsive where the in-thread backup blocks it', async () => {
    const dir = await mkdtemp(join(scratch, 'gate-'));
    const inThread = await worstStall(() =>
      createBackupBundle({ dbPath, outZipPath: join(dir, 'a.zip'), encryptionKey: KEY })
    );
    const create = createWorkerBackupBundle({ workerPath: WORKER_PATH });
    const offMain = await worstStall(() =>
      create({ dbPath, outZipPath: join(dir, 'b.zip'), encryptionKey: KEY })
    );
    process.stdout.write(
      `# main stall during backup: in-thread ${inThread.toFixed(1)} ms, worker ${offMain.toFixed(1)} ms\n`
    );
    assert.ok(offMain <= 100, `worker backup stalled main for ${offMain.toFixed(1)} ms`);
    assert.ok(offMain < inThread, 'the worker must stall main less than the in-thread backup');
  });

  it('cancels through a message and leaves no bundle behind', async () => {
    const out = join(await mkdtemp(join(scratch, 'cancel-')), 'cancelled.zip');
    const controller = new AbortController();
    const create = createWorkerBackupBundle({ workerPath: WORKER_PATH });
    const running = create({
      dbPath,
      outZipPath: out,
      encryptionKey: KEY,
      signal: controller.signal,
    });
    controller.abort();
    await assert.rejects(running);
    const { existsSync } = await import('node:fs');
    assert.equal(existsSync(out), false);
  });

  it('rejects when the worker dies without a result', async () => {
    const worker = new EventEmitter() as EventEmitter & BackupWorkerLike;
    worker.postMessage = () => queueMicrotask(() => worker.emit('exit', 1));
    worker.terminate = async () => 1;
    const create = createWorkerBackupBundle({ workerPath: 'x', createWorker: () => worker });
    await assert.rejects(create({ dbPath, outZipPath: join(scratch, 'none.zip') }), /code 1/);
  });
});
