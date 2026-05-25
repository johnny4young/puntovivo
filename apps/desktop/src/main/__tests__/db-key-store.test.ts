import { describe, it, before, after, beforeEach } from 'node:test';
import { strict as assert } from 'node:assert';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  DB_KEY_FILE,
  getDbKeyDir,
  getDbKeyEnvelopePath,
  getOrCreateDbKey,
  type SafeStorageLike,
} from '../db-key-store.ts';

// ENG-167 — exercises the safeStorage-backed key bootstrap. We pass a
// deterministic stub so the test is hermetic: real `safeStorage`
// would require a running Electron context (Keychain prompts on
// macOS, DPAPI handles on Windows, libsecret on Linux) — none of
// which are feasible inside `node --test`.
//
// The stub mirrors the contract of Electron's SafeStorage API: an
// XOR with a fixed sentinel mask plus a length-prefixed envelope.
// Not actual encryption — just enough to prove (a) the wrapper
// invokes the encrypt/decrypt pair on first write, (b) the second
// boot decodes the same blob to the original key, (c) the abort
// path fires when `isEncryptionAvailable()` returns false.

const XOR_MASK = 0x5a;

function makeWorkingStub(): SafeStorageLike {
  return {
    isEncryptionAvailable: () => true,
    encryptString: (plain: string) => {
      const buf = Buffer.from(plain, 'utf8');
      return Buffer.from(buf.map(b => b ^ XOR_MASK));
    },
    decryptString: (sealed: Buffer) => {
      return Buffer.from(sealed.map(b => b ^ XOR_MASK)).toString('utf8');
    },
  };
}

function makeUnavailableStub(): SafeStorageLike {
  return {
    isEncryptionAvailable: () => false,
    encryptString: () => {
      throw new Error('encryptString called when isEncryptionAvailable=false');
    },
    decryptString: () => {
      throw new Error('decryptString called when isEncryptionAvailable=false');
    },
  };
}

describe('db-key-store (ENG-167)', () => {
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
    const stub = makeWorkingStub();
    const key = await getOrCreateDbKey(workdir, stub);

    assert.match(
      key,
      /^[0-9a-f]{64}$/,
      'mintred key must be a 64-character hex string (32 raw bytes)'
    );

    const envelope = readFileSync(getDbKeyEnvelopePath(workdir));
    assert.ok(envelope.length > 0, 'envelope file must be written to disk');
    // Roundtrip via the stub to confirm the envelope is what we think
    // it is (the encryptString output).
    assert.equal(stub.decryptString(envelope), key);
  });

  it('second boot recovers the same key from the existing envelope', async () => {
    const stub = makeWorkingStub();
    const first = await getOrCreateDbKey(workdir, stub);
    const second = await getOrCreateDbKey(workdir, stub);
    assert.equal(first, second, 'reboot must yield the same key');
  });

  it('aborts when safeStorage.isEncryptionAvailable returns false', async () => {
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

  it('surfaces a clear error when the envelope decrypts to an invalid shape', async () => {
    // Write an envelope whose plaintext is junk after decryption —
    // simulates a partial write or a foreign envelope sealed by a
    // different OS user.
    const envelope = getDbKeyEnvelopePath(workdir);
    const corruptStub: SafeStorageLike = {
      isEncryptionAvailable: () => true,
      encryptString: () => Buffer.from([0x00]),
      decryptString: () => 'this-is-not-hex-or-the-right-length',
    };
    // First seed the envelope file directly:
    const { writeFileSync } = await import('node:fs');
    writeFileSync(envelope, Buffer.from([0x00, 0x01]));

    await assert.rejects(
      () => getOrCreateDbKey(workdir, corruptStub),
      /decrypted to an invalid shape/,
      'a corrupt envelope must surface a precise error, not a silent key regeneration'
    );
  });

  it('surfaces a clear error when safeStorage rejects the envelope', async () => {
    const envelope = getDbKeyEnvelopePath(workdir);
    const rejectingStub: SafeStorageLike = {
      isEncryptionAvailable: () => true,
      encryptString: () => Buffer.from([0x00]),
      decryptString: () => {
        throw new Error('keychain entry not found for this user');
      },
    };
    const { writeFileSync } = await import('node:fs');
    writeFileSync(envelope, Buffer.from([0x99]));

    await assert.rejects(
      () => getOrCreateDbKey(workdir, rejectingStub),
      /failed to decrypt the SQLCipher key envelope/,
      'a keychain reject must surface — not regenerate silently'
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
    const envelope = getDbKeyEnvelopePath(workdir);
    const { writeFileSync } = await import('node:fs');
    writeFileSync(envelope, Buffer.alloc(0));

    const truncatedStub: SafeStorageLike = {
      isEncryptionAvailable: () => true,
      encryptString: () => Buffer.from([0x00]),
      decryptString: (sealed: Buffer) => {
        if (sealed.length === 0) {
          throw new Error('cannot decrypt zero-length envelope');
        }
        return 'unused';
      },
    };

    await assert.rejects(
      () => getOrCreateDbKey(workdir, truncatedStub),
      /failed to decrypt the SQLCipher key envelope/,
      'a half-written envelope must surface — never silently regenerate'
    );
  });

  it('first-boot writes via .tmp + rename so the canonical path never holds a partial file', async () => {
    // Cleanup any leftover from prior tests.
    const envelope = getDbKeyEnvelopePath(workdir);
    const { existsSync, rmSync } = await import('node:fs');
    if (existsSync(envelope)) rmSync(envelope);
    if (existsSync(`${envelope}.tmp`)) rmSync(`${envelope}.tmp`);

    const stub = makeWorkingStub();
    await getOrCreateDbKey(workdir, stub);

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
