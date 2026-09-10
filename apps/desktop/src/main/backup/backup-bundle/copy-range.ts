/** Fixed working buffer for stored ZIP payloads; independent of the database size. */
export const BACKUP_COPY_BUFFER_BYTES = 256 * 1024;

/** Positional byte reader. The caller owns its file handle and must close it on every outcome. */
export interface BackupRangeReader {
  read(
    buffer: Buffer,
    offset: number,
    length: number,
    position: number
  ): Promise<{ bytesRead: number }>;
}

/** Positional byte writer. A resolved write may be partial but must make positive progress. */
export interface BackupRangeWriter {
  write(
    buffer: Buffer,
    offset: number,
    length: number,
    position: number
  ): Promise<{ bytesWritten: number }>;
}

/**
 * Copy one validated stored ZIP range into a new private file with constant live
 * payload memory. Readers and writers may return short I/O. Never refill the
 * borrowed buffer until every byte of its previous contents has been written.
 * The synchronous verifier must not retain its borrowed chunk beyond the call.
 * File closure, fsync and atomic publication remain the extraction owner's job.
 */
export async function copyBackupFileRange(args: {
  source: BackupRangeReader;
  destination: BackupRangeWriter;
  sourceOffset: number;
  byteLength: number;
  verifyChunk: (chunk: Buffer) => void;
}): Promise<void> {
  const { source, destination, sourceOffset, byteLength, verifyChunk } = args;
  if (
    !Number.isSafeInteger(sourceOffset) ||
    sourceOffset < 0 ||
    !Number.isSafeInteger(byteLength) ||
    byteLength < 0 ||
    !Number.isSafeInteger(sourceOffset + byteLength)
  )
    throw new RangeError('Backup file range must contain safe nonnegative byte offsets.');
  if (byteLength === 0) return;

  const buffer = Buffer.allocUnsafe(Math.min(BACKUP_COPY_BUFFER_BYTES, byteLength));
  let copied = 0;
  while (copied < byteLength) {
    const requested = Math.min(buffer.length, byteLength - copied);
    const { bytesRead } = await source.read(buffer, 0, requested, sourceOffset + copied);
    if (!Number.isSafeInteger(bytesRead) || bytesRead <= 0 || bytesRead > requested) {
      throw new Error('Backup file range is truncated or returned an invalid read length.');
    }
    verifyChunk(buffer.subarray(0, bytesRead));
    let written = 0;
    while (written < bytesRead) {
      const remaining = bytesRead - written;
      const { bytesWritten } = await destination.write(
        buffer,
        written,
        remaining,
        copied + written
      );
      if (!Number.isSafeInteger(bytesWritten) || bytesWritten <= 0 || bytesWritten > remaining) {
        throw new Error('Backup file range write did not make valid progress.');
      }
      written += bytesWritten;
    }
    copied += bytesRead;
  }
}
