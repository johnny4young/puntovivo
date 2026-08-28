/**
 * Bundle authenticity (manifest v2 MAC) + passphrase key-wrap.
 */

import { describe, it, before, after } from 'node:test';
import { strict as assert } from 'node:assert';
import { createDecipheriv, scryptSync } from 'node:crypto';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import JSZip from 'jszip';
import {
  ZIP_DB_ENTRY,
  ZIP_MANIFEST_ENTRY,
  createBackupBundle,
  extractBackupBundle,
  unwrapBackupKey,
  verifyExtractedBundleAuthenticity,
  wrapBackupKey,
  type BackupManifest,
} from '../backup/backup-bundle.ts';
import { computeBackupManifestMac } from '../backup/backup-bundle/authenticity.ts';

let scratchDir: string;
const ENCRYPTION_KEY = 'c3'.repeat(32);
let caseId = 0;

before(() => {
  scratchDir = mkdtempSync(join(tmpdir(), 'puntovivo-auth-test-'));
});

after(() => {
  rmSync(scratchDir, { recursive: true, force: true });
});

function freshPaths(): { dbPath: string; zipPath: string; outDir: string } {
  caseId += 1;
  return {
    dbPath: join(scratchDir, `src-${caseId}.db`),
    zipPath: join(scratchDir, `bundle-${caseId}.zip`),
    outDir: join(scratchDir, `out-${caseId}`),
  };
}

function seedEncryptedDb(path: string): void {
  const db = new Database(path);
  db.pragma("cipher = 'sqlcipher'");
  db.pragma('legacy = 4');
  db.pragma(`key = "x'${ENCRYPTION_KEY}'"`);
  db.exec("CREATE TABLE t (x TEXT); INSERT INTO t VALUES ('v');");
  db.close();
}

async function repackZip(
  zipPath: string,
  mutate: (zip: JSZip) => Promise<void> | void
): Promise<void> {
  const zip = await JSZip.loadAsync(await readFile(zipPath));
  await mutate(zip);
  await writeFile(zipPath, await zip.generateAsync({ type: 'nodebuffer' }));
}

