import { test } from 'node:test';
import { strict as assert } from 'node:assert';

import { rewriteFeed, releaseDownloadBase } from './rewrite-update-feed.mjs';

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
  const win = rewriteFeed('files:\n  - url: Puntovivo-1.2.0-win-x64.exe\npath: Puntovivo-1.2.0-win-x64.exe\n', BASE);
  assert.match(win, new RegExp(`url: ${BASE}/Puntovivo-1.2.0-win-x64.exe`));
  const linux = rewriteFeed('files:\n  - url: Puntovivo-1.2.0-linux-x64.AppImage\n', BASE);
  assert.match(linux, new RegExp(`url: ${BASE}/Puntovivo-1.2.0-linux-x64.AppImage`));
});

test('rewriteFeed ignores non-installer values like .blockmap', () => {
  const out = rewriteFeed('  - url: Puntovivo-1.2.0-win-x64.exe.blockmap\n', BASE);
  assert.match(out, /url: Puntovivo-1\.2\.0-win-x64\.exe\.blockmap/);
  assert.doesNotMatch(out, new RegExp(BASE));
});
