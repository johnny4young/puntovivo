import { stat, statfs } from 'node:fs/promises';
import { dirname } from 'node:path';

/** Staging holds a full copy of the database and the zip holds another. */
export async function assertBackupDiskSpace(args: {
  dbPath: string;
  stagingRoot: string;
  outZipPath: string;
  stat?: (path: string) => Promise<{ size: number; dev: number }>;
  statfs?: (path: string) => Promise<{ bavail: number; bsize: number }>;
}): Promise<void> {
  const statPath = args.stat ?? stat;
  const outDir = dirname(args.outZipPath);
  const [db, wal, staging, destination] = await Promise.all([
    statPath(args.dbPath),
    statPath(`${args.dbPath}-wal`).catch(() => null),
    statPath(args.stagingRoot).catch(() => null),
    statPath(outDir).catch(() => null),
  ]);
  const copyBytes = db.size + (wal?.size ?? 0);
  // Both copies land on one volume unless staging and destination differ.
  const needed =
    staging && destination && staging.dev !== destination.dev ? copyBytes : copyBytes * 2;
  for (const directory of [args.stagingRoot, outDir]) {
    const fs = await (args.statfs ?? statfs)(directory).catch(() => null);
    // An unknown volume is not a reason to refuse a backup.
    if (!fs) continue;
    if (fs.bavail * fs.bsize < needed) {
      throw Object.assign(new Error('BACKUP_DISK_SPACE_LOW'), { code: 'BACKUP_DISK_SPACE_LOW' });
    }
  }
}
