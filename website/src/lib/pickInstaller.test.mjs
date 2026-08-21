import { test } from 'node:test';
import { strict as assert } from 'node:assert';

import { detectOS, pickInstaller } from './pickInstaller.js';

const assets = [
  { name: 'Puntovivo-1.2.0-mac-arm64.zip', browser_download_url: 'https://x/mac.zip' },
  { name: 'Puntovivo-1.2.0-win-x64.exe', browser_download_url: 'https://x/win.exe' },
  { name: 'Puntovivo-1.2.0-linux-x64.AppImage', browser_download_url: 'https://x/linux.AppImage' },
  { name: 'puntovivo-web-v1.2.0.zip', browser_download_url: 'https://x/web.zip' },
];

test('pickInstaller returns the matching per-OS installer URL', () => {
  assert.equal(pickInstaller(assets, 'mac'), 'https://x/mac.zip');
  assert.equal(pickInstaller(assets, 'win'), 'https://x/win.exe');
  assert.equal(pickInstaller(assets, 'linux'), 'https://x/linux.AppImage');
});

test('pickInstaller never returns the web bundle for an OS', () => {
  for (const os of ['mac', 'win', 'linux']) {
    assert.notEqual(pickInstaller(assets, os), 'https://x/web.zip');
  }
});

test('pickInstaller returns null for unknown OS, no match, or bad input', () => {
  assert.equal(pickInstaller(assets, 'unknown'), null);
  assert.equal(pickInstaller([{ name: 'Puntovivo-1.2.0-mac-arm64.zip' }], 'win'), null);
  assert.equal(pickInstaller(null, 'mac'), null);
});

test('detectOS reads the UA, returning unknown when nothing matches', () => {
  assert.equal(detectOS({ userAgent: 'Mozilla/5.0 (Macintosh; ...)', platform: 'MacIntel' }), 'mac');
  assert.equal(detectOS({ userAgent: 'Mozilla/5.0 (Windows NT 10.0; ...)', platform: 'Win32' }), 'win');
  assert.equal(detectOS({ userAgent: 'Mozilla/5.0 (X11; Linux x86_64)', platform: 'Linux x86_64' }), 'linux');
  // Empty nav -> no match -> unknown. (A genuinely absent navigator also yields
  // 'unknown' via the typeof guard, but Node defines a global navigator so that
  // branch cannot be exercised here; the prerender relies on the DownloadButton
  // only calling detectOS once hasRelease is true, i.e. never during SSR.)
  assert.equal(detectOS({ userAgent: '', platform: '' }), 'unknown');
});

test('detectOS refuses to hand a desktop installer to a phone or tablet', () => {
  // These used to resolve to 'mac' and 'linux', deep-linking a visitor to an
  // Apple-Silicon macOS archive or a Linux AppImage their device cannot run.
  const iphone =
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148';
  const android =
    'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36';
  assert.equal(detectOS({ userAgent: iphone, platform: 'iPhone' }), 'unknown');
  assert.equal(detectOS({ userAgent: android, platform: 'Linux armv8l' }), 'unknown');

  // iPadOS 13+ reports a desktop Safari UA; the touch-point count is what
  // separates it from a real Mac.
  const ipadOS =
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/17.0 Safari/605.1.15';
  assert.equal(detectOS({ userAgent: ipadOS, platform: 'MacIntel', maxTouchPoints: 5 }), 'unknown');
  // A real Mac reports no touch points and still resolves.
  assert.equal(detectOS({ userAgent: ipadOS, platform: 'MacIntel', maxTouchPoints: 0 }), 'mac');
});
