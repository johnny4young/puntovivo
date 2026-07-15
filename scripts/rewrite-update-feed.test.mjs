import { test } from 'node:test';
import { strict as assert } from 'node:assert';

import {
  applyStagingPercentage,
  buildUpdatePolicy,
  rewriteFeed,
  releaseDownloadBase,
  versionFromTag,
} from './rewrite-update-feed.mjs';

const BASE = 'https://github.com/johnny4young/puntovivo/releases/download/v1.2.0';

const MAC_FEED = `version: 1.2.0
files:
  - url: Puntovivo-1.2.0-mac-arm64.zip
    sha512: Sy69TjjdCYoEK+0Pzip==
    size: 177896338
path: Puntovivo-1.2.0-mac-arm64.zip
sha512: Sy69TjjdCYoEK+0Pzip==
releaseDate: '2026-06-28T21:50:40.554Z'
`;

test('releaseDownloadBase builds the GitHub Release download base', () => {
  assert.equal(releaseDownloadBase('johnny4young/puntovivo', 'v1.2.0'), BASE);
  assert.equal(releaseDownloadBase('johnny4young/puntovivo', ' v1.2.0 '), BASE);
  assert.throws(
    () => releaseDownloadBase('johnny4young/puntovivo/../../other', 'v1.2.0'),
    /owner\/repo form/
  );
  assert.throws(
    () => releaseDownloadBase('johnny4young/puntovivo', 'latest'),
    /semantic version/
  );
});

test('rewriteFeed makes url + path absolute and leaves the rest untouched', () => {
  const out = rewriteFeed(MAC_FEED, BASE);
  assert.match(out, new RegExp(`- url: ${BASE}/Puntovivo-1.2.0-mac-arm64.zip`));
  assert.match(out, new RegExp(`^path: ${BASE}/Puntovivo-1.2.0-mac-arm64.zip$`, 'm'));
  // sha512, size, version, releaseDate are unchanged.
  assert.match(out, /sha512: Sy69TjjdCYoEK\+0Pzip==/);
  assert.match(out, /size: 177896338/);
  assert.match(out, /version: 1\.2\.0/);
  assert.match(out, /releaseDate: '2026-06-28T21:50:40\.554Z'/);
});

test('rewriteFeed is idempotent (already-absolute urls are left alone)', () => {
  const once = rewriteFeed(MAC_FEED, BASE);
  assert.equal(rewriteFeed(once, BASE), once);
});

test('rewriteFeed handles NSIS (.exe) and AppImage installers', () => {
  const win = rewriteFeed(
    'files:\n  - url: Puntovivo-1.2.0-win-x64.exe\npath: Puntovivo-1.2.0-win-x64.exe\n',
    BASE
  );
  assert.match(win, new RegExp(`url: ${BASE}/Puntovivo-1.2.0-win-x64.exe`));
  const linux = rewriteFeed('files:\n  - url: Puntovivo-1.2.0-linux-x64.AppImage\n', BASE);
  assert.match(linux, new RegExp(`url: ${BASE}/Puntovivo-1.2.0-linux-x64.AppImage`));
});

test('rewriteFeed ignores non-installer values like .blockmap', () => {
  const out = rewriteFeed('  - url: Puntovivo-1.2.0-win-x64.exe.blockmap\n', BASE);
  assert.match(out, /url: Puntovivo-1\.2\.0-win-x64\.exe\.blockmap/);
  assert.doesNotMatch(out, new RegExp(BASE));
});

test('applyStagingPercentage inserts and promotes the root rollout value idempotently', () => {
  const ten = applyStagingPercentage(MAC_FEED, 10);
  assert.match(ten, /^version: 1\.2\.0\nstagingPercentage: 10$/m);

  const fifty = applyStagingPercentage(ten, 50);
  assert.match(fifty, /^version: 1\.2\.0\nstagingPercentage: 50$/m);
  assert.equal((fifty.match(/^stagingPercentage:/gm) ?? []).length, 1);
  assert.equal(applyStagingPercentage(fifty, 50), fifty);
});

test('applyStagingPercentage rejects unsupported percentages and malformed feeds', () => {
  assert.throws(() => applyStagingPercentage(MAC_FEED, 25), /10, 50, or 100/);
  assert.throws(() => applyStagingPercentage('files: []\n', 10), /missing a root version/);
});

test('applyStagingPercentage never consumes the YAML key after a malformed empty value', () => {
  const promoted = applyStagingPercentage(
    'version: 1.2.0\nstagingPercentage:\nfiles:\n  - url: Puntovivo-1.2.0.zip\n',
    50
  );

  assert.match(promoted, /^stagingPercentage: 50$/m);
  assert.match(promoted, /^files:$/m);
  assert.match(promoted, /^  - url: Puntovivo-1\.2\.0\.zip$/m);
});

test('buildUpdatePolicy emits a deterministic normal policy from the release tag', () => {
  assert.deepEqual(
    buildUpdatePolicy({
      tag: 'v1.2.0',
      percentage: 10,
      mode: 'normal',
      now: new Date('2026-07-15T12:00:00.000Z'),
    }),
    {
      schemaVersion: 1,
      mode: 'normal',
      targetVersion: '1.2.0',
      rolloutPercentage: 10,
      publishedAt: '2026-07-15T12:00:00.000Z',
    }
  );
});

test('buildUpdatePolicy makes rollback fleet-wide and validates semantic tags', () => {
  assert.equal(versionFromTag('v2.0.0-beta.1'), '2.0.0-beta.1');
  assert.throws(
    () => buildUpdatePolicy({ tag: 'v1.2.0', percentage: 50, mode: 'rollback' }),
    /must target 100 percent/
  );
  assert.throws(() => versionFromTag('latest'), /semantic version/);
});
