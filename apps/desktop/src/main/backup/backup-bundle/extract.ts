// Restore-boundary ZIP reader. The archive directory and every local header
// are validated before a byte is published to the restore staging area.

import { createReadStream, createWriteStream } from 'node:fs';
import { lstat, mkdir, mkdtemp, open, readFile, rename, rm, stat } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { Readable, Transform, type TransformCallback } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { crc32, createInflateRaw } from 'node:zlib';
import { Open, type CentralDirectory, type File as ZipEntry } from 'unzipper';
import {
  ALLOWED_ZIP_ENTRIES,
  ZIP_DB_ENTRY,
  ZIP_DEVICE_ID_ENTRY,
  ZIP_KEY_WRAP_ENTRY,
  ZIP_MANIFEST_ENTRY,
} from './constants.ts';
import { detectBackupFormat } from './detect.ts';
import { copyBackupFileRange } from './copy-range.ts';
import type { BackupKeyWrap } from './key-wrap.ts';
import type { BackupManifest, ExtractBackupBundleResult } from './types.ts';

const LOCAL_FILE_HEADER_SIGNATURE = 0x04034b50;
const DATA_DESCRIPTOR_SIGNATURE = 0x08074b50;
const UINT32_MAX = 0xffffffff;
const UNIX_FILE_TYPE_MASK = 0o170000;
const UNIX_REGULAR_FILE_TYPE = 0o100000;
const MAX_ENTRY_COUNT = ALLOWED_ZIP_ENTRIES.size;

/**
 * Explicit uncompressed limits close metadata allocation and ZIP-bomb paths.
 * The 64 GiB DB ceiling is intentionally far above the profiled 1 GiB release
 * fixture while keeping arithmetic inside Number's exact integer range.
 */
const ENTRY_LIMITS: Readonly<Record<string, number>> = {
  [ZIP_DB_ENTRY]: 64 * 1024 * 1024 * 1024,
  [ZIP_DEVICE_ID_ENTRY]: 4 * 1024,
  [ZIP_MANIFEST_ENTRY]: 64 * 1024,
  [ZIP_KEY_WRAP_ENTRY]: 16 * 1024,
};

interface ValidatedZipEntry {
  entry: ZipEntry;
  dataStart: number;
}

function rejectArchive(message: string, cause?: unknown): never {
  throw new Error(`Backup ZIP rejected: ${message}`, cause === undefined ? undefined : { cause });
}

function assertSafeArchiveInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    rejectArchive(`${label} is outside the supported ZIP integer range.`);
  }
}

function assertSafeEntryName(entry: ZipEntry): string {
  const name = entry.path;
  if (
    name.includes('\0') ||
    name.includes('..') ||
    name.startsWith('/') ||
    name.includes('\\') ||
    isAbsolute(name)
  ) {
    rejectArchive(
      `entry '${name}' uses a path-traversal, NUL, backslash, or absolute path. The file is not a trusted Puntovivo backup.`
    );
  }
  if (!entry.pathBuffer.equals(Buffer.from(name, 'utf8'))) {
    rejectArchive(`entry '${name}' does not use its canonical UTF-8 name.`);
  }
  if (!ALLOWED_ZIP_ENTRIES.has(name)) {
    rejectArchive(
      `unexpected entry '${name}'. A Puntovivo backup may only contain ${[
        ...ALLOWED_ZIP_ENTRIES,
      ].join(', ')}.`
    );
  }
  return name;
}

function isNonRegularUnixEntry(entry: ZipEntry): boolean {
  const unixMode = (entry.externalFileAttributes >>> 16) & 0xffff;
  const fileType = unixMode & UNIX_FILE_TYPE_MASK;
  return fileType !== 0 && fileType !== UNIX_REGULAR_FILE_TYPE;
}

