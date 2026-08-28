import { strict as assert } from 'node:assert';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import {
  AUDIT_ANCHOR_STATE_FILE,
  createSafeStorageAuditAnchorStore,
} from '../audit-anchor-store.ts';
import type { SafeStorageLike } from '../db-key-store.ts';

const mask = 0x4d;

function safeStorage(overrides: Partial<SafeStorageLike> = {}): SafeStorageLike {
  return {
    isEncryptionAvailable: () => true,
    encryptString: plain => Buffer.from(Buffer.from(plain).map(byte => byte ^ mask)),
    decryptString: sealed => Buffer.from(sealed.map(byte => byte ^ mask)).toString('utf8'),
    ...overrides,
  };
}

describe('safeStorage audit anchor store', () => {
  let directory: string;

  before(async () => {
    directory = await mkdtemp(join(tmpdir(), 'puntovivo-audit-anchor-'));
  });

  after(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  it('persists confirmed and pending state without cleartext tenant data', () => {
    const store = createSafeStorageAuditAnchorStore({
      dataDir: directory,
      safeStorage: safeStorage(),
    });
    store.write('tenant-a', {
      version: 1,
      confirmed: { counter: 8, headHash: 'confirmed-head' },
      pending: { counter: 9, headHash: 'pending-head' },
    });

    const statePath = join(directory, AUDIT_ANCHOR_STATE_FILE);
    assert.equal(existsSync(statePath), true);
    assert.equal(readFileSync(statePath).includes(Buffer.from('tenant-a')), false);

    const reopened = createSafeStorageAuditAnchorStore({
      dataDir: directory,
      safeStorage: safeStorage(),
    });
    assert.deepEqual(reopened.read('tenant-a'), {
      version: 1,
      confirmed: { counter: 8, headHash: 'confirmed-head' },
      pending: { counter: 9, headHash: 'pending-head' },
    });

    reopened.replaceAll([{ tenantId: 'tenant-b', counter: 3, headHash: 'restored-head' }]);
    assert.equal(reopened.read('tenant-a'), null);
    assert.deepEqual(reopened.read('tenant-b'), {
      version: 1,
      confirmed: { counter: 3, headHash: 'restored-head' },
      pending: null,
    });
  });

  it('fails closed on a corrupt envelope and an insecure Linux backend', () => {
    const statePath = join(directory, AUDIT_ANCHOR_STATE_FILE);
    writeFileSync(statePath, Buffer.from('not-a-sealed-json-envelope'));
    const corrupt = createSafeStorageAuditAnchorStore({
      dataDir: directory,
      safeStorage: safeStorage(),
    });
    assert.throws(() => corrupt.read('tenant-a'), /AUDIT_ANCHOR_STATE_DECRYPT_FAILED/);

    assert.throws(
      () =>
        createSafeStorageAuditAnchorStore({
          dataDir: directory,
          platform: 'linux',
          safeStorage: safeStorage({ getSelectedStorageBackend: () => 'basic_text' }),
        }),
      /basic_text/
    );
  });
});
