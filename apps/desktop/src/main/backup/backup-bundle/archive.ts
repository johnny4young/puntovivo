import { randomUUID } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, open, rename, rm, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { finished } from 'node:stream/promises';
import { ZipArchive } from 'archiver';
import {
  ZIP_DB_ENTRY,
  ZIP_DEVICE_ID_ENTRY,
  ZIP_KEY_WRAP_ENTRY,
  ZIP_MANIFEST_ENTRY,
} from './constants.ts';

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
  await mkdir(dirname(outZipPath), { recursive: true });

  // Do not prepend the user-selected basename: a valid near-NAME_MAX target
  // would otherwise make the temporary component exceed the filesystem limit.
  const temporaryPath = join(dirname(outZipPath), `.puntovivo-backup-${randomUUID()}.tmp`);
  const archive = new ZipArchive({ store: true });
  const output = createWriteStream(temporaryPath, { flags: 'wx', mode: 0o600 });
  const onAbort = (): void => {
    const error = abortError(signal!);
    archive.abort();
    output.destroy(error);
  };
  signal?.addEventListener('abort', onAbort, { once: true });

  try {
    const archiveFailure = new Promise<never>((_resolve, reject) => {
      archive.once('error', reject);
      archive.on('warning', reject);
    });
    // Attach the output error listener before archiver can write. Waiting to
    // call finished() after finalize would let an early ENOSPC/EACCES become an
    // unhandled stream error and could terminate the Electron main process.
    const outputCompletion = finished(output);
    archive.pipe(output);
    archive.file(args.dbPath, { name: ZIP_DB_ENTRY });
    if (args.deviceId !== undefined) {
      archive.append(args.deviceId, { name: ZIP_DEVICE_ID_ENTRY });
    }
    archive.append(args.manifestJson, { name: ZIP_MANIFEST_ENTRY });
    if (args.keyWrapJson !== undefined) {
      archive.append(args.keyWrapJson, { name: ZIP_KEY_WRAP_ENTRY });
    }

    await Promise.race([archive.finalize(), archiveFailure, outputCompletion]);
    await Promise.race([outputCompletion, archiveFailure]);
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
    if (!output.closed) output.destroy();
    await rm(temporaryPath, { force: true });
  }
}