function parseBackupManifest(raw: string): BackupManifest {
  let candidate: unknown;
  try {
    candidate = JSON.parse(raw);
  } catch {
    rejectArchive(`entry '${ZIP_MANIFEST_ENTRY}' is not valid JSON.`);
  }
  if (
    candidate === null ||
    typeof candidate !== 'object' ||
    Array.isArray(candidate) ||
    !Number.isSafeInteger((candidate as Partial<BackupManifest>).schemaVersion) ||
    ((candidate as Partial<BackupManifest>).schemaVersion ?? 0) < 1 ||
    typeof (candidate as Partial<BackupManifest>).generatedAt !== 'string' ||
    !Number.isSafeInteger((candidate as Partial<BackupManifest>).dbBytes) ||
    ((candidate as Partial<BackupManifest>).dbBytes ?? -1) < 0
  ) {
    rejectArchive(`entry '${ZIP_MANIFEST_ENTRY}' does not match a supported manifest shape.`);
  }
  return candidate as BackupManifest;
}

function validateCentralDirectory(directory: CentralDirectory): Map<string, ZipEntry> {
  for (const [label, value] of [
    ['record count', directory.numberOfRecords],
    ['same-disk record count', directory.numberOfRecordsOnDisk],
    ['central-directory offset', directory.offsetToStartOfCentralDirectory],
    ['central-directory size', directory.sizeOfCentralDirectory],
  ] as const) {
    assertSafeArchiveInteger(value, label);
  }
  if (
    directory.diskNumber !== 0 ||
    directory.diskStart !== 0 ||
    directory.numberOfRecordsOnDisk !== directory.numberOfRecords
  ) {
    rejectArchive('multi-disk ZIP files are not supported.');
  }
  if (
    directory.numberOfRecords > MAX_ENTRY_COUNT ||
    directory.files.length !== directory.numberOfRecords
  ) {
    rejectArchive(`the archive may contain at most ${MAX_ENTRY_COUNT} file records.`);
  }

  const entries = new Map<string, ZipEntry>();
  for (const entry of directory.files) {
    const name = assertSafeEntryName(entry);
    if (entries.has(name)) {
      rejectArchive(`duplicate entry '${name}' is ambiguous and is not allowed.`);
    }
    if (entry.type !== 'File' || isNonRegularUnixEntry(entry)) {
      rejectArchive(`entry '${name}' must be a regular file, never a directory or symlink.`);
    }
    if ((entry.flags & 0x1) !== 0) {
      rejectArchive(`entry '${name}' uses unsupported ZIP-level encryption.`);
    }
    if (entry.compressionMethod !== 0 && entry.compressionMethod !== 8) {
      rejectArchive(
        `entry '${name}' uses unsupported compression method ${entry.compressionMethod}.`
      );
    }
    for (const [label, value] of [
      ['compressed size', entry.compressedSize],
      ['uncompressed size', entry.uncompressedSize],
      ['local-header offset', entry.offsetToLocalFileHeader],
    ] as const) {
      assertSafeArchiveInteger(value, `${name} ${label}`);
    }
    if (entry.diskNumber !== 0) {
      rejectArchive(`entry '${name}' points to a different ZIP disk.`);
    }
    const limit = ENTRY_LIMITS[name]!;
    if (entry.uncompressedSize > limit) {
      rejectArchive(
        `entry '${name}' declares ${entry.uncompressedSize} bytes, above its ${limit}-byte limit.`
      );
    }
    entries.set(name, entry);
  }

  if (!entries.has(ZIP_DB_ENTRY)) {
    rejectArchive(
      `the archive is missing the required '${ZIP_DB_ENTRY}' entry. The file is not a Puntovivo backup.`
    );
  }
  return entries;
}

async function readExactly(
  handle: Awaited<ReturnType<typeof open>>,
  length: number,
  position: number
): Promise<Buffer> {
  const buffer = Buffer.allocUnsafe(length);
  let totalBytesRead = 0;
  while (totalBytesRead < length) {
    const { bytesRead } = await handle.read(
      buffer,
      totalBytesRead,
      length - totalBytesRead,
      position + totalBytesRead
    );
    if (bytesRead === 0) {
      rejectArchive('a local file header or payload is truncated.');
    }
    totalBytesRead += bytesRead;
  }
  return buffer;
}

