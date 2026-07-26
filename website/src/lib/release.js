// Repo URLs and the latest-release lookup, shared by the footer version tag
// and the smart download CTA.
//
// The React version was a hook that fetched on mount. The static build renders
// the no-release state into the HTML (which is what every visitor sees today,
// because no release exists yet) and a small progressive-enhancement script
// upgrades it in place if the fetch succeeds. Failure — offline, rate limit, no
// releases — leaves the rendered fallback untouched.

export const REPO_URL = 'https://github.com/johnny4young/puntovivo';
export const RELEASES_URL = `${REPO_URL}/releases`;
export const RELEASES_API = 'https://api.github.com/repos/johnny4young/puntovivo/releases/latest';

/** Normalize the GitHub payload into the shape the UI consumes. */
export function readRelease(data) {
  const tag = typeof data?.tag_name === 'string' ? data.tag_name.trim() : '';
  if (!tag) return null;
  return {
    version: tag,
    releaseUrl: typeof data.html_url === 'string' ? data.html_url : RELEASES_URL,
    assets: Array.isArray(data.assets) ? data.assets : [],
  };
}
