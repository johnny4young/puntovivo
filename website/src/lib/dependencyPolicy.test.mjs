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
  assertMinimumVersion('astro', [7, 2, 8], 'GHSA-26w7-cxv4-gfx2');
  assertMinimumVersion('sharp', [0, 35, 5], 'GHSA-wq5f-xc86-pv6w');
  assertMinimumVersion('js-yaml', [4, 3, 2], 'GHSA-2883-xcg3-v3hh');
  assertMinimumVersion('svgo', [4, 1, 0], 'GHSA-w27v-7q3p-w38r');
  assertMinimumVersion('smol-toml', [1, 9, 0], 'GHSA-r4xh-jqrq-34v2');
  assertMinimumVersion('devalue', [5, 9, 3], 'GHSA-j22f-vq7h-c4qm');
  assertMinimumVersion('http-cache-semantics', [4, 3, 0], 'GHSA-ch52-4w7c-c8xp');
  assertMinimumVersion('source-map-js', [1, 2, 2], 'GHSA-68fv-2mgg-jv7q');
  assertMinimumVersion('nanoid', [3, 3, 17], 'GHSA-2v37-7h3g-55p8');
});