/**
 * unzipper trusts central-directory metadata when streaming an entry. Compare
 * it with each local header first so duplicate identities, local-name swaps,
 * truncated ranges, and overlapping payloads cannot hide behind that trust.
 */
async function validateLocalHeaders(
  bundlePath: string,
  directory: CentralDirectory,
  entries: ReadonlyMap<string, ZipEntry>
): Promise<Map<string, ValidatedZipEntry>> {
  const archiveSize = (await stat(bundlePath)).size;
  assertSafeArchiveInteger(archiveSize, 'archive size');
  const centralStart = directory.offsetToStartOfCentralDirectory;
  const centralEnd = centralStart + directory.sizeOfCentralDirectory;
  if (!Number.isSafeInteger(centralEnd) || centralEnd > archiveSize) {
    rejectArchive('the central directory is truncated.');
  }

  const ranges: Array<{ name: string; start: number; end: number }> = [];
  const validatedEntries = new Map<string, ValidatedZipEntry>();
  const handle = await open(bundlePath, 'r');
  try {
    for (const [name, entry] of entries) {
      const header = await readExactly(handle, 30, entry.offsetToLocalFileHeader);
      if (header.readUInt32LE(0) !== LOCAL_FILE_HEADER_SIGNATURE) {
        rejectArchive(`entry '${name}' has an invalid local-file-header signature.`);
      }

      const localFlags = header.readUInt16LE(6);
      const localCompression = header.readUInt16LE(8);
      const localCrc = header.readUInt32LE(14);
      const localCompressedSize = header.readUInt32LE(18);
      const localUncompressedSize = header.readUInt32LE(22);
      const localNameLength = header.readUInt16LE(26);
      const localExtraLength = header.readUInt16LE(28);
      if (localFlags !== entry.flags || localCompression !== entry.compressionMethod) {
        rejectArchive(`entry '${name}' disagrees with its central-directory method or flags.`);
      }

      const localName = await readExactly(
        handle,
        localNameLength,
        entry.offsetToLocalFileHeader + 30
      );
      if (!localName.equals(entry.pathBuffer)) {
        rejectArchive(`entry '${name}' has a different identity in its local file header.`);
      }

      // Bit 3 means sizes and CRC follow the payload in a data descriptor.
      // Otherwise local and central declarations must match exactly.
      if ((localFlags & 0x8) === 0) {
        if (
          localCrc !== entry.crc32 >>> 0 ||
          localCompressedSize !== entry.compressedSize ||
          localUncompressedSize !== entry.uncompressedSize
        ) {
          rejectArchive(`entry '${name}' disagrees with its central-directory size or CRC.`);
        }
      }

      const dataStart = entry.offsetToLocalFileHeader + 30 + localNameLength + localExtraLength;
      const dataEnd = dataStart + entry.compressedSize;
      if (!Number.isSafeInteger(dataEnd) || dataEnd > centralStart || dataEnd > archiveSize) {
        rejectArchive(`entry '${name}' is truncated or overlaps the central directory.`);
      }
      let recordEnd = dataEnd;
      if ((localFlags & 0x8) !== 0) {
        const prefix = await readExactly(handle, 4, dataEnd);
        const hasSignature = prefix.readUInt32LE(0) === DATA_DESCRIPTOR_SIGNATURE;
        const usesZip64 =
          entry.compressedSize >= UINT32_MAX || entry.uncompressedSize >= UINT32_MAX;
        const bodyLength = usesZip64 ? 20 : 12;
        const body = hasSignature
          ? await readExactly(handle, bodyLength, dataEnd + 4)
          : Buffer.concat([
              prefix,
              await readExactly(handle, bodyLength - prefix.length, dataEnd + prefix.length),
            ]);
        const descriptorCrc = body.readUInt32LE(0);
        const descriptorCompressedSize = usesZip64
          ? Number(body.readBigUInt64LE(4))
          : body.readUInt32LE(4);
        const descriptorUncompressedSize = usesZip64
          ? Number(body.readBigUInt64LE(12))
          : body.readUInt32LE(8);
        assertSafeArchiveInteger(descriptorCompressedSize, `${name} descriptor compressed size`);
        assertSafeArchiveInteger(
          descriptorUncompressedSize,
          `${name} descriptor uncompressed size`
        );
        if (
          descriptorCrc !== entry.crc32 >>> 0 ||
          descriptorCompressedSize !== entry.compressedSize ||
          descriptorUncompressedSize !== entry.uncompressedSize
        ) {
          rejectArchive(`entry '${name}' has an invalid trailing data descriptor.`);
        }
        recordEnd = dataEnd + bodyLength + (hasSignature ? 4 : 0);
        if (recordEnd > centralStart || recordEnd > archiveSize) {
          rejectArchive(`entry '${name}' has a truncated trailing data descriptor.`);
        }
      }
      ranges.push({ name, start: entry.offsetToLocalFileHeader, end: recordEnd });
      validatedEntries.set(name, { entry, dataStart });
    }
  } finally {
    await handle.close();
  }

  ranges.sort((left, right) => left.start - right.start);
  for (let index = 1; index < ranges.length; index += 1) {
    const previous = ranges[index - 1]!;
    const current = ranges[index]!;
    if (current.start < previous.end) {
      rejectArchive(`entries '${previous.name}' and '${current.name}' overlap.`);
    }
  }
  return validatedEntries;
}

