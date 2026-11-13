import { stat, statfs } from 'node:fs/promises';
import { dirname } from 'node:path';

/** Staging holds a full copy of the database and the zip holds another. */
export async function assertBackupDiskSpace(args: {
  dbPath: string;
  stagingRoot: string;
  outZipPath: string;
  statfs?: (path: string) => Promise<{ bavail: number; bsize: number }>;
}): Promise<void> {
  const [db, wal] = await Promise.all([
    stat(args.dbPath),
    stat(`${args.dbPath}-wal`).catch(() => null),
  ]);
  const needed = db.size + (wal?.size ?? 0);
  for (const directory of [args.stagingRoot, dirname(args.outZipPath)]) {
    const fs = await (args.statfs ?? statfs)(directory).catch(() => null);
    // An unknown volume is not a reason to refuse a backup.
    if (!fs) continue;
    if (fs.bavail * fs.bsize < needed * 2) {
      throw Object.assign(new Error('BACKUP_DISK_SPACE_LOW'), { code: 'BACKUP_DISK_SPACE_LOW' });
    }
  }
}
