import { randomUUID } from 'node:crypto';
import { createReadStream, createWriteStream, type ReadStream } from 'node:fs';
import { mkdir, open, rename, rm, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { finished } from 'node:stream/promises';
import {
  ZIP_DB_ENTRY,
  ZIP_DEVICE_ID_ENTRY,
  ZIP_KEY_WRAP_ENTRY,
  ZIP_MANIFEST_ENTRY,
} from './constants.ts';

/** Bound transient file-buffer allocation during large encrypted STORE archives. */
export const BACKUP_ARCHIVE_READ_BUFFER_BYTES = 16 * 1024;

/** Internal ZIP inputs; the database remains file-backed throughout publication. */
interface WriteBackupArchiveArgs {
  outZipPath: string;
  dbPath: string;
  deviceId?: Buffer | undefined;
  manifestJson: string;
  keyWrapJson?: string | undefined;
  signal?: AbortSignal | undefined;
}

function abortError(signal: AbortSignal): Error {
  return signal.reason instanceof Error
    ? signal.reason
    : new DOMException('The backup operation was aborted.', 'AbortError');
}

/**
 * Stream a v2-compatible ZIP to a same-directory temporary file, flush it,
 * and publish with one rename. The database never enters the JS heap.
 *
 * JSZip historically stored backup entries without compression. Preserve
 * that representation: SQLCipher pages are effectively incompressible, and
 * deflating them only spends CPU and expands the time secrets remain live.
 */
export async function writeBackupArchive(
  args: WriteBackupArchiveArgs
): Promise<{ zipBytes: number }> {
  const { outZipPath, signal } = args;
  signal?.throwIfAborted();
  // Backup engines are optional until an operation starts; do not retain
  // their dependency graphs during an ordinary POS session.
  const { ZipArchive } = await import('archiver');
  signal?.throwIfAborted();
  await mkdir(dirname(outZipPath), { recursive: true });
  signal?.throwIfAborted();

  // Do not prepend the user-selected basename: a valid near-NAME_MAX target
  // would otherwise make the temporary component exceed the filesystem limit.
  const temporaryPath = join(dirname(outZipPath), `.puntovivo-backup-${randomUUID()}.tmp`);
  const archive = new ZipArchive({ store: true });
  const output = createWriteStream(temporaryPath, { flags: 'wx', mode: 0o600 });
  // archiver.abort() does not drain its sources. Own the reader explicitly so
  // cancellation and destination failures cannot retain an open database file.
  let input: ReadStream | undefined;
  let inputCompletion: Promise<void> | undefined;
  const outputCompletion = finished(output, { cleanup: true });
  const onAbort = (): void => {
    const error = abortError(signal!);
    archive.abort();
    input?.destroy(error);
    output.destroy(error);
  };
  signal?.addEventListener('abort', onAbort, { once: true });

  try {
    // Construction can throw synchronously (for example, an invalid path).
    // Keep it inside the same cleanup boundary as asynchronous I/O failures.
    // Large fs chunks retain substantially more allocator RSS across a GiB even
    // after their JS buffers die. A measured 16 KiB input bounds that high-water
    // without changing ZIP bytes or retaining a whole payload in memory.
    input = createReadStream(args.dbPath, { highWaterMark: BACKUP_ARCHIVE_READ_BUFFER_BYTES });
    inputCompletion = finished(input, { cleanup: true });
    const archiveFailure = new Promise<never>((_resolve, reject) => {
      archive.once('error', reject);
      archive.on('warning', reject);
    });
    // Attach the output error listener before archiver can write. Waiting to
    // call finished() after finalize would let an early ENOSPC/EACCES become an
    // unhandled stream error and could terminate the Electron main process.
    archive.pipe(output);
    archive.append(input, { name: ZIP_DB_ENTRY });
    if (args.deviceId !== undefined) {
      archive.append(args.deviceId, { name: ZIP_DEVICE_ID_ENTRY });
    }
    archive.append(args.manifestJson, { name: ZIP_MANIFEST_ENTRY });
    if (args.keyWrapJson !== undefined) {
      archive.append(args.keyWrapJson, { name: ZIP_KEY_WRAP_ENTRY });
    }

    await Promise.race([archive.finalize(), archiveFailure, inputCompletion, outputCompletion]);
    await Promise.race([Promise.all([inputCompletion, outputCompletion]), archiveFailure]);
    signal?.throwIfAborted();

    const handle = await open(temporaryPath, 'r+');
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }
    signal?.throwIfAborted();

    const { size } = await stat(temporaryPath);
    await rename(temporaryPath, outZipPath);
    return { zipBytes: size };
  } finally {
    signal?.removeEventListener('abort', onAbort);
    archive.abort();
    input?.destroy();
    if (!output.closed) output.destroy();
    // Wait for close as well as end/error before removing files (also on Windows).
    await Promise.allSettled([inputCompletion, outputCompletion]);
    await rm(temporaryPath, { force: true });
  }
}
