import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const lockfile = readFileSync(new URL('../../pnpm-lock.yaml', import.meta.url), 'utf8');

function lockedVersions(packageName) {
  const escapedName = packageName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`^  ${escapedName}@(\\d+)\\.(\\d+)\\.(\\d+):$`, 'gm');
  return [...lockfile.matchAll(pattern)].map(match => match.slice(1, 4).map(Number));
}

function compareVersion(left, right) {
  for (let index = 0; index < 3; index += 1) {
    if (left[index] !== right[index]) return left[index] - right[index];
  }
  return 0;
}

function assertMinimumVersion(packageName, minimum, advisory) {
  const versions = lockedVersions(packageName);
  assert.ok(versions.length > 0, `expected ${packageName} in the standalone website lockfile`);

  for (const [major, minor, patch] of versions) {
    const current = [major, minor, patch];
    assert.ok(
      compareVersion(current, minimum) >= 0,
      `${packageName} ${current.join('.')} is vulnerable to ${advisory}`
    );
  }
}

test('the dependency floor compares major, minor and patch versions in order', () => {
  assert.ok(compareVersion([4, 3, 0], [4, 3, 1]) < 0);
  assert.equal(compareVersion([4, 3, 1], [4, 3, 1]), 0);
  assert.ok(compareVersion([5, 0, 0], [4, 3, 1]) > 0);
});

test('the standalone site lock excludes known vulnerable build dependencies', () => {
  assertMinimumVersion('js-yaml', [4, 3, 1], 'GHSA-5p4m-2wfm-xmqj');
  assertMinimumVersion('nanoid', [3, 3, 17], 'GHSA-2v37-7h3g-55p8');
});