/** Shared CRC/size admission for both legacy inflation and bounded stored-payload copying. */
class EntryIntegrityTransform extends Transform {
  #bytes = 0;
  #crc = 0;
  readonly #entryName: string;
  readonly #expectedBytes: number;
  readonly #expectedCrc: number;
  readonly #maxBytes: number;

  constructor(entryName: string, expectedBytes: number, expectedCrc: number, maxBytes: number) {
    super();
    this.#entryName = entryName;
    this.#expectedBytes = expectedBytes;
    this.#expectedCrc = expectedCrc;
    this.#maxBytes = maxBytes;
  }

  acceptChunk(chunk: Buffer): void {
    this.#bytes += chunk.byteLength;
    if (this.#bytes > this.#expectedBytes || this.#bytes > this.#maxBytes) {
      rejectArchive(`entry '${this.#entryName}' exceeded its size limit.`);
    }
    this.#crc = crc32(chunk, this.#crc) >>> 0;
  }

  override _transform(chunk: Buffer, _encoding: BufferEncoding, callback: TransformCallback): void {
    try {
      this.acceptChunk(chunk);
      callback(null, chunk);
    } catch (error) {
      callback(error instanceof Error ? error : new Error(String(error)));
    }
  }

  assertComplete(): void {
    if (this.#bytes !== this.#expectedBytes) {
      rejectArchive(
        `entry '${this.#entryName}' yielded ${this.#bytes} bytes instead of ${this.#expectedBytes}; it is truncated.`
      );
    }
    if (this.#crc !== this.#expectedCrc >>> 0) {
      rejectArchive(`entry '${this.#entryName}' failed its ZIP CRC integrity check.`);
    }
  }
}

async function extractEntryToFile(
  bundlePath: string,
  validated: ValidatedZipEntry,
  outputPath: string
): Promise<void> {
  const { entry, dataStart } = validated;
  const verifier = new EntryIntegrityTransform(
    entry.path,
    entry.uncompressedSize,
    entry.crc32,
    ENTRY_LIMITS[entry.path]!
  );
  try {
    if (entry.compressionMethod === 0) {
      // Stored SQLCipher payloads need no transform buffering. Reuse one buffer
      // only after complete positional writes; short I/O must never lose bytes.
      const source = await open(bundlePath, 'r');
      try {
        const destination = await open(outputPath, 'wx', 0o600);
        try {
          await copyBackupFileRange({
            source,
            destination,
            sourceOffset: dataStart,
            byteLength: entry.compressedSize,
            verifyChunk: chunk => verifier.acceptChunk(chunk),
          });
        } finally {
          await destination.close();
        }
      } finally {
        await source.close();
      }
    } else {
      const source =
        entry.compressedSize === 0
          ? Readable.from([])
          : createReadStream(bundlePath, {
              start: dataStart,
              end: dataStart + entry.compressedSize - 1,
              highWaterMark: 64 * 1024,
            });
      const output = createWriteStream(outputPath, { flags: 'wx', mode: 0o600 });
      await pipeline(source, createInflateRaw(), verifier, output);
    }
    verifier.assertComplete();
    const handle = await open(outputPath, 'r+');
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }
  } catch (error) {
    await rm(outputPath, { force: true });
    if (error instanceof Error && error.message.startsWith('Backup ZIP rejected:')) throw error;
    rejectArchive(`entry '${entry.path}' is truncated or malformed.`, error);
  }
}

