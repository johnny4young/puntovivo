import { strict as assert } from 'node:assert';
import { mkdtemp, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import {
  getElectronBuilderArch,
  getPackagedPrebuildName,
  pruneNativePrebuilds,
} from './prune-native-prebuilds.mjs';

test('maps supported packaging targets to bundled Node-API filenames', () => {
  assert.equal(getPackagedPrebuildName({ platform: 'darwin', arch: 'arm64' }), 'darwin-arm64.node');
  assert.equal(
    getPackagedPrebuildName({ platform: 'linux', arch: 'x64', libc: 'glibc' }),
    'linux-x64.node'
  );
  assert.equal(
    getPackagedPrebuildName({ platform: 'linux', arch: 'arm64', libc: 'musl' }),
    'linuxmusl-arm64.node'
  );
  assert.equal(getPackagedPrebuildName({ platform: 'win32', arch: 'x64' }), 'win32-x64.node');
});

test('uses electron-builder target architecture instead of the host architecture', () => {
  assert.equal(getElectronBuilderArch(1), 'x64');
  assert.equal(getElectronBuilderArch(3), 'arm64');
  assert.throws(
    () => getElectronBuilderArch(4),
    /Unsupported electron-builder SQLite architecture/u
  );
});

test('keeps only the target native binary in a packaged fixture', async t => {
  const dir = await mkdtemp(path.join(tmpdir(), 'puntovivo-native-prune-'));
  t.after(async () => {
    const { rm } = await import('node:fs/promises');
    await rm(dir, { recursive: true, force: true });
  });
  await Promise.all(
    ['darwin-arm64.node', 'darwin-x64.node', 'linux-x64.node'].map(name =>
      writeFile(path.join(dir, name), name)
    )
  );
  await writeFile(path.join(dir, 'README.txt'), 'keep');

  assert.deepEqual(await pruneNativePrebuilds(dir, 'darwin-arm64.node'), {
    kept: 'darwin-arm64.node',
    removed: 2,
  });
  assert.deepEqual((await readdir(dir)).sort(), ['README.txt', 'darwin-arm64.node']);
});

test('fails closed when the target binary is absent', async t => {
  const dir = await mkdtemp(path.join(tmpdir(), 'puntovivo-native-prune-missing-'));
  t.after(async () => {
    const { rm } = await import('node:fs/promises');
    await rm(dir, { recursive: true, force: true });
  });
  await writeFile(path.join(dir, 'linux-x64.node'), 'wrong target');

  await assert.rejects(
    pruneNativePrebuilds(dir, 'darwin-arm64.node'),
    /Packaged SQLite prebuild darwin-arm64\.node is missing/u
  );
});
