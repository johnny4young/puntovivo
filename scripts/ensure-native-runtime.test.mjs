import { strict as assert } from 'node:assert';
import { access } from 'node:fs/promises';
import { test } from 'node:test';
import {
  assertNodeApiPackage,
  getPrebuildTarget,
  verifyNativeRuntime,
} from './ensure-native-runtime.mjs';

test('maps every supported platform and architecture to its bundled prebuild', () => {
  assert.equal(getPrebuildTarget({ platform: 'darwin', arch: 'arm64' }), 'darwin-arm64');
  assert.equal(getPrebuildTarget({ platform: 'darwin', arch: 'x64' }), 'darwin-x64');
  assert.equal(getPrebuildTarget({ platform: 'linux', arch: 'x64', libc: 'glibc' }), 'linux-x64');
  assert.equal(
    getPrebuildTarget({ platform: 'linux', arch: 'arm64', libc: 'musl' }),
    'linuxmusl-arm64'
  );
  assert.equal(getPrebuildTarget({ platform: 'win32', arch: 'x64' }), 'win32-x64');
});

test('rejects platforms and architectures without an upstream prebuild', () => {
  assert.throws(
    () => getPrebuildTarget({ platform: 'freebsd', arch: 'x64' }),
    /Unsupported better-sqlite3 platform/u
  );
  assert.throws(
    () => getPrebuildTarget({ platform: 'linux', arch: 'arm' }),
    /Unsupported better-sqlite3 architecture/u
  );
});

test('installed SQLite fork is Node-API v13+ with the host prebuild present', async () => {
  const installed = assertNodeApiPackage();
  assert.equal(installed.packageJson.name, 'better-sqlite3-multiple-ciphers');
  assert.ok(Number.parseInt(installed.packageJson.version, 10) >= 13);
  await access(installed.prebuildPath);
});

test('the host Node runtime loads SQLite and the SQLCipher contract', () => {
  const result = verifyNativeRuntime('node');
  assert.equal(result.sqlite, 1);
  assert.equal(result.cipher, 'sqlcipher');
  assert.equal(result.electron, null);
  assert.equal(result.napi, process.versions.napi);
});
