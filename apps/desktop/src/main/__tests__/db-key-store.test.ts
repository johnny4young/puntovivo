import { describe, it, before, after, beforeEach } from 'node:test';
import { strict as assert } from 'node:assert';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  AUDIT_ANCHOR_KEY_FILE,
  DB_KEY_FILE,
  getDbKeyDir,
  getDbKeyEnvelopePath,
  getOrCreateDbKey,
  type SafeStorageLike,
} from '../db-key-store.ts';
import { createSafeStorageStub, sealForTest, unsealForTest } from './helpers/safe-storage.ts';

// exercises the safeStorage-backed key bootstrap. We pass a
// deterministic stub so the test is hermetic: real `safeStorage`
// would require a running Electron context (Keychain prompts on
// macOS, DPAPI handles on Windows, libsecret on Linux) — none of
// which are feasible inside `node --test`.
//
// The stub mirrors the contract of Electron's async SafeStorage API:
// the platform's sealed-format prefix plus an XOR with a fixed mask.
// Not actual encryption — just enough to prove (a) the wrapper
// invokes the encrypt/decrypt pair on first write, (b) the second
// boot decodes the same blob to the original key, (c) the abort
// path fires when `isAsyncEncryptionAvailable()` resolves false.

function makeUnavailableStub(): SafeStorageLike {
  return createSafeStorageStub({
    isAsyncEncryptionAvailable: async () => false,
    encryptStringAsync: async () => {
      throw new Error('encryptStringAsync called when encryption is unavailable');
    },
    decryptStringAsync: async () => {
      throw new Error('decryptStringAsync called when encryption is unavailable');
    },
  });
}

