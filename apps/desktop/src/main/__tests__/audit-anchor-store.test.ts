import { strict as assert } from 'node:assert';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, beforeEach, describe, it } from 'node:test';
import {
  AUDIT_ANCHOR_STATE_FILE,
  createSafeStorageAuditAnchorStore,
} from '../audit-anchor-store.ts';
import { createSafeStorageStub, sealForTest } from './helpers/safe-storage.ts';

const ANCHOR_SECRET = 'ab'.repeat(32);

describe('safeStorage audit anchor store', () => {
  let directory: string;
  let statePath: string;

  before(async () => {
    directory = await mkdtemp(join(tmpdir(), 'puntovivo-audit-anchor-'));
    statePath = join(directory, AUDIT_ANCHOR_STATE_FILE);
  });

  beforeEach(() => {
    if (existsSync(statePath)) rmSync(statePath);
  });

  after(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  it('persists confirmed and pending state without cleartext tenant data', async () => {
    const store = await createSafeStorageAuditAnchorStore({
      dataDir: directory,
      safeStorage: createSafeStorageStub(),
      anchorSecret: ANCHOR_SECRET,
    });
    store.write('tenant-a', {
      version: 2,
      confirmed: { counter: 8, headHash: 'confirmed-head' },
      pending: [{ counter: 9, headHash: 'pending-head' }],
    });

    assert.equal(existsSync(statePath), true);
    assert.equal(readFileSync(statePath).includes(Buffer.from('tenant-a')), false);

    const reopened = await createSafeStorageAuditAnchorStore({
      dataDir: directory,
      safeStorage: createSafeStorageStub(),
      anchorSecret: ANCHOR_SECRET,
    });
    assert.deepEqual(reopened.read('tenant-a'), {
      version: 2,
      confirmed: { counter: 8, headHash: 'confirmed-head' },
      pending: [{ counter: 9, headHash: 'pending-head' }],
    });

    reopened.replaceAll([{ tenantId: 'tenant-b', counter: 3, headHash: 'restored-head' }]);
    assert.equal(reopened.read('tenant-a'), null);
    assert.deepEqual(reopened.read('tenant-b'), {
      version: 2,
      confirmed: { counter: 3, headHash: 'restored-head' },
      pending: [],
    });
  });

  it('converts a state file sealed by safeStorage once, then reads it in-process', async () => {
    const envelope = {
      version: 2,
      confirmed: { counter: 4, headHash: 'legacy-head' },
      pending: [],
    };
    writeFileSync(
      statePath,
      sealForTest(JSON.stringify({ version: 1, tenants: { 'tenant-a': envelope } }))
    );
    let decrypts = 0;
    const stub = createSafeStorageStub();
    const store = await createSafeStorageAuditAnchorStore({
      dataDir: directory,
      safeStorage: {
        ...stub,
        decryptStringAsync: sealed => {
          decrypts += 1;
          return stub.decryptStringAsync(sealed);
        },
      },
      anchorSecret: ANCHOR_SECRET,
    });

    assert.equal(readFileSync(statePath).subarray(0, 4).toString('latin1'), 'PVA1');
    assert.deepEqual(store.read('tenant-a'), envelope);
    assert.deepEqual(store.read('tenant-a'), envelope);
    assert.equal(decrypts, 1);
  });

  it('keeps an unconvertible state file and fails every read closed', async () => {
    const legacy = sealForTest(JSON.stringify({ version: 1, tenants: {} }));
    writeFileSync(statePath, legacy);
    const store = await createSafeStorageAuditAnchorStore({
      dataDir: directory,
      safeStorage: createSafeStorageStub({
        decryptStringAsync: async () => {
          throw new Error('safeStorage.decryptStringAsync is temporarily unavailable.');
        },
      }),
      anchorSecret: ANCHOR_SECRET,
    });

    assert.throws(
      () => store.read('tenant-a'),
      (error: unknown) =>
        error instanceof Error &&
        error.message === 'AUDIT_ANCHOR_STATE_DECRYPT_FAILED' &&
        /temporarily unavailable/.test(String((error.cause as Error).message))
    );
    assert.deepEqual(readFileSync(statePath), legacy);
  });

  it('binds the state to the anchor secret', async () => {
    const store = await createSafeStorageAuditAnchorStore({
      dataDir: directory,
      safeStorage: createSafeStorageStub(),
      anchorSecret: ANCHOR_SECRET,
    });
    store.replaceAll([{ tenantId: 'tenant-a', counter: 1, headHash: 'head' }]);

    const otherInstall = await createSafeStorageAuditAnchorStore({
      dataDir: directory,
      safeStorage: createSafeStorageStub(),
      anchorSecret: 'cd'.repeat(32),
    });
    assert.throws(() => otherInstall.read('tenant-a'), /AUDIT_ANCHOR_STATE_DECRYPT_FAILED/);
  });

  it('fails closed on a corrupt envelope and an insecure Linux backend', async () => {
    writeFileSync(statePath, Buffer.from('not-a-sealed-json-envelope'));
    const corrupt = await createSafeStorageAuditAnchorStore({
      dataDir: directory,
      safeStorage: createSafeStorageStub(),
      anchorSecret: ANCHOR_SECRET,
    });
    assert.throws(() => corrupt.read('tenant-a'), /AUDIT_ANCHOR_STATE_DECRYPT_FAILED/);

    await assert.rejects(
      createSafeStorageAuditAnchorStore({
        dataDir: directory,
        platform: 'linux',
        safeStorage: createSafeStorageStub({ getSelectedStorageBackend: () => 'basic_text' }),
        anchorSecret: ANCHOR_SECRET,
      }),
      /basic_text/
    );
  });
});
