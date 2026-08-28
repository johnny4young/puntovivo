/**
 * backup-bundle helpers regression test.
 *
 * Pins the contract the IPC handlers in `index.ts` rely on:
 *
 * - `createBackupBundle()` produces a ZIP that opens cleanly,
 * contains `local.db` + (optionally) `device-id.txt`, and the
 * embedded DB passes `PRAGMA integrity_check`.
 * - `extractBackupBundle()` round-trips: a freshly-created bundle
 * extracts back to a usable DB + device-id pair.
 * - `assertSqliteIntegrity()` rejects a corrupted file before any
 * IPC handler tries to swap it into the live location.
 * - `detectBackupFormat()` distinguishes ZIP vs raw SQLite from the
 * first 4 magic bytes — the basis for legacy `.db` restore.
 * - `createBackupFileName()` produces ISO-sortable, tenant-scoped
 * names so attached support tickets sort cleanly.
 *
 * Runs under `node --test --experimental-strip-types` per the desktop
 * workspace test convention; no Vitest, no transpiler.
 */

import { describe, it, before, after } from 'node:test';
import { strict as assert } from 'node:assert';
import { createWriteStream, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { mkdtemp, open, readFile, readdir, rm, stat, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { finished } from 'node:stream/promises';
import { computeAuditHeadMacForSource } from '@puntovivo/server/audit-anchor';
import { ZipArchive } from 'archiver';
import Database from 'better-sqlite3';
import {
  BACKUP_BUNDLE_SCHEMA_VERSION,
  ZIP_DB_ENTRY,
  ZIP_DEVICE_ID_ENTRY,
  ZIP_MANIFEST_ENTRY,
  assertSqliteIntegrity,
  createBackupBundle,
  createBackupFileName,
  detectBackupFormat,
  extractBackupBundle,
  isCleartextSqliteFile,
  reanchorAuditHeadAnchors,
  rekeySqliteDatabase,
  sweepStaleBackupStaging,
} from '../backup/backup-bundle.ts';
import JSZip from 'jszip';
import { Open } from 'unzipper';

let scratchDir: string;
const ENCRYPTION_KEY = 'a'.repeat(64);

before(() => {
  scratchDir = mkdtempSync(join(tmpdir(), 'puntovivo-backup-test-'));
});

after(() => {
  rmSync(scratchDir, { recursive: true, force: true });
});

function seedSourceDb(path: string): { count: number } {
  const db = new Database(path);
  db.exec('CREATE TABLE sales (id TEXT PRIMARY KEY, total REAL NOT NULL);');
  db.exec("INSERT INTO sales VALUES ('s-1', 100.5);");
  db.exec("INSERT INTO sales VALUES ('s-2', 250.0);");
  db.exec("INSERT INTO sales VALUES ('s-3', 999.99);");
  const row = db.prepare('SELECT COUNT(*) AS n FROM sales').get() as { n: number };
  db.close();
  return { count: row.n };
}

function applySqlCipherKey(db: Database.Database): void {
  db.pragma("cipher = 'sqlcipher'");
  db.pragma('legacy = 4');
  db.pragma(`key = "x'${ENCRYPTION_KEY}'"`);
}

function seedEncryptedSourceDb(path: string): { count: number } {
  const db = new Database(path);
  applySqlCipherKey(db);
  db.exec('CREATE TABLE sales (id TEXT PRIMARY KEY, total REAL NOT NULL);');
  db.exec("INSERT INTO sales VALUES ('s-1', 100.5);");
  db.exec("INSERT INTO sales VALUES ('s-2', 250.0);");
  const row = db.prepare('SELECT COUNT(*) AS n FROM sales').get() as { n: number };
  db.close();
  return { count: row.n };
}

function seedEncryptedPerformanceDb(path: string, rows: number): void {
  const db = new Database(path);
  applySqlCipherKey(db);
  db.exec('CREATE TABLE sales (id TEXT PRIMARY KEY, total REAL NOT NULL, note TEXT NOT NULL);');
  const insert = db.prepare('INSERT INTO sales VALUES (?, ?, ?)');
  const insertAll = db.transaction(() => {
    for (let index = 0; index < rows; index += 1) {
      insert.run(`sale-${index}`, index + 0.5, `deterministic performance row ${index}`);
    }
  });
  insertAll();
  db.close();
}

async function writeArchiveWithDuplicateDatabase(path: string): Promise<void> {
  const archive = new ZipArchive({ store: true });
  const output = createWriteStream(path, { flags: 'wx' });
  archive.pipe(output);
  archive.append('first', { name: ZIP_DB_ENTRY });
  archive.append('second', { name: ZIP_DB_ENTRY });
  await archive.finalize();
  await finished(output);
}

async function overwriteStoredEntryByte(path: string, entryName: string): Promise<void> {
  const directory = await Open.file(path);
  const entry = directory.files.find(candidate => candidate.path === entryName);
  assert.ok(entry, `${entryName} must exist in fixture`);
  assert.equal(entry.compressionMethod, 0, 'fixture must store the entry without compression');
  const handle = await open(path, 'r+');
  try {
    const header = Buffer.alloc(30);
    const { bytesRead } = await handle.read(
      header,
      0,
      header.length,
      entry.offsetToLocalFileHeader
    );
    assert.equal(bytesRead, header.length);
    const payloadOffset =
      entry.offsetToLocalFileHeader + 30 + header.readUInt16LE(26) + header.readUInt16LE(28);
    const byte = Buffer.alloc(1);
    await handle.read(byte, 0, 1, payloadOffset + Math.floor(entry.uncompressedSize / 2));
    byte[0] = byte[0]! ^ 0xff;
    await handle.write(byte, 0, 1, payloadOffset + Math.floor(entry.uncompressedSize / 2));
  } finally {
    await handle.close();
  }
}

describe('createBackupFileName', () => {
  it('produces an ISO-sortable filename with .zip extension', () => {
    const fixed = new Date('2026-05-07T13:30:45.123Z');
    const name = createBackupFileName({ now: fixed });
    assert.match(name, /^puntovivo-backup-2026-05-07T13-30-45-\d{3}Z\.zip$/);
  });

  it('embeds the tenant slug between prefix and timestamp', () => {
    const fixed = new Date('2026-05-07T13:30:45.123Z');
    const name = createBackupFileName({ tenantSlug: 'demo-co', now: fixed });
    assert.match(name, /^puntovivo-backup-demo-co-2026-05-07T13-30-45-\d{3}Z\.zip$/);
  });

  it('sanitizes a slug with non-filename-safe characters', () => {
    const name = createBackupFileName({
      tenantSlug: 'tenant/with spaces?',
      now: new Date('2026-05-07T00:00:00.000Z'),
    });
    assert.ok(
      !/[/\s?]/.test(name),
      `filename '${name}' must not carry path separators or whitespace`
    );
  });
});

describe('createBackupBundle + assertSqliteIntegrity', () => {
  it('produces a ZIP that contains local.db + device-id.txt + manifest.json with integrity ok', async () => {
    const dir = await mkdtemp(join(scratchDir, 'bundle-'));
    const sourceDbPath = join(dir, 'live.db');
    const deviceIdPath = join(dir, 'device-id.txt');
    const outZip = join(dir, 'out.zip');

    const { count } = seedSourceDb(sourceDbPath);
    await writeFile(deviceIdPath, 'device-uuid-fixture\n', 'utf8');

    const result = await createBackupBundle({
      dbPath: sourceDbPath,
      deviceIdPath,
      outZipPath: outZip,
      manifest: { tenantSlug: 'demo-co' },
    });

    assert.equal(result.zipPath, outZip);
    assert.ok(result.zipBytes > 0, 'zip must have non-zero size');
    assert.equal(result.manifest.schemaVersion, BACKUP_BUNDLE_SCHEMA_VERSION);
    assert.equal(result.manifest.tenantSlug, 'demo-co');
    assert.ok(result.manifest.dbBytes > 0);

    const zip = await JSZip.loadAsync(await readFile(outZip));
    assert.ok(zip.file(ZIP_DB_ENTRY), 'local.db entry must exist');
    assert.ok(zip.file(ZIP_DEVICE_ID_ENTRY), 'device-id.txt entry must exist');
    assert.ok(zip.file(ZIP_MANIFEST_ENTRY), 'manifest.json entry must exist');

    const extractedDb = join(dir, 'extracted.db');
    await writeFile(extractedDb, await zip.file(ZIP_DB_ENTRY)!.async('nodebuffer'));
    await assertSqliteIntegrity(extractedDb);

    const verifier = new Database(extractedDb, { readonly: true });
    const rows = verifier.prepare('SELECT COUNT(*) AS n FROM sales').get() as {
      n: number;
    };
    verifier.close();
    assert.equal(rows.n, count, 'restored DB must carry the same sales count');
  });

  it('omits device-id.txt when no path is supplied', async () => {
    const dir = await mkdtemp(join(scratchDir, 'bundle-no-device-'));
    const sourceDbPath = join(dir, 'live.db');
    const outZip = join(dir, 'out.zip');
    seedSourceDb(sourceDbPath);

    await createBackupBundle({
      dbPath: sourceDbPath,
      outZipPath: outZip,
    });

    const zip = await JSZip.loadAsync(await readFile(outZip));
    assert.ok(zip.file(ZIP_DB_ENTRY), 'local.db must still be present');
    assert.equal(
      zip.file(ZIP_DEVICE_ID_ENTRY),
      null,
      'device-id.txt must be absent when not supplied'
    );
  });

  it('backs up encrypted DBs without emitting a cleartext local.db entry', async () => {
    const dir = await mkdtemp(join(scratchDir, 'bundle-encrypted-'));
    const sourceDbPath = join(dir, 'live.db');
    const outZip = join(dir, 'out.zip');

    const { count } = seedEncryptedSourceDb(sourceDbPath);

    await createBackupBundle({
      dbPath: sourceDbPath,
      outZipPath: outZip,
      encryptionKey: ENCRYPTION_KEY,
    });

    const zip = await JSZip.loadAsync(await readFile(outZip));
    const extractedDb = join(dir, 'encrypted-extracted.db');
    await writeFile(extractedDb, await zip.file(ZIP_DB_ENTRY)!.async('nodebuffer'));
    await assertSqliteIntegrity(extractedDb, { encryptionKey: ENCRYPTION_KEY });

    const plain = new Database(extractedDb, { readonly: true });
    assert.throws(
      () => plain.prepare('SELECT COUNT(*) AS n FROM sales').get(),
      /file is not a database|SQLITE_NOTADB/i,
      'backup ZIP must not carry a plaintext DB'
    );
    plain.close();

    const verifier = new Database(extractedDb, { readonly: true });
    applySqlCipherKey(verifier);
    const rows = verifier.prepare('SELECT COUNT(*) AS n FROM sales').get() as {
      n: number;
    };
    verifier.close();
    assert.equal(rows.n, count, 'encrypted backup must carry every source row');
  });

  it('creates and extracts a store-sized encrypted backup within the shared elapsed budget', async () => {
    const budget = JSON.parse(
      readFileSync(join(process.cwd(), '..', '..', 'perf-budget.json'), 'utf8')
    ) as {
      operationalProfile: {
        thresholdPercent: number;
        encryptedBackup: {
          rows: number;
          createElapsedMs: number;
          extractElapsedMs: number;
        };
      };
    };
    const contract = budget.operationalProfile.encryptedBackup;
    const tolerance = 1 + budget.operationalProfile.thresholdPercent / 100;
    const dir = await mkdtemp(join(scratchDir, 'bundle-performance-'));
    const sourceDbPath = join(dir, 'live.db');
    const outZip = join(dir, 'out.zip');
    seedEncryptedPerformanceDb(sourceDbPath, contract.rows);

    const createStart = performance.now();
    await createBackupBundle({
      dbPath: sourceDbPath,
      outZipPath: outZip,
      encryptionKey: ENCRYPTION_KEY,
    });
    const createElapsedMs = performance.now() - createStart;
    assert.ok(
      createElapsedMs <= contract.createElapsedMs * tolerance,
      `encrypted backup creation ${createElapsedMs.toFixed(2)}ms exceeded ${contract.createElapsedMs}ms + ${budget.operationalProfile.thresholdPercent}%`
    );

    const extractStart = performance.now();
    const extracted = await extractBackupBundle(outZip, join(dir, 'extracted'));
    await assertSqliteIntegrity(extracted.dbPath, { encryptionKey: ENCRYPTION_KEY });
    const extractElapsedMs = performance.now() - extractStart;
    assert.ok(
      extractElapsedMs <= contract.extractElapsedMs * tolerance,
      `encrypted backup extraction ${extractElapsedMs.toFixed(2)}ms exceeded ${contract.extractElapsedMs}ms + ${budget.operationalProfile.thresholdPercent}%`
    );

    const verifier = new Database(extracted.dbPath, { readonly: true });
    applySqlCipherKey(verifier);
    const row = verifier.prepare('SELECT count(*) AS count FROM sales').get() as { count: number };
    verifier.close();
    assert.equal(row.count, contract.rows);
    process.stdout.write(
      `desktop-operational-profile measured=${JSON.stringify({ encryptedBackup: { rows: contract.rows, createElapsedMs: Number(createElapsedMs.toFixed(2)), extractElapsedMs: Number(extractElapsedMs.toFixed(2)) } })}\n`
    );
  });

  it('throws when the source DB is corrupted', async () => {
    const dir = await mkdtemp(join(scratchDir, 'bundle-bad-'));
    const corruptedDb = join(dir, 'live.db');
    writeFileSync(corruptedDb, Buffer.from('not a sqlite file at all'));

    await assert.rejects(
      createBackupBundle({
        dbPath: corruptedDb,
        outZipPath: join(dir, 'out.zip'),
      }),
      /file is not a database|backup integrity check failed|not a database/i
    );
  });
});

describe('assertSqliteIntegrity', () => {
  it('passes on a clean DB', async () => {
    const dir = await mkdtemp(join(scratchDir, 'integrity-ok-'));
    const path = join(dir, 'clean.db');
    seedSourceDb(path);
    await assert.doesNotReject(assertSqliteIntegrity(path));
  });

  it('fails on a truncated DB', async () => {
    const dir = await mkdtemp(join(scratchDir, 'integrity-bad-'));
    const fullPath = join(dir, 'full.db');
    seedSourceDb(fullPath);

    const bytes = (await readFile(fullPath)).subarray(0, 256);
    const truncated = join(dir, 'truncated.db');
    await writeFile(truncated, bytes);

    await assert.rejects(assertSqliteIntegrity(truncated), /Backup integrity check failed/i);
  });
});

describe('detectBackupFormat', () => {
  it('returns "zip" for a ZIP file', async () => {
    const dir = await mkdtemp(join(scratchDir, 'detect-zip-'));
    const path = join(dir, 'sample.zip');
    const zip = new JSZip();
    zip.file('a.txt', 'hello');
    await writeFile(path, await zip.generateAsync({ type: 'nodebuffer' }));
    assert.equal(await detectBackupFormat(path), 'zip');
  });

  it('returns "sqlite" for a raw SQLite DB', async () => {
    const dir = await mkdtemp(join(scratchDir, 'detect-sqlite-'));
    const path = join(dir, 'sample.db');
    seedSourceDb(path);
    assert.equal(await detectBackupFormat(path), 'sqlite');
  });

  it('returns "unknown" for arbitrary text', async () => {
    const dir = await mkdtemp(join(scratchDir, 'detect-unknown-'));
    const path = join(dir, 'sample.txt');
    await writeFile(path, 'plain text, not a backup at all');
    assert.equal(await detectBackupFormat(path), 'unknown');
  });
});

describe('extractBackupBundle', () => {
  it('round-trips a ZIP bundle: DB extracts, integrity passes, device-id preserved', async () => {
    const dir = await mkdtemp(join(scratchDir, 'extract-zip-'));
    const sourceDbPath = join(dir, 'live.db');
    const deviceIdPath = join(dir, 'device-id.txt');
    const zipPath = join(dir, 'out.zip');

    const { count } = seedSourceDb(sourceDbPath);
    await writeFile(deviceIdPath, 'device-roundtrip-fixture');
    await createBackupBundle({
      dbPath: sourceDbPath,
      deviceIdPath,
      outZipPath: zipPath,
    });

    const extractDir = join(dir, 'extract');
    const extracted = await extractBackupBundle(zipPath, extractDir);
    assert.equal(extracted.format, 'zip');
    assert.ok(extracted.deviceIdPath, 'device-id path must be returned');
    await assertSqliteIntegrity(extracted.dbPath);

    const verifier = new Database(extracted.dbPath, { readonly: true });
    const row = verifier.prepare('SELECT COUNT(*) AS n FROM sales').get() as {
      n: number;
    };
    verifier.close();
    assert.equal(row.n, count);

    const deviceId = (await readFile(extracted.deviceIdPath!, 'utf8')).trim();
    assert.equal(deviceId, 'device-roundtrip-fixture');
  });

  it('keeps reader compatibility with deflated legacy ZIP entries', async () => {
    const dir = await mkdtemp(join(scratchDir, 'extract-deflate-'));
    const sourceDbPath = join(dir, 'live.db');
    const zipPath = join(dir, 'deflated.zip');
    const { count } = seedSourceDb(sourceDbPath);
    const zip = new JSZip();
    zip.file(ZIP_DB_ENTRY, await readFile(sourceDbPath), { compression: 'DEFLATE' });
    zip.file(
      ZIP_MANIFEST_ENTRY,
      JSON.stringify({
        schemaVersion: 1,
        generatedAt: '2026-08-28T00:00:00.000Z',
        dbBytes: (await stat(sourceDbPath)).size,
      }),
      { compression: 'DEFLATE' }
    );
    await writeFile(
      zipPath,
      await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' })
    );

    const extracted = await extractBackupBundle(zipPath, join(dir, 'out'));
    await assertSqliteIntegrity(extracted.dbPath);
    const verifier = new Database(extracted.dbPath, { readonly: true });
    const row = verifier.prepare('SELECT count(*) AS count FROM sales').get() as {
      count: number;
    };
    verifier.close();
    assert.equal(row.count, count);
  });

  it('passes raw .db through unchanged (legacy format)', async () => {
    const dir = await mkdtemp(join(scratchDir, 'extract-legacy-'));
    const sourceDbPath = join(dir, 'legacy.db');
    seedSourceDb(sourceDbPath);

    const extracted = await extractBackupBundle(sourceDbPath, join(dir, 'unused'));
    assert.equal(extracted.format, 'sqlite');
    assert.equal(extracted.dbPath, sourceDbPath);
    assert.equal(extracted.deviceIdPath, undefined);
  });

  it('throws on an unrecognized file format', async () => {
    const dir = await mkdtemp(join(scratchDir, 'extract-bad-'));
    const path = join(dir, 'random.txt');
    await writeFile(path, 'totally not a backup');

    await assert.rejects(extractBackupBundle(path, join(dir, 'unused')), /unrecognized/i);
  });

  it('throws when ZIP is missing the required local.db entry', async () => {
    const dir = await mkdtemp(join(scratchDir, 'extract-empty-zip-'));
    const path = join(dir, 'empty.zip');
    const zip = new JSZip();
    // use an allowlisted entry so the archive clears the
    // allowlist gate and reaches the missing-local.db check below.
    zip.file(ZIP_MANIFEST_ENTRY, '{}');
    await writeFile(path, await zip.generateAsync({ type: 'nodebuffer' }));

    await assert.rejects(
      extractBackupBundle(path, join(dir, 'unused')),
      /missing the required.*local\.db/i
    );
  });

  it('rejects a ZIP carrying a path-traversal entry', async () => {
    const dir = await mkdtemp(join(scratchDir, 'extract-traversal-'));
    const path = join(dir, 'evil.zip');
    const zip = new JSZip();
    zip.file(ZIP_DB_ENTRY, 'x');
    // JSZip stores the original unsafe name separately while exposing a
    // sanitized key at load time; keep createFolders false so the test
    // proves the extractor validates that unsafeOriginalName, not just a
    // synthetic "/" directory entry.
    zip.file('../local.db', 'pwned', { createFolders: false });
    await writeFile(path, await zip.generateAsync({ type: 'nodebuffer' }));

    await assert.rejects(extractBackupBundle(path, join(dir, 'out')), /path-traversal/i);
  });

  it('rejects a ZIP carrying an unexpected, non-allowlisted entry', async () => {
    const dir = await mkdtemp(join(scratchDir, 'extract-extra-'));
    const path = join(dir, 'extra.zip');
    const zip = new JSZip();
    zip.file(ZIP_DB_ENTRY, 'x');
    zip.file('notes.txt', 'extra payload');
    await writeFile(path, await zip.generateAsync({ type: 'nodebuffer' }));

    await assert.rejects(extractBackupBundle(path, join(dir, 'out')), /unexpected entry/i);
  });

  it('rejects duplicate allowlisted entries before publishing a restore file', async () => {
    const dir = await mkdtemp(join(scratchDir, 'extract-duplicate-'));
    const path = join(dir, 'duplicate.zip');
    const outDir = join(dir, 'out');
    await writeArchiveWithDuplicateDatabase(path);

    await assert.rejects(extractBackupBundle(path, outDir), /duplicate entry 'local\.db'/i);
    await assert.rejects(stat(outDir), { code: 'ENOENT' });
  });

  it('rejects symlinks even when their allowlisted name looks safe', async () => {
    const dir = await mkdtemp(join(scratchDir, 'extract-symlink-'));
    const path = join(dir, 'symlink.zip');
    const zip = new JSZip();
    zip.file(ZIP_DB_ENTRY, 'attacker target', { unixPermissions: 0o120777 });
    await writeFile(path, await zip.generateAsync({ type: 'nodebuffer', platform: 'UNIX' }));

    await assert.rejects(extractBackupBundle(path, join(dir, 'out')), /never.*symlink/i);
  });

  it('rejects oversized metadata before allocating or publishing it', async () => {
    const dir = await mkdtemp(join(scratchDir, 'extract-oversized-metadata-'));
    const path = join(dir, 'oversized.zip');
    const zip = new JSZip();
    zip.file(ZIP_DB_ENTRY, 'x');
    zip.file(ZIP_MANIFEST_ENTRY, 'm'.repeat(64 * 1024 + 1));
    await writeFile(path, await zip.generateAsync({ type: 'nodebuffer' }));

    await assert.rejects(extractBackupBundle(path, join(dir, 'out')), /manifest\.json.*limit/i);
  });

  it('rejects a present malformed manifest instead of downgrading it to legacy unsigned', async () => {
    const dir = await mkdtemp(join(scratchDir, 'extract-malformed-manifest-'));
    const sourceDbPath = join(dir, 'live.db');
    const path = join(dir, 'malformed.zip');
    seedSourceDb(sourceDbPath);
    const zip = new JSZip();
    zip.file(ZIP_DB_ENTRY, await readFile(sourceDbPath));
    zip.file(ZIP_MANIFEST_ENTRY, '{not-json');
    await writeFile(path, await zip.generateAsync({ type: 'nodebuffer' }));

    await assert.rejects(
      extractBackupBundle(path, join(dir, 'out')),
      /manifest\.json.*valid JSON/i
    );

    const wrongShapePath = join(dir, 'wrong-shape.zip');
    const wrongShape = new JSZip();
    wrongShape.file(ZIP_DB_ENTRY, await readFile(sourceDbPath));
    wrongShape.file(ZIP_MANIFEST_ENTRY, '{}');
    await writeFile(wrongShapePath, await wrongShape.generateAsync({ type: 'nodebuffer' }));
    await assert.rejects(
      extractBackupBundle(wrongShapePath, join(dir, 'wrong-shape-out')),
      /manifest\.json.*supported manifest shape/i
    );
  });

  it('rejects a local-header identity that disagrees with the central directory', async () => {
    const dir = await mkdtemp(join(scratchDir, 'extract-local-name-'));
    const path = join(dir, 'mismatch.zip');
    const zip = new JSZip();
    zip.file(ZIP_DB_ENTRY, 'x');
    await writeFile(path, await zip.generateAsync({ type: 'nodebuffer' }));
    const directory = await Open.file(path);
    const entry = directory.files.find(candidate => candidate.path === ZIP_DB_ENTRY)!;
    const handle = await open(path, 'r+');
    try {
      await handle.write(
        Buffer.from('locxl.db'),
        0,
        ZIP_DB_ENTRY.length,
        entry.offsetToLocalFileHeader + 30
      );
    } finally {
      await handle.close();
    }

    await assert.rejects(extractBackupBundle(path, join(dir, 'out')), /different identity/i);
  });

  it('rejects a truncated archive and a CRC-corrupted payload without partial output', async () => {
    const dir = await mkdtemp(join(scratchDir, 'extract-truncated-'));
    const sourceDbPath = join(dir, 'live.db');
    const completePath = join(dir, 'complete.zip');
    seedSourceDb(sourceDbPath);
    await createBackupBundle({ dbPath: sourceDbPath, outZipPath: completePath });

    const truncatedPath = join(dir, 'truncated.zip');
    const completeBytes = await readFile(completePath);
    await writeFile(truncatedPath, completeBytes.subarray(0, completeBytes.length - 12));
    await assert.rejects(
      extractBackupBundle(truncatedPath, join(dir, 'truncated-out')),
      /central directory is truncated or malformed/i
    );

    await overwriteStoredEntryByte(completePath, ZIP_DB_ENTRY);
    const crcOut = join(dir, 'crc-out');
    await assert.rejects(extractBackupBundle(completePath, crcOut), /CRC integrity check/i);
    assert.deepEqual(await readdir(crcOut), []);
  });
});

// helpers the cross-device restore and the first-boot
// encryption migration are built on.
describe('isCleartextSqliteFile / rekeySqliteDatabase', () => {
  const FOREIGN_KEY = 'b'.repeat(64);

  it('detects cleartext SQLite, rejects encrypted files and missing paths', async () => {
    const dir = await mkdtemp(join(scratchDir, 'cleartext-detect-'));

    const clearPath = join(dir, 'clear.db');
    seedSourceDb(clearPath);
    assert.equal(await isCleartextSqliteFile(clearPath), true);

    const encryptedPath = join(dir, 'encrypted.db');
    seedEncryptedSourceDb(encryptedPath);
    assert.equal(await isCleartextSqliteFile(encryptedPath), false);

    assert.equal(await isCleartextSqliteFile(join(dir, 'missing.db')), false);
  });

  it('rekeys an encrypted DB from a foreign key to the local key (cross-device restore path)', async () => {
    const dir = await mkdtemp(join(scratchDir, 'rekey-cross-'));
    const dbPath = join(dir, 'foreign.db');

    // Seed under the FOREIGN key (the source device).
    const source = new Database(dbPath);
    source.pragma("cipher = 'sqlcipher'");
    source.pragma('legacy = 4');
    source.pragma(`key = "x'${FOREIGN_KEY}'"`);
    source.exec('CREATE TABLE sales (id TEXT PRIMARY KEY, total REAL NOT NULL);');
    source.exec("INSERT INTO sales VALUES ('s-1', 42.0);");
    source.close();

    // The local key cannot open it before the rekey.
    await assert.rejects(assertSqliteIntegrity(dbPath, { encryptionKey: ENCRYPTION_KEY }));

    rekeySqliteDatabase(dbPath, { fromKey: FOREIGN_KEY, toKey: ENCRYPTION_KEY });

    // Now the local key opens it and the data survived…
    await assertSqliteIntegrity(dbPath, { encryptionKey: ENCRYPTION_KEY });
    const reopened = new Database(dbPath, { fileMustExist: true });
    reopened.pragma("cipher = 'sqlcipher'");
    reopened.pragma('legacy = 4');
    reopened.pragma(`key = "x'${ENCRYPTION_KEY}'"`);
    const row = reopened.prepare('SELECT total FROM sales WHERE id = ?').get('s-1') as {
      total: number;
    };
    reopened.close();
    assert.equal(row.total, 42.0);

    // …and the foreign key no longer does.
    await assert.rejects(assertSqliteIntegrity(dbPath, { encryptionKey: FOREIGN_KEY }));
  });

  it('rejects malformed keys without touching the file', async () => {
    const dir = await mkdtemp(join(scratchDir, 'rekey-badkey-'));
    const dbPath = join(dir, 'clear.db');
    seedSourceDb(dbPath);
    const before = await readFile(dbPath);

    assert.throws(() => rekeySqliteDatabase(dbPath, { toKey: 'definitely-not-hex' }));
    assert.deepEqual(await readFile(dbPath), before);
  });

  it('reanchors restored audit heads under the destination secret', async () => {
    const dir = await mkdtemp(join(scratchDir, 'reanchor-'));
    const dbPath = join(dir, 'restored.db');
    const tenantId = 'tenant-restored';
    const headHash = 'c'.repeat(64);
    const destinationAnchor = 'd'.repeat(64);
    const db = new Database(dbPath);
    db.pragma("cipher = 'sqlcipher'");
    db.pragma('legacy = 4');
    db.pragma(`key = "x'${ENCRYPTION_KEY}'"`);
    db.exec(
      'CREATE TABLE audit_chain_heads (tenant_id TEXT PRIMARY KEY, head_hash TEXT NOT NULL, head_mac TEXT, updated_at TEXT NOT NULL)'
    );
    db.prepare(
      'INSERT INTO audit_chain_heads (tenant_id, head_hash, head_mac, updated_at) VALUES (?, ?, NULL, ?)'
    ).run(tenantId, headHash, new Date().toISOString());
    db.close();

    assert.equal(reanchorAuditHeadAnchors(dbPath, ENCRYPTION_KEY, destinationAnchor), 1);
    const reopened = new Database(dbPath, { fileMustExist: true });
    reopened.pragma("cipher = 'sqlcipher'");
    reopened.pragma('legacy = 4');
    reopened.pragma(`key = "x'${ENCRYPTION_KEY}'"`);
    const row = reopened
      .prepare('SELECT head_mac AS headMac FROM audit_chain_heads WHERE tenant_id = ?')
      .get(tenantId) as { headMac: string };
    reopened.close();

    const expected = computeAuditHeadMacForSource(destinationAnchor, tenantId, headHash);
    assert.equal(row.headMac, expected);
  });
});

describe('sweepStaleBackupStaging', () => {
  async function dirExists(path: string): Promise<boolean> {
    try {
      return (await stat(path)).isDirectory();
    } catch {
      return false;
    }
  }

  it('removes only prefixed staging dirs older than the age threshold', async () => {
    // These live in the REAL OS tmpdir on purpose — that is the
    // surface the sweep operates on at startup.
    const staleRestore = await mkdtemp(join(tmpdir(), 'puntovivo-restore-'));
    const staleBackup = await mkdtemp(join(tmpdir(), 'puntovivo-backup-'));
    const freshRestore = await mkdtemp(join(tmpdir(), 'puntovivo-restore-'));
    const unrelated = await mkdtemp(join(tmpdir(), 'puntovivo-unrelated-'));
    try {
      const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
      await utimes(staleRestore, twoHoursAgo, twoHoursAgo);
      await utimes(staleBackup, twoHoursAgo, twoHoursAgo);
      await utimes(unrelated, twoHoursAgo, twoHoursAgo);

      const removed = await sweepStaleBackupStaging();

      // Stale + prefixed: swept (and reported).
      assert.equal(removed.includes(staleRestore), true);
      assert.equal(removed.includes(staleBackup), true);
      assert.equal(await dirExists(staleRestore), false);
      assert.equal(await dirExists(staleBackup), false);
      // Fresh prefixed dir (a concurrently running instance's live
      // staging) and old-but-unprefixed dirs survive.
      assert.equal(await dirExists(freshRestore), true);
      assert.equal(await dirExists(unrelated), true);
    } finally {
      for (const path of [staleRestore, staleBackup, freshRestore, unrelated]) {
        await rm(path, { recursive: true, force: true });
      }
    }
  });
});