describe('db-key-store', () => {
  let workdir: string;

  before(async () => {
    workdir = await mkdtemp(join(tmpdir(), 'puntovivo-dbkey-'));
  });

  after(async () => {
    if (workdir) {
      await rm(workdir, { recursive: true, force: true });
    }
  });

  beforeEach(() => {
    // Each test starts with no envelope so the create / read branches
    // are isolated.
    const envelope = getDbKeyEnvelopePath(workdir);
    if (existsSync(envelope)) {
      rmSync(envelope);
    }
  });

  it('first boot mints a fresh 256-bit key and persists the sealed envelope', async () => {
    const key = await getOrCreateDbKey(workdir, createSafeStorageStub());

    assert.match(
      key,
      /^[0-9a-f]{64}$/,
      'mintred key must be a 64-character hex string (32 raw bytes)'
    );

    const envelope = readFileSync(getDbKeyEnvelopePath(workdir));
    assert.ok(envelope.length > 0, 'envelope file must be written to disk');
    // Roundtrip via the stub format to confirm the envelope is the
    // encryptStringAsync output.
    assert.equal(unsealForTest(envelope), key);
  });

  it('second boot recovers the same key from the existing envelope', async () => {
    const stub = createSafeStorageStub();
    const first = await getOrCreateDbKey(workdir, stub);
    const second = await getOrCreateDbKey(workdir, stub);
    assert.equal(first, second, 'reboot must yield the same key');
  });

  it('a named envelope (audit anchor) is independent of the SQLCipher envelope', async () => {
    const stub = createSafeStorageStub();
    const dbKey = await getOrCreateDbKey(workdir, stub);
    const anchorKey = await getOrCreateDbKey(workdir, stub, {
      fileName: AUDIT_ANCHOR_KEY_FILE,
    });

    assert.notEqual(anchorKey, dbKey, 'anchor secret must be minted separately');
    assert.match(anchorKey, /^[0-9a-f]{64}$/);
    // Both envelopes coexist and each reboot recovers its own key.
    assert.equal(await getOrCreateDbKey(workdir, stub), dbKey);
    assert.equal(
      await getOrCreateDbKey(workdir, stub, { fileName: AUDIT_ANCHOR_KEY_FILE }),
      anchorKey
    );
  });

  it('aborts when safeStorage.isAsyncEncryptionAvailable resolves false', async () => {
    const stub = makeUnavailableStub();
    await assert.rejects(
      () => getOrCreateDbKey(workdir, stub),
      /OS keychain is unavailable/,
      'a Linux box without libsecret must surface a clear error rather than store cleartext'
    );
    assert.equal(
      existsSync(getDbKeyEnvelopePath(workdir)),
      false,
      'failed bootstrap must NOT leave a partial envelope on disk'
    );
  });

  it('rejects Electron Linux basic_text even when encryption reports available', async () => {
    const stub = createSafeStorageStub({ getSelectedStorageBackend: () => 'basic_text' }, 'linux');

    await assert.rejects(
      () => getOrCreateDbKey(workdir, stub, { platform: 'linux' }),
      /insecure basic_text backend/,
      'Electron basic_text is obfuscation, not an OS-keyring seal'
    );
    assert.equal(
      existsSync(getDbKeyEnvelopePath(workdir)),
      false,
      'the rejected backend must not leave a key envelope'
    );
  });

  it('seals with the keyring prefix on Linux', async () => {
    const key = await getOrCreateDbKey(workdir, createSafeStorageStub({}, 'linux'), {
      platform: 'linux',
    });
    const envelope = readFileSync(getDbKeyEnvelopePath(workdir));
    assert.equal(envelope.subarray(0, 3).toString('latin1'), 'v11');
    assert.equal(unsealForTest(envelope), key);
  });

  it('refuses the Linux fallback key even when the backend looks like a keyring', async () => {
    // Async safeStorage drops to a hard-coded v10 key when the keyring
    // does not answer, while the backend still reports gnome_libsecret.
    const stub = createSafeStorageStub(
      {
        getSelectedStorageBackend: () => 'gnome_libsecret',
        encryptStringAsync: async plain => sealForTest(plain, 'darwin'),
      },
      'linux'
    );

    await assert.rejects(
      () => getOrCreateDbKey(workdir, stub, { platform: 'linux' }),
      /built-in fallback key instead of the keyring/
    );
    assert.equal(existsSync(getDbKeyEnvelopePath(workdir)), false);
  });

  it('refuses a sealed format earlier builds cannot read', async () => {
    const stub = createSafeStorageStub({
      encryptStringAsync: async plain => Buffer.concat([Buffer.from('v20'), Buffer.from(plain)]),
    });

    await assert.rejects(
      () => getOrCreateDbKey(workdir, stub, { platform: 'darwin' }),
      /"v20", which earlier Puntovivo builds cannot read/
    );
    assert.equal(existsSync(getDbKeyEnvelopePath(workdir)), false);
  });

  it('keeps the envelope untouched when safeStorage asks for a reseal', async () => {
    const stub = createSafeStorageStub();
    const key = await getOrCreateDbKey(workdir, stub);
    const before = readFileSync(getDbKeyEnvelopePath(workdir));
    const asksForReseal = createSafeStorageStub({
      decryptStringAsync: async sealed => ({
        result: unsealForTest(sealed),
        shouldReEncrypt: true,
      }),
      encryptStringAsync: async () => {
        throw new Error('reading the key must not reseal it');
      },
    });

    assert.equal(await getOrCreateDbKey(workdir, asksForReseal), key);
    assert.deepEqual(readFileSync(getDbKeyEnvelopePath(workdir)), before);
  });

  it('surfaces a clear error when the envelope decrypts to an invalid shape', async () => {
    // Write an envelope whose plaintext is junk after decryption —
    // simulates a partial write or a foreign envelope sealed by a
    // different OS user.
    const corruptStub = createSafeStorageStub({
      decryptStringAsync: async () => ({
        result: 'this-is-not-hex-or-the-right-length',
        shouldReEncrypt: false,
      }),
    });
    writeFileSync(getDbKeyEnvelopePath(workdir), Buffer.from([0x00, 0x01]));

    await assert.rejects(
      () => getOrCreateDbKey(workdir, corruptStub),
      /decrypted to an invalid shape/,
      'a corrupt envelope must surface a precise error, not a silent key regeneration'
    );
  });

  it('surfaces a clear error when safeStorage rejects the envelope', async () => {
    const rejectingStub = createSafeStorageStub({
      decryptStringAsync: async () => {
        throw new Error('keychain entry not found for this user');
      },
    });
    writeFileSync(getDbKeyEnvelopePath(workdir), Buffer.from([0x99]));

    await assert.rejects(
      () => getOrCreateDbKey(workdir, rejectingStub),
      /failed to decrypt the SQLCipher key envelope/,
      'a keychain reject must surface — not regenerate silently'
    );
  });

  it('asks for an unlock, not a wipe, while the keychain withholds its key', async () => {
    const lockedStub = createSafeStorageStub({
      decryptStringAsync: async () => {
        throw new Error(
          'safeStorage.decryptStringAsync is temporarily unavailable. Please try again.'
        );
      },
    });
    writeFileSync(getDbKeyEnvelopePath(workdir), sealForTest('a'.repeat(64)));

    await assert.rejects(
      () => getOrCreateDbKey(workdir, lockedStub),
      error =>
        error instanceof Error &&
        /Unlock the keychain and restart Puntovivo; nothing was discarded/.test(error.message) &&
        !/wipe/.test(error.message)
    );
  });

  it('surfaces a clear error when the envelope file is truncated to zero bytes', async () => {
    // Simulates the SIGKILL-mid-write failure mode that the atomic
    // write-then-rename in `getOrCreateDbKey` is supposed to prevent
    // on the FIRST boot. Once the canonical envelope EXISTS but is
    // empty, the next boot reads partial bytes, asks safeStorage to
    // decrypt them, and the helper must surface a precise error
    // instead of regenerating a fresh key (which would orphan the
    // existing encrypted DB).
    writeFileSync(getDbKeyEnvelopePath(workdir), Buffer.alloc(0));

    await assert.rejects(
      () => getOrCreateDbKey(workdir, createSafeStorageStub()),
      /failed to decrypt the SQLCipher key envelope/,
      'a half-written envelope must surface — never silently regenerate'
    );
  });

  it('first-boot writes via .tmp + rename so the canonical path never holds a partial file', async () => {
    const envelope = getDbKeyEnvelopePath(workdir);
    if (existsSync(`${envelope}.tmp`)) rmSync(`${envelope}.tmp`);

    await getOrCreateDbKey(workdir, createSafeStorageStub());

    assert.equal(existsSync(envelope), true, 'canonical envelope must exist after success');
    assert.equal(
      existsSync(`${envelope}.tmp`),
      false,
      'temp file must NOT linger after a successful first-boot — rename cleaned it up'
    );
  });

  it('getDbKeyDir derives <userData>/data when given the canonical DB path', () => {
    const probe = join('/var/userData', 'data', 'local.db');
    assert.equal(getDbKeyDir(probe), join('/var/userData', 'data'));
  });

  it('DB_KEY_FILE matches the canonical envelope filename', () => {
    assert.equal(DB_KEY_FILE, '.dbkey.enc');
  });
});
