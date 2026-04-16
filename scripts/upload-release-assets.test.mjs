import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { collectReleaseAssetPaths, uploadReleaseAssets } from './upload-release-assets.mjs';

test('collectReleaseAssetPaths returns only supported release assets in sorted order', () => {
  const tempRoot = mkdtempSync(join(tmpdir(), 'puntovivo-release-assets-'));

  try {
    mkdirSync(join(tempRoot, 'linux'), { recursive: true });
    mkdirSync(join(tempRoot, 'windows'), { recursive: true });
    mkdirSync(join(tempRoot, 'notes'), { recursive: true });

    const expectedPaths = [
      join(tempRoot, 'linux', 'app.AppImage'),
      join(tempRoot, 'linux', 'app.deb'),
      join(tempRoot, 'windows', 'setup.exe'),
      join(tempRoot, 'windows', 'setup.zip'),
    ].sort((left, right) => left.localeCompare(right));

    writeFileSync(join(tempRoot, 'linux', 'app.AppImage'), 'binary');
    writeFileSync(join(tempRoot, 'linux', 'app.deb'), 'binary');
    writeFileSync(join(tempRoot, 'windows', 'setup.exe'), 'binary');
    writeFileSync(join(tempRoot, 'windows', 'setup.zip'), 'binary');
    writeFileSync(join(tempRoot, 'notes', 'release-notes.txt'), 'ignore');
    writeFileSync(join(tempRoot, 'windows', 'setup.exe.blockmap'), 'ignore');

    assert.deepEqual(collectReleaseAssetPaths(tempRoot), expectedPaths);
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('collectReleaseAssetPaths supports direct file inputs for prebuilt archives', () => {
  const tempRoot = mkdtempSync(join(tmpdir(), 'puntovivo-release-assets-file-'));

  try {
    const archivePath = join(tempRoot, 'puntovivo-web-v1.2.3.zip');
    const ignoredPath = join(tempRoot, 'puntovivo-web-v1.2.3.txt');

    writeFileSync(archivePath, 'binary');
    writeFileSync(ignoredPath, 'ignore');

    assert.deepEqual(collectReleaseAssetPaths([archivePath, ignoredPath]), [archivePath]);
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('collectReleaseAssetPaths fails with a clear message when an input path is missing', () => {
  const missingPath = join(tmpdir(), 'puntovivo-missing-release-asset.zip');

  assert.throws(
    () => collectReleaseAssetPaths(missingPath),
    /Release asset path does not exist: .*puntovivo-missing-release-asset\.zip/
  );
});

test('uploadReleaseAssets shells out once per asset with gh release upload --clobber', () => {
  /** @type {Array<{command: string; args: string[]}>} */
  const calls = [];

  const uploadedCount = uploadReleaseAssets('v1.2.3', ['/tmp/app.exe', '/tmp/app.zip'], {
    spawn(command, args) {
      calls.push({ command, args });
      return { status: 0 };
    },
  });

  assert.equal(uploadedCount, 2);
  assert.deepEqual(calls, [
    {
      command: 'gh',
      args: ['release', 'upload', 'v1.2.3', '/tmp/app.exe', '--clobber'],
    },
    {
      command: 'gh',
      args: ['release', 'upload', 'v1.2.3', '/tmp/app.zip', '--clobber'],
    },
  ]);
});

test('uploadReleaseAssets rejects empty release tags', () => {
  assert.throws(
    () => uploadReleaseAssets('', ['/tmp/app.exe']),
    /Release tag is required for asset upload/
  );
});

test('uploadReleaseAssets rejects missing assets', () => {
  assert.throws(() => uploadReleaseAssets('v1.2.3', []), /No release assets found to upload/);
});

test('uploadReleaseAssets fails when gh upload fails', () => {
  assert.throws(
    () =>
      uploadReleaseAssets('v1.2.3', ['/tmp/app.exe'], {
        spawn() {
          return { status: 1, stderr: 'upload rejected' };
        },
      }),
    /Failed to upload release asset \/tmp\/app\.exe: upload rejected/
  );
});
