import { strict as assert } from 'node:assert';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import type { SafeStorageLike } from '../db-key-store.ts';
import {
  AUTO_UPDATE_FLOOR_FILE,
  loadOrAdvanceUpdateFloor,
} from '../auto-updater/update-floor-store.ts';

function safeStorage(overrides: Partial<SafeStorageLike> = {}): SafeStorageLike {
  return {
    isEncryptionAvailable: () => true,
    encryptString: value => Buffer.from(`sealed:${value}`),
    decryptString: value => value.toString().replace(/^sealed:/, ''),
    getSelectedStorageBackend: () => 'unknown',
    ...overrides,
  };
}

describe('safeStorage update floor', () => {
  it('establishes, advances, and refuses to lower the sealed floor', () => {
    const root = mkdtempSync(join(tmpdir(), 'puntovivo-update-floor-'));
    const storage = safeStorage();
    try {
      assert.deepEqual(
        loadOrAdvanceUpdateFloor({
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
        loadOrAdvanceUpdateFloor({
          dataDir: root,
          currentVersion: '1.12.0',
          safeStorage: storage,
          now: () => new Date('2026-08-28T11:00:00.000Z'),
        }).floorVersion,
        '1.12.0'
      );
      const manualRollback = loadOrAdvanceUpdateFloor({
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

  it('fails closed for corrupt, undecryptable, or insecure state', () => {
    const root = mkdtempSync(join(tmpdir(), 'puntovivo-update-floor-corrupt-'));
    try {
      writeFileSync(join(root, AUTO_UPDATE_FLOOR_FILE), Buffer.from('sealed:{broken'));
      assert.throws(
        () =>
          loadOrAdvanceUpdateFloor({
            dataDir: root,
            currentVersion: '1.11.0',
            safeStorage: safeStorage(),
          }),
        /AUTO_UPDATE_FLOOR_DECRYPT_FAILED/
      );
      assert.throws(
        () =>
          loadOrAdvanceUpdateFloor({
            dataDir: root,
            currentVersion: '1.11.0',
            platform: 'linux',
            safeStorage: safeStorage({ getSelectedStorageBackend: () => 'basic_text' }),
          }),
        /basic_text/
      );
      assert.equal(readFileSync(join(root, AUTO_UPDATE_FLOOR_FILE), 'utf8'), 'sealed:{broken');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