describe('bundle authenticity (manifest v2)', () => {
  it('a freshly created encrypted bundle verifies end to end', async () => {
    const { dbPath, zipPath, outDir } = freshPaths();
    seedEncryptedDb(dbPath);
    const created = await createBackupBundle({
      dbPath,
      outZipPath: zipPath,
      encryptionKey: ENCRYPTION_KEY,
    });
    assert.ok(created.manifest.manifestMac, 'encrypted bundles carry a manifest MAC');
    assert.ok(created.manifest.dbSha256, 'manifest binds the db bytes');

    const extracted = await extractBackupBundle(zipPath, outDir);
    const verdict = await verifyExtractedBundleAuthenticity({
      manifest: extracted.manifest,
      dbPath: extracted.dbPath,
      deviceIdPath: extracted.deviceIdPath,
      encryptionKey: ENCRYPTION_KEY,
    });
    assert.deepEqual(verdict, { status: 'verified' });
  });

  it('detects a manifest edited after creation', async () => {
    const { dbPath, zipPath, outDir } = freshPaths();
    seedEncryptedDb(dbPath);
    await createBackupBundle({ dbPath, outZipPath: zipPath, encryptionKey: ENCRYPTION_KEY });
    await repackZip(zipPath, async zip => {
      const manifest = JSON.parse(
        await zip.file(ZIP_MANIFEST_ENTRY)!.async('string')
      ) as BackupManifest;
      manifest.tenantSlug = 'forged-tenant';
      zip.file(ZIP_MANIFEST_ENTRY, JSON.stringify(manifest));
    });

    const extracted = await extractBackupBundle(zipPath, outDir);
    const verdict = await verifyExtractedBundleAuthenticity({
      manifest: extracted.manifest,
      dbPath: extracted.dbPath,
      encryptionKey: ENCRYPTION_KEY,
    });
    assert.deepEqual(verdict, { status: 'failed', reason: 'manifest-mac' });
  });

  it('detects a swapped database payload', async () => {
    const { dbPath, zipPath, outDir } = freshPaths();
    seedEncryptedDb(dbPath);
    await createBackupBundle({ dbPath, outZipPath: zipPath, encryptionKey: ENCRYPTION_KEY });
    // Replace the DB entry with a DIFFERENT (also valid) encrypted DB
    // while keeping the signed manifest — a repackaging attack.
    const otherDb = join(scratchDir, `other-${caseId}.db`);
    seedEncryptedDb(otherDb);
    await repackZip(zipPath, async zip => {
      zip.file(ZIP_DB_ENTRY, await readFile(otherDb));
    });

    const extracted = await extractBackupBundle(zipPath, outDir);
    const verdict = await verifyExtractedBundleAuthenticity({
      manifest: extracted.manifest,
      dbPath: extracted.dbPath,
      encryptionKey: ENCRYPTION_KEY,
    });
    assert.deepEqual(verdict, { status: 'failed', reason: 'db-digest' });
  });

  it('detects a removed device identity and an injected one', async () => {
    const { dbPath, zipPath, outDir } = freshPaths();
    seedEncryptedDb(dbPath);
    const deviceIdPath = join(scratchDir, `device-${caseId}.txt`);
    await writeFile(deviceIdPath, 'device-original');
    await createBackupBundle({
      dbPath,
      deviceIdPath,
      outZipPath: zipPath,
      encryptionKey: ENCRYPTION_KEY,
    });
    // Removal: delete the entry, keep the signed manifest.
    await repackZip(zipPath, zip => {
      zip.remove('device-id.txt');
    });
    let extracted = await extractBackupBundle(zipPath, outDir);
    let verdict = await verifyExtractedBundleAuthenticity({
      manifest: extracted.manifest,
      dbPath: extracted.dbPath,
      deviceIdPath: extracted.deviceIdPath,
      encryptionKey: ENCRYPTION_KEY,
    });
    assert.deepEqual(verdict, { status: 'failed', reason: 'device-id-digest' });

    // Injection: a bundle signed WITHOUT a device id gains one.
    const { dbPath: db2, zipPath: zip2, outDir: out2 } = freshPaths();
    seedEncryptedDb(db2);
    await createBackupBundle({ dbPath: db2, outZipPath: zip2, encryptionKey: ENCRYPTION_KEY });
    await repackZip(zip2, zip => {
      zip.file('device-id.txt', 'attacker-device');
    });
    extracted = await extractBackupBundle(zip2, out2);
    verdict = await verifyExtractedBundleAuthenticity({
      manifest: extracted.manifest,
      dbPath: extracted.dbPath,
      deviceIdPath: extracted.deviceIdPath,
      encryptionKey: ENCRYPTION_KEY,
    });
    assert.deepEqual(verdict, { status: 'failed', reason: 'device-id-digest' });
  });

  it('detects a stripped or replaced key-wrap', async () => {
    const { dbPath, zipPath, outDir } = freshPaths();
    seedEncryptedDb(dbPath);
    await createBackupBundle({
      dbPath,
      outZipPath: zipPath,
      encryptionKey: ENCRYPTION_KEY,
      passphrase: 'una frase de recuperacion',
    });
    // Strip the wrap while keeping the signed manifest.
    await repackZip(zipPath, zip => {
      zip.remove('key-wrap.json');
    });
    const extracted = await extractBackupBundle(zipPath, outDir);
    const verdict = await verifyExtractedBundleAuthenticity({
      manifest: extracted.manifest,
      dbPath: extracted.dbPath,
      keyWrapRaw: extracted.keyWrapRaw,
      encryptionKey: ENCRYPTION_KEY,
    });
    assert.deepEqual(verdict, { status: 'failed', reason: 'key-wrap-digest' });

    // Replacement: swap the wrap for one under a different passphrase.
    const { dbPath: db2, zipPath: zip2, outDir: out2 } = freshPaths();
    seedEncryptedDb(db2);
    await createBackupBundle({
      dbPath: db2,
      outZipPath: zip2,
      encryptionKey: ENCRYPTION_KEY,
      passphrase: 'una frase de recuperacion',
    });
    await repackZip(zip2, async zip => {
      zip.file(
        'key-wrap.json',
        JSON.stringify(await wrapBackupKey(ENCRYPTION_KEY, 'otra frase diferente'))
      );
    });
    const extracted2 = await extractBackupBundle(zip2, out2);
    const verdict2 = await verifyExtractedBundleAuthenticity({
      manifest: extracted2.manifest,
      dbPath: extracted2.dbPath,
      keyWrapRaw: extracted2.keyWrapRaw,
      encryptionKey: ENCRYPTION_KEY,
    });
    assert.deepEqual(verdict2, { status: 'failed', reason: 'key-wrap-digest' });
  });

  it('tolerates a v1 bundle without a MAC as legacy-unsigned', async () => {
    const { dbPath, zipPath, outDir } = freshPaths();
    seedEncryptedDb(dbPath);
    await createBackupBundle({ dbPath, outZipPath: zipPath, encryptionKey: ENCRYPTION_KEY });
    await repackZip(zipPath, async zip => {
      const manifest = JSON.parse(
        await zip.file(ZIP_MANIFEST_ENTRY)!.async('string')
      ) as BackupManifest;
      delete manifest.manifestMac;
      delete manifest.dbSha256;
      manifest.schemaVersion = 1;
      zip.file(ZIP_MANIFEST_ENTRY, JSON.stringify(manifest));
    });

    const extracted = await extractBackupBundle(zipPath, outDir);
    const verdict = await verifyExtractedBundleAuthenticity({
      manifest: extracted.manifest,
      dbPath: extracted.dbPath,
      encryptionKey: ENCRYPTION_KEY,
    });
    assert.deepEqual(verdict, { status: 'legacy-unsigned' });
  });

  it('rejects a v2 bundle whose manifest MAC was stripped', async () => {
    const { dbPath, zipPath, outDir } = freshPaths();
    seedEncryptedDb(dbPath);
    await createBackupBundle({ dbPath, outZipPath: zipPath, encryptionKey: ENCRYPTION_KEY });
    await repackZip(zipPath, async zip => {
      const manifest = JSON.parse(
        await zip.file(ZIP_MANIFEST_ENTRY)!.async('string')
      ) as BackupManifest;
      delete manifest.manifestMac;
      zip.file(ZIP_MANIFEST_ENTRY, JSON.stringify(manifest));
    });

    const extracted = await extractBackupBundle(zipPath, outDir);
    const verdict = await verifyExtractedBundleAuthenticity({
      manifest: extracted.manifest,
      dbPath: extracted.dbPath,
      encryptionKey: ENCRYPTION_KEY,
    });
    assert.deepEqual(verdict, { status: 'failed', reason: 'manifest-mac' });
  });

  it('rejects an authenticated v2 manifest without its database digest', async () => {
    const { dbPath, zipPath, outDir } = freshPaths();
    seedEncryptedDb(dbPath);
    await createBackupBundle({ dbPath, outZipPath: zipPath, encryptionKey: ENCRYPTION_KEY });
    await repackZip(zipPath, async zip => {
      const manifest = JSON.parse(
        await zip.file(ZIP_MANIFEST_ENTRY)!.async('string')
      ) as BackupManifest;
      delete manifest.dbSha256;
      // Model a producer that knows the key but emits an incomplete v2
      // manifest: even its internally valid MAC cannot remove the
      // mandatory payload binding.
      manifest.manifestMac = computeBackupManifestMac(manifest, ENCRYPTION_KEY);
      zip.file(ZIP_MANIFEST_ENTRY, JSON.stringify(manifest));
    });

    const extracted = await extractBackupBundle(zipPath, outDir);
    const verdict = await verifyExtractedBundleAuthenticity({
      manifest: extracted.manifest,
      dbPath: extracted.dbPath,
      encryptionKey: ENCRYPTION_KEY,
    });
    assert.deepEqual(verdict, { status: 'failed', reason: 'db-digest' });
  });
});

