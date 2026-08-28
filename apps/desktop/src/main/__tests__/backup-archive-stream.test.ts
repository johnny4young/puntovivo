import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { mkdtemp, open, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeBackupArchive } from '../backup/backup-bundle/archive.ts';

describe('streaming backup publication', () => {
  it('does not exceed NAME_MAX when the destination basename is long but valid', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'puntovivo-backup-archive-name-test-'));
    try {
      const dbPath = join(dir, 'small.db');
      const outZipPath = join(dir, `${'b'.repeat(220)}.zip`);
      await writeFile(dbPath, 'fixture');
      const result = await writeBackupArchive({
        outZipPath,
        dbPath,
        manifestJson: '{}',
      });
      assert.ok(result.zipBytes > 0);
      assert.ok((await readdir(dir)).includes(`${'b'.repeat(220)}.zip`));
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('preserves an existing destination and removes its temporary file when aborted', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'puntovivo-backup-archive-test-'));
    try {
      const dbPath = join(dir, 'large.db');
      const outZipPath = join(dir, 'backup.zip');
      const handle = await open(dbPath, 'w');
      try {
        await handle.truncate(64 * 1024 * 1024);
      } finally {
        await handle.close();
      }
      await writeFile(outZipPath, 'existing trusted backup');
      const controller = new AbortController();
      const pending = writeBackupArchive({
        outZipPath,
        dbPath,
        manifestJson: '{}',
        signal: controller.signal,
      });
      setImmediate(() => controller.abort(new DOMException('cancelled', 'AbortError')));

      await assert.rejects(pending, error => (error as Error).name === 'AbortError');
      assert.equal(await readFile(outZipPath, 'utf8'), 'existing trusted backup');
      assert.deepEqual(
        (await readdir(dir)).filter(name => name.endsWith('.tmp')),
        []
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
