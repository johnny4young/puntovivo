import { useEffect, useState } from 'react';

// Repo URLs reused across the smart download button and footer/contact links.
export const REPO_URL = 'https://github.com/johnny4young/puntovivo';
export const RELEASES_URL = `${REPO_URL}/releases`;

// Build-time fallback. There are NO releases yet, so this is what every visitor
// sees today: a neutral "open source · in development" label rather than a fake
// version tag. Once the repo cuts a GitHub release, the hook picks up the real
// tag (e.g. "v1.2.3") on mount and `hasRelease` flips to true.
export const FALLBACK_VERSION = null;

const RELEASES_API = 'https://api.github.com/repos/johnny4young/puntovivo/releases/latest';

/**
 * Fetches the repo's latest GitHub release on mount. Never blocks render:
 * starts with no known release (FALLBACK_VERSION === null) and swaps in the
 * real tag + installer URL if/when the fetch resolves with a tag_name. Any
 * failure (no releases, rate limit, offline) silently keeps the fallback, so
 * the UI degrades to "build from source".
 *
 * Returns a stable shape:
 *   { hasRelease, version, releaseUrl, assets }
 * - hasRelease  true once a real GitHub release is found.
 * - version     the real tag (e.g. "v1.2.3") or null when none exists.
 * - releaseUrl  the html_url of the release, or the releases page as fallback.
 * - assets      the release asset list ([] when none), for per-OS installers.
 */
export function useLatestRelease() {
  const [state, setState] = useState({
    hasRelease: false,
    version: FALLBACK_VERSION,
    releaseUrl: RELEASES_URL,
    assets: [],
  });

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();

    fetch(RELEASES_API, {
      signal: controller.signal,
      headers: { Accept: 'application/vnd.github+json' },
    })
      .then(res => (res.ok ? res.json() : null))
      .then(data => {
        if (cancelled || !data) return;
        const tag = typeof data.tag_name === 'string' ? data.tag_name.trim() : '';
        if (!tag) return;
        setState({
          hasRelease: true,
          version: tag,
          releaseUrl: typeof data.html_url === 'string' ? data.html_url : RELEASES_URL,
          assets: Array.isArray(data.assets) ? data.assets : [],
        });
      })
      .catch(() => {
        /* keep the fallback on any error */
      });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, []);

  return state;
}
