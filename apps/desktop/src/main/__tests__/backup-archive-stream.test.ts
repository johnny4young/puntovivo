import assert from 'node:assert/strict';
import { describe, it, mock } from 'node:test';
import fs, { type ReadStream, type WriteStream } from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { finished } from 'node:stream/promises';
import { mkdtemp, open, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  BACKUP_ARCHIVE_READ_BUFFER_BYTES,
  writeBackupArchive,
} from '../backup/backup-bundle/archive.ts';

describe('streaming backup publication', () => {
  for (const failure of ['cancellation', 'output error'] as const) {
    it(`closes the database input before an in-flight ${failure} settles`, async () => {
      const dir = await mkdtemp(join(tmpdir(), 'puntovivo-backup-input-close-test-'));
      const inputs: ReadStream[] = [];
      const originalCreateReadStream = fs.createReadStream;
      const originalCreateWriteStream = fs.createWriteStream;
      let output: WriteStream | undefined;
      mock.method(fs, 'createWriteStream', (...args: Parameters<typeof fs.createWriteStream>) => {
        output = originalCreateWriteStream(...args);
        return output;
      });
      const controller = new AbortController();
      mock.method(fs, 'createReadStream', (...args: Parameters<typeof fs.createReadStream>) => {
        const stream = originalCreateReadStream(...args);
        inputs.push(stream);
        // Abort only after a real file read; aborting before open cannot detect a leaked input.
        stream.once('data', () => {
          if (failure === 'cancellation')
            controller.abort(new DOMException('cancelled', 'AbortError'));
          else output!.destroy(new Error('simulated destination failure'));
        });
        return stream;
      });
      syncBuiltinESMExports();
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
        await assert.rejects(
          writeBackupArchive({ dbPath, outZipPath, manifestJson: '{}', signal: controller.signal }),
          failure === 'cancellation'
            ? { name: 'AbortError' }
            : { message: 'simulated destination failure' }
        );
        assert.equal(inputs.length, 1);
        assert.equal(inputs[0]!.readableHighWaterMark, BACKUP_ARCHIVE_READ_BUFFER_BYTES);
        assert.equal(BACKUP_ARCHIVE_READ_BUFFER_BYTES, 16 * 1024);
        assert.equal(inputs[0]!.closed, true, 'archive failure must close the database input');
        assert.equal(output!.closed, true, 'archive failure must close the destination');
        assert.equal(await readFile(outZipPath, 'utf8'), 'existing trusted backup');
        assert.deepEqual(
          (await readdir(dir)).filter(name => name.endsWith('.tmp')),
          []
        );
      } finally {
        mock.restoreAll();
        syncBuiltinESMExports();
        for (const stream of inputs) {
          const completion = finished(stream).catch(() => {});
          stream.destroy();
          await completion;
        }
        await rm(dir, { recursive: true, force: true });
      }
    });
  }

  for (const source of ['missing', 'invalid'] as const) {
    it(`preserves the destination when the source path is ${source}`, async () => {
      const dir = await mkdtemp(join(tmpdir(), 'puntovivo-backup-missing-input-test-'));
      try {
        const outZipPath = join(dir, 'backup.zip');
        await writeFile(outZipPath, 'existing trusted backup');
        await assert.rejects(
          writeBackupArchive({
            dbPath: source === 'missing' ? join(dir, 'missing.db') : 'invalid\0path',
            outZipPath,
            manifestJson: '{}',
          }),
          { code: source === 'missing' ? 'ENOENT' : 'ERR_INVALID_ARG_VALUE' }
        );
        assert.equal(await readFile(outZipPath, 'utf8'), 'existing trusted backup');
        assert.deepEqual(
          (await readdir(dir)).filter(name => name.endsWith('.tmp')),
          []
        );
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    });
  }

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