describe('passphrase key-wrap', () => {
  it('round-trips the install key through a passphrase', async () => {
    const wrap = await wrapBackupKey(ENCRYPTION_KEY, 'correct horse battery');
    assert.equal(await unwrapBackupKey(wrap, 'correct horse battery'), ENCRYPTION_KEY);
  });

  it('returns null on a wrong passphrase instead of throwing', async () => {
    const wrap = await wrapBackupKey(ENCRYPTION_KEY, 'correct horse battery');
    assert.equal(await unwrapBackupKey(wrap, 'wrong horse battery!'), null);
  });

  it('rejects a too-short passphrase at wrap time', async () => {
    await assert.rejects(wrapBackupKey(ENCRYPTION_KEY, 'short'), /BACKUP_PASSPHRASE_TOO_SHORT/);
  });

  it('bounds hostile KDF parameters instead of grinding the CPU', async () => {
    const wrap = await wrapBackupKey(ENCRYPTION_KEY, 'correct horse battery');
    assert.equal(await unwrapBackupKey({ ...wrap, n: 2 ** 30 }, 'correct horse battery'), null);
    assert.equal(await unwrapBackupKey({ ...wrap, r: 9 }, 'correct horse battery'), null);
    assert.equal(await unwrapBackupKey({ ...wrap, p: 2 }, 'correct horse battery'), null);
  });

  it('rejects malformed key-wrap fields before deriving a key', async () => {
    const wrap = await wrapBackupKey(ENCRYPTION_KEY, 'correct horse battery');
    assert.equal(
      await unwrapBackupKey({ ...wrap, salt: 'not-base64' }, 'correct horse battery'),
      null
    );
    assert.equal(await unwrapBackupKey({ ...wrap, iv: '' }, 'correct horse battery'), null);
    assert.equal(
      await unwrapBackupKey({ ...wrap, wrapped: 'YQ==' }, 'correct horse battery'),
      null
    );
  });

  it('preserves the exact synchronous v1 derivation contract', async () => {
    const recoveryPhrase = 'cafe\u0301 recovery phrase';
    const wrap = await wrapBackupKey(ENCRYPTION_KEY, recoveryPhrase);
    const salt = Buffer.from(wrap.salt, 'base64');
    const syncKey = scryptSync(recoveryPhrase.normalize('NFKC'), salt, 32, {
      N: wrap.n,
      r: wrap.r,
      p: wrap.p,
      maxmem: 128 * wrap.n * wrap.r * 2,
    });
    try {
      const decipher = createDecipheriv('aes-256-gcm', syncKey, Buffer.from(wrap.iv, 'base64'));
      decipher.setAuthTag(Buffer.from(wrap.tag, 'base64'));
      const plain = Buffer.concat([
        decipher.update(Buffer.from(wrap.wrapped, 'base64')),
        decipher.final(),
      ]).toString('utf8');
      assert.equal(plain, ENCRYPTION_KEY);
    } finally {
      syncKey.fill(0);
    }
  });

  it('yields the event loop while scrypt runs', async () => {
    let timerObserved = false;
    const pendingWrap = wrapBackupKey(ENCRYPTION_KEY, 'correct horse battery');
    await new Promise<void>(resolve => {
      setTimeout(() => {
        timerObserved = true;
        resolve();
      }, 0);
    });
    assert.equal(timerObserved, true);
    await pendingWrap;
  });

  it('bounds concurrent attempts and resolves each result independently', async () => {
    const wrap = await wrapBackupKey(ENCRYPTION_KEY, 'correct horse battery');
    const results = await Promise.all([
      unwrapBackupKey(wrap, 'correct horse battery'),
      unwrapBackupKey(wrap, 'wrong horse battery!'),
      unwrapBackupKey(wrap, 'correct horse battery'),
    ]);
    assert.deepEqual(results, [ENCRYPTION_KEY, null, ENCRYPTION_KEY]);
  });

  it('cancels an in-flight derivation without publishing a result', async () => {
    const wrap = await wrapBackupKey(ENCRYPTION_KEY, 'correct horse battery');
    const controller = new AbortController();
    const pending = unwrapBackupKey(wrap, 'correct horse battery', {
      signal: controller.signal,
    });
    setImmediate(() => controller.abort());
    await assert.rejects(pending, { name: 'AbortError', message: 'BACKUP_KDF_ABORTED' });
  });

  it('does not publish a bundle when cancellation reaches the passphrase path', async () => {
    const { dbPath, zipPath } = freshPaths();
    seedEncryptedDb(dbPath);
    const controller = new AbortController();
    const pending = createBackupBundle({
      dbPath,
      outZipPath: zipPath,
      encryptionKey: ENCRYPTION_KEY,
      passphrase: 'correct horse battery',
      signal: controller.signal,
    });
    setTimeout(() => controller.abort(), 10);

    await assert.rejects(pending, error => {
      assert.equal((error as Error).name, 'AbortError');
      return true;
    });
    assert.equal(existsSync(zipPath), false);
  });

  it('a passphrase-protected bundle carries the wrap through extraction', async () => {
    const { dbPath, zipPath, outDir } = freshPaths();
    seedEncryptedDb(dbPath);
    await createBackupBundle({
      dbPath,
      outZipPath: zipPath,
      encryptionKey: ENCRYPTION_KEY,
      passphrase: 'una frase de recuperacion',
    });
    const extracted = await extractBackupBundle(zipPath, outDir);
    assert.ok(extracted.keyWrap, 'extraction surfaces the key-wrap entry');
    assert.equal(
      await unwrapBackupKey(extracted.keyWrap!, 'una frase de recuperacion'),
      ENCRYPTION_KEY
    );
    // The wrap does not weaken the manifest MAC (and its digest binds
    // the wrap bytes into the signed payload).
    const verdict = await verifyExtractedBundleAuthenticity({
      manifest: extracted.manifest,
      dbPath: extracted.dbPath,
      keyWrapRaw: extracted.keyWrapRaw,
      encryptionKey: ENCRYPTION_KEY,
    });
    assert.deepEqual(verdict, { status: 'verified' });
  });
});
