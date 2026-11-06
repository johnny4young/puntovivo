import { strict as assert } from 'node:assert';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import {
  AUTO_UPDATE_FLOOR_FILE,
  loadOrAdvanceUpdateFloor,
} from '../auto-updater/update-floor-store.ts';
import { createSafeStorageStub, sealForTest } from './helpers/safe-storage.ts';

const safeStorage = createSafeStorageStub;

describe('safeStorage update floor', () => {
  it('establishes, advances, and refuses to lower the sealed floor', async () => {
    const root = mkdtempSync(join(tmpdir(), 'puntovivo-update-floor-'));
    const storage = safeStorage();
    try {
      assert.deepEqual(
        await loadOrAdvanceUpdateFloor({
          dataDir: root,
          currentVersion: '1.11.0',
          safeStorage: storage,
          now: () => new Date('2026-08-28T10:00:00.000Z'),
        }),
        {
          schemaVersion: 1,
          floorVersion: '1.11.0',
          sealedAt: '2026-08-28T10:00:00.000Z',
          established: true,
          advanced: false,
        }
      );
      assert.equal(
        (
          await loadOrAdvanceUpdateFloor({
            dataDir: root,
            currentVersion: '1.12.0',
            safeStorage: storage,
            now: () => new Date('2026-08-28T11:00:00.000Z'),
          })
        ).floorVersion,
        '1.12.0'
      );
      const manualRollback = await loadOrAdvanceUpdateFloor({
        dataDir: root,
        currentVersion: '1.10.0',
        safeStorage: storage,
      });
      assert.equal(manualRollback.floorVersion, '1.12.0');
      assert.equal(manualRollback.advanced, false);
      assert.equal(manualRollback.established, false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('fails closed for corrupt, undecryptable, or insecure state', async () => {
    const root = mkdtempSync(join(tmpdir(), 'puntovivo-update-floor-corrupt-'));
    const broken = sealForTest('{broken');
    try {
      writeFileSync(join(root, AUTO_UPDATE_FLOOR_FILE), broken);
      await assert.rejects(
        () =>
          loadOrAdvanceUpdateFloor({
            dataDir: root,
            currentVersion: '1.11.0',
            safeStorage: safeStorage(),
          }),
        /AUTO_UPDATE_FLOOR_DECRYPT_FAILED/
      );
      await assert.rejects(
        () =>
          loadOrAdvanceUpdateFloor({
            dataDir: root,
            currentVersion: '1.11.0',
            platform: 'linux',
            safeStorage: safeStorage({ getSelectedStorageBackend: () => 'basic_text' }, 'linux'),
          }),
        /basic_text/
      );
      assert.deepEqual(readFileSync(join(root, AUTO_UPDATE_FLOOR_FILE)), broken);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
