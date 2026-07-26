// Pins the per-platform layout of a packaged build.
//
// This resolver is what makes the packaged smoke and the packaged E2E point at
// a real binary. When it silently fails to find one the suites do not error —
// they test nothing — so the shapes are pinned here against a fixture tree.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EXECUTABLE, resolvePackagedBinary } from './lib/packaged-binary.mjs';

function tree(build) {
  const root = mkdtempSync(join(tmpdir(), 'pv-packaged-'));
  build(root);
  return root;
}

function touch(file) {
  mkdirSync(join(file, '..'), { recursive: true });
  writeFileSync(file, '');
}

test('finds the executable inside a macOS app bundle', () => {
  const root = tree(r => touch(join(r, 'mac-arm64', 'puntovivo.app', 'Contents', 'MacOS', EXECUTABLE)));
  assert.equal(
    resolvePackagedBinary(root, 'darwin'),
    join(root, 'mac-arm64', 'puntovivo.app', 'Contents', 'MacOS', EXECUTABLE)
  );
  rmSync(root, { recursive: true, force: true });
});

test('accepts the .app bundle itself, not only its parent', () => {
  const root = tree(r => touch(join(r, 'Puntovivo.app', 'Contents', 'MacOS', EXECUTABLE)));
  const app = join(root, 'Puntovivo.app');
  assert.equal(resolvePackagedBinary(app, 'darwin'), join(app, 'Contents', 'MacOS', EXECUTABLE));
  rmSync(root, { recursive: true, force: true });
});

test('finds the Linux executable in the unpacked directory', () => {
  const root = tree(r => touch(join(r, 'linux-unpacked', EXECUTABLE)));
  assert.equal(resolvePackagedBinary(root, 'linux'), join(root, 'linux-unpacked', EXECUTABLE));
  rmSync(root, { recursive: true, force: true });
});

test('finds the Windows executable and respects the .exe suffix', () => {
  const root = tree(r => {
    touch(join(r, 'win-unpacked', `${EXECUTABLE}.exe`));
    // A same-named extensionless file must not win on Windows.
    touch(join(r, 'win-unpacked', EXECUTABLE));
  });
  assert.equal(
    resolvePackagedBinary(root, 'win32'),
    join(root, 'win-unpacked', `${EXECUTABLE}.exe`)
  );
  rmSync(root, { recursive: true, force: true });
});

test('throws with the searched path when nothing matches', () => {
  const root = tree(r => touch(join(r, 'linux-unpacked', 'something-else')));
  assert.throws(() => resolvePackagedBinary(root, 'linux'), new RegExp(`no ${EXECUTABLE} executable`));
  rmSync(root, { recursive: true, force: true });
});

test('throws when the path does not exist, rather than returning nothing', () => {
  assert.throws(
    () => resolvePackagedBinary(join(tmpdir(), 'pv-does-not-exist-9182'), 'linux'),
    /does not exist/
  );
});

test('does not descend into an app bundle looking for a Linux executable', () => {
  // A macOS bundle staged next to a Linux build must not satisfy a Linux
  // lookup: launching a darwin binary on linux fails far from here.
  const root = tree(r => touch(join(r, 'mac-arm64', 'puntovivo.app', 'Contents', 'MacOS', EXECUTABLE)));
  assert.throws(() => resolvePackagedBinary(root, 'linux'), new RegExp(`no ${EXECUTABLE} executable`));
  rmSync(root, { recursive: true, force: true });
});
