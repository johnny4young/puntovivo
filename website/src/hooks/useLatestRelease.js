import { useEffect, useState } from 'react';

// Build-time fallback. There are no releases yet, so this shows initially —
// that is expected. Once the repo cuts a GitHub release, the hook picks up the
// real tag (e.g. "v1.2.3") on mount.
export const FALLBACK_VERSION = 'v1.0';

const RELEASES_API = 'https://api.github.com/repos/johnny4young/puntovivo/releases/latest';

/**
 * Fetches the repo's latest GitHub release tag on mount. Never blocks render:
 * starts with FALLBACK_VERSION and swaps in the real tag if/when the fetch
 * resolves with a tag_name. Any failure (no releases, rate limit, offline)
 * silently keeps the fallback.
 */
export function useLatestRelease() {
  const [version, setVersion] = useState(FALLBACK_VERSION);

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
        if (tag) setVersion(tag);
      })
      .catch(() => {
        /* keep the fallback on any error */
      });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, []);

  return version;
}