async function assertPublicationTargetsAbsent(
  outDir: string,
  names: Iterable<string>
): Promise<void> {
  for (const name of names) {
    try {
      await lstat(join(outDir, name));
      rejectArchive(`restore staging target '${name}' already exists.`);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
}

/**
 * Extract a backup ZIP into a private restore staging directory, or pass a
 * legacy raw SQLite file through. Every ZIP entry streams to a private
 * temporary file and is published only after the full archive validates.
 */
export async function extractBackupBundle(
  bundlePath: string,
  outDir: string
): Promise<ExtractBackupBundleResult> {
  const format = await detectBackupFormat(bundlePath);
  if (format === 'unknown') {
    throw new Error(
      'Backup file format is unrecognized. Expected a Puntovivo ZIP backup or a SQLite database.'
    );
  }
  if (format === 'sqlite') {
    return { dbPath: bundlePath, format: 'sqlite' };
  }

  let directory: CentralDirectory;
  try {
    directory = await Open.file(bundlePath);
  } catch (error) {
    rejectArchive('the central directory is truncated or malformed.', error);
  }
  const entries = validateCentralDirectory(directory);
  const validatedEntries = await validateLocalHeaders(bundlePath, directory, entries);

  await mkdir(outDir, { recursive: true });
  await assertPublicationTargetsAbsent(outDir, entries.keys());
  const extractionDir = await mkdtemp(join(outDir, '.puntovivo-extract-'));
  const published: string[] = [];
  try {
    // Extract sequentially: bounded concurrency is a stronger memory contract
    // than parallel decompression and backup bundles contain at most four files.
    for (const [name, validated] of validatedEntries) {
      await extractEntryToFile(bundlePath, validated, join(extractionDir, name));
    }

    let manifest: BackupManifest | undefined;
    if (entries.has(ZIP_MANIFEST_ENTRY)) {
      const manifestRaw = await readFile(join(extractionDir, ZIP_MANIFEST_ENTRY), 'utf8');
      // A present but malformed manifest is distinguishable from a genuine
      // pre-manifest legacy bundle. Treating it as absent would turn a
      // corrupted current bundle into legacy-unsigned and bypass its MAC.
      manifest = parseBackupManifest(manifestRaw);
    }

    let keyWrap: BackupKeyWrap | undefined;
    let keyWrapRaw: string | undefined;
    if (entries.has(ZIP_KEY_WRAP_ENTRY)) {
      keyWrapRaw = await readFile(join(extractionDir, ZIP_KEY_WRAP_ENTRY), 'utf8');
      try {
        keyWrap = JSON.parse(keyWrapRaw) as BackupKeyWrap;
      } catch {
        // A malformed wrap degrades to the raw-key prompt. Its raw bytes still
        // participate in the signed authenticity verdict when they were read.
      }
    }

    for (const name of entries.keys()) {
      const finalPath = join(outDir, name);
      await rename(join(extractionDir, name), finalPath);
      published.push(finalPath);
    }

    return {
      dbPath: join(outDir, ZIP_DB_ENTRY),
      deviceIdPath: entries.has(ZIP_DEVICE_ID_ENTRY)
        ? join(outDir, ZIP_DEVICE_ID_ENTRY)
        : undefined,
      manifest,
      keyWrap,
      keyWrapRaw,
      format: 'zip',
    };
  } catch (error) {
    for (const path of published) await rm(path, { force: true });
    throw error;
  } finally {
    await rm(extractionDir, { recursive: true, force: true });
  }
}
