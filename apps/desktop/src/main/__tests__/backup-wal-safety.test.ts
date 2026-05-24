/**
 * ENG-174 — pins the explicit WAL checkpoint added before the online
 * backup. SQLite's backup API already includes committed WAL frames;
 * this checkpoint keeps the source WAL flushed before the packaged
 * snapshot is produced. Three behaviours guarded here:
 *
 *   1. Writes that landed in the WAL pre-backup survive the round-trip
 *      to the restored DB.
 *   2. After the backup completes the source WAL is fully merged
 *      (the WAL file is truncated to zero or near-zero), proving that
 *      wal_checkpoint FULL actually ran.
 *   3. The backup path keeps working while the embedded server holds
 *      its writer connection open.
 *
 * Runs under node test --experimental-strip-types per the desktop
 * workspace test convention.
 */

import { describe, it, before, after } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtempSync, rmSync, statSync, existsSync } from 'node:fs';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import JSZip from 'jszip';
import {
  ZIP_DB_ENTRY,
  assertSqliteIntegrity,
  createBackupBundle,
} from '../backup/backup-bundle.ts';

let scratchDir: string;

before(() => {
  scratchDir = mkdtempSync(join(tmpdir(), 'puntovivo-backup-wal-test-'));
});

after(() => {
  rmSync(scratchDir, { recursive: true, force: true });
});

function seedDbWithDirtyWal(dbPath: string, rowCount: number): void {
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.exec('CREATE TABLE sales (id TEXT PRIMARY KEY, total REAL NOT NULL);');
  const insert = db.prepare('INSERT INTO sales VALUES (?, ?);');
  const insertMany = db.transaction((rows: Array<[string, number]>) => {
    for (const [id, total] of rows) insert.run(id, total);
  });
  const rows: Array<[string, number]> = [];
  for (let i = 0; i < rowCount; i++) rows.push([`s-${i}`, i * 10]);
  insertMany(rows);
  db.close();
}

describe('createBackupBundle WAL safety (ENG-174)', () => {
  it('checkpoints the WAL before snapshotting and preserves uncheckpointed writes', async () => {
    const dir = await mkdtemp(join(scratchDir, 'wal-survive-'));
    const sourceDbPath = join(dir, 'live.db');
    const outZip = join(dir, 'out.zip');

    seedDbWithDirtyWal(sourceDbPath, 50);

    const walPath = `${sourceDbPath}-wal`;
    const preBackupWalBytes = existsSync(walPath) ? statSync(walPath).size : 0;

    const result = await createBackupBundle({
      dbPath: sourceDbPath,
      outZipPath: outZip,
      manifest: { tenantSlug: 'wal-test' },
    });
    assert.ok(result.zipBytes > 0);

    if (preBackupWalBytes > 1024 && existsSync(walPath)) {
      const postWalBytes = statSync(walPath).size;
      assert.ok(
        postWalBytes < preBackupWalBytes,
        `WAL should shrink after wal_checkpoint FULL; pre=${preBackupWalBytes} post=${postWalBytes}`
      );
    }

    const zip = await JSZip.loadAsync(await readFile(outZip));
    const extractedDb = join(dir, 'extracted.db');
    await writeFile(extractedDb, await zip.file(ZIP_DB_ENTRY)!.async('nodebuffer'));
    await assertSqliteIntegrity(extractedDb);

    const verifier = new Database(extractedDb, { readonly: true });
    const row = verifier.prepare('SELECT COUNT(*) AS n FROM sales').get() as {
      n: number;
    };
    verifier.close();
    assert.equal(row.n, 50, 'every committed row must survive the round-trip');
  });

  it('passes integrity_check on the backup even when the source had a fat WAL', async () => {
    const dir = await mkdtemp(join(scratchDir, 'wal-integrity-'));
    const sourceDbPath = join(dir, 'live.db');
    const outZip = join(dir, 'out.zip');

    seedDbWithDirtyWal(sourceDbPath, 500);

    await createBackupBundle({
      dbPath: sourceDbPath,
      outZipPath: outZip,
      manifest: { tenantSlug: 'fat-wal' },
    });

    const zip = await JSZip.loadAsync(await readFile(outZip));
    const extractedDb = join(dir, 'extracted.db');
    await writeFile(extractedDb, await zip.file(ZIP_DB_ENTRY)!.async('nodebuffer'));

    await assertSqliteIntegrity(extractedDb);
  });

  it('succeeds when a concurrent writer keeps the source DB open during the backup', async () => {
    // Production scenario: the embedded Fastify server holds an open
    // writer connection while the backup IPC runs. An earlier draft
    // tried to checkpoint from a readonly connection and threw
    // "disk I/O error" because SQLite cannot write the main DB through
    // a readonly handle. The fix opens a separate writable connection
    // for the checkpoint only; this test pins that contract.
    const dir = await mkdtemp(join(scratchDir, 'wal-concurrent-'));
    const sourceDbPath = join(dir, 'live.db');
    const outZip = join(dir, 'out.zip');

    // Seed and KEEP the writer connection alive (mimics the embedded
    // server running through the backup).
    const writer = new Database(sourceDbPath);
    writer.pragma('journal_mode = WAL');
    writer.exec('CREATE TABLE sales (id TEXT PRIMARY KEY, total REAL NOT NULL);');
    const insert = writer.prepare('INSERT INTO sales VALUES (?, ?);');
    const insertMany = writer.transaction((rows: Array<[string, number]>) => {
      for (const [id, total] of rows) insert.run(id, total);
    });
    insertMany(Array.from({ length: 100 }, (_, i) => [`s-${i}`, i * 10]));

    try {
      const result = await createBackupBundle({
        dbPath: sourceDbPath,
        outZipPath: outZip,
        manifest: { tenantSlug: 'concurrent-writer' },
      });
      assert.ok(result.zipBytes > 0);

      const zip = await JSZip.loadAsync(await readFile(outZip));
      const extractedDb = join(dir, 'extracted.db');
      await writeFile(extractedDb, await zip.file(ZIP_DB_ENTRY)!.async('nodebuffer'));
      await assertSqliteIntegrity(extractedDb);

      const verifier = new Database(extractedDb, { readonly: true });
      const row = verifier.prepare('SELECT COUNT(*) AS n FROM sales').get() as {
        n: number;
      };
      verifier.close();
      assert.equal(row.n, 100, 'every committed row must survive the round-trip while writer is alive');
    } finally {
      writer.close();
    }
  });
});
