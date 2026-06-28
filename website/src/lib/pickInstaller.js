// Per-OS installer selection for the download CTA. electron-builder names the
// release assets Puntovivo-<version>-<os>-<arch>.<ext>:
//   mac   -> Puntovivo-1.2.0-mac-arm64.zip      (Squirrel.Mac zip)
//   win   -> Puntovivo-1.2.0-win-x64.exe        (NSIS installer)
//   linux -> Puntovivo-1.2.0-linux-x64.AppImage (AppImage)
// so the button can deep-link straight to the visitor's installer instead of the
// generic releases page.

const OS_MATCHERS = {
  mac: name => /-mac-/.test(name) && /\.(zip|dmg)$/.test(name),
  win: name => /-win-/.test(name) && /\.exe$/.test(name),
  linux: name => /-linux-/.test(name) && /\.AppImage$/.test(name),
};

/**
 * Best-effort OS detection from the UA string. SSR-safe: returns 'unknown' when
 * navigator is absent (the prerender), which keeps the button on its neutral
 * fallback until the client hydrates.
 *
 * @returns {'mac' | 'win' | 'linux' | 'unknown'}
 */
export function detectOS(nav = typeof navigator === 'undefined' ? undefined : navigator) {
  if (!nav) return 'unknown';
  const ua = `${nav.userAgent || ''} ${nav.platform || ''}`.toLowerCase();
  if (/mac|iphone|ipad|ipod/.test(ua)) return 'mac';
  if (/win/.test(ua)) return 'win';
  if (/linux|x11|android/.test(ua)) return 'linux';
  return 'unknown';
}

/**
 * Pick the download URL of the installer matching `os` from a GitHub release's
 * assets, or null when there is no match (older releases, web-only assets, or an
 * unknown OS) so the caller can fall back to the releases page.
 *
 * @param {Array<{ name?: string, browser_download_url?: string }>} assets
 * @param {'mac' | 'win' | 'linux' | 'unknown'} os
 * @returns {string | null}
 */
export function pickInstaller(assets, os) {
  const match = OS_MATCHERS[os];
  if (!match || !Array.isArray(assets)) return null;
  const asset = assets.find(a => typeof a?.name === 'string' && match(a.name));
  return asset?.browser_download_url ?? null;
}
