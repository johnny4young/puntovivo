import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { assertBackupDiskSpace } from '../backup/backup-bundle/disk-space.ts';
import { createSaleActivityTracker } from '../backup/sale-activity.ts';

describe('sale activity tracker', () => {
  it('records completed sales, including batched tRPC calls, and ignores the rest', () => {
    let clock = 1_000;
    const tracker = createSaleActivityTracker(() => clock);
    const api = 'http://127.0.0.1:8090/api/trpc';

    tracker.observe('GET', `${api}/sales.create`, 200);
    tracker.observe('POST', `${api}/sales.create`, 409);
    tracker.observe('POST', `${api}/products.list,sales.list?batch=1`, 200);
    assert.equal(tracker.lastSaleAt(), null);

    tracker.observe('POST', `${api}/products.list,sales.completeDraft?batch=1`, 200);
    assert.equal(tracker.lastSaleAt(), 1_000);
    clock = 2_000;
    tracker.observe('POST', `${api}/sales.create`, 200);
    assert.equal(tracker.lastSaleAt(), 2_000);
  });
});

describe('backup disk space', () => {
  const volume = (freeBytes: number) => async () => ({ bavail: freeBytes, bsize: 1 });

  it('needs room for two copies of the database plus WAL and skips an unknown volume', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'pv-backup-space-'));
    try {
      const dbPath = join(dir, 'live.db');
      writeFileSync(dbPath, Buffer.alloc(600));
      writeFileSync(`${dbPath}-wal`, Buffer.alloc(400));
      const args = { dbPath, stagingRoot: dir, outZipPath: join(dir, 'out.zip') };

      await assertBackupDiskSpace({ ...args, statfs: volume(2_000) });
      await assert.rejects(assertBackupDiskSpace({ ...args, statfs: volume(1_999) }), {
        code: 'BACKUP_DISK_SPACE_LOW',
      });
      await assertBackupDiskSpace({
        ...args,
        statfs: async () => {
          throw new Error('ENOSYS');
        },
      });

      // On separate volumes each one holds a single copy.
      const outDir = join(dir, 'usb');
      const separate = {
        dbPath,
        stagingRoot: dir,
        outZipPath: join(outDir, 'out.zip'),
        stat: async (path: string) =>
          path === outDir ? { size: 0, dev: -1 } : statSync(path, { throwIfNoEntry: true }),
      };
      await assertBackupDiskSpace({ ...separate, statfs: volume(1_000) });
      await assert.rejects(assertBackupDiskSpace({ ...separate, statfs: volume(999) }), {
        code: 'BACKUP_DISK_SPACE_LOW',
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
