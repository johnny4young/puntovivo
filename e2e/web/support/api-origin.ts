/** Keep test-only direct probes on the suite-owned loopback server. */
export function resolveE2eApiOrigin(configured: string | undefined, fallback: string): string {
  const raw = configured === undefined ? fallback : configured.trim();
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error('E2E API origin must be an HTTP loopback origin with an explicit port');
  }
  // URL normalizes dot paths, empty delimiters and embedded controls. Reject
  // those components from the input before accepting the normalized origin.
  const hasOriginOnlyShape = /^http:\/\/[^/\\?#\s]+\/?$/i.test(raw);
  if (
    !hasOriginOnlyShape ||
    url.protocol !== 'http:' ||
    !['localhost', '127.0.0.1'].includes(url.hostname) ||
    !url.port ||
    Number(url.port) < 1 ||
    url.username ||
    url.password ||
    url.pathname !== '/' ||
    url.search ||
    url.hash
  ) {
    throw new Error('E2E API origin must be an HTTP loopback origin with an explicit port');
  }
  return url.origin;
}

/** Keep Web and API on the same site without relaxing strict refresh cookies. */
export function resolveE2eWebOrigin(apiOrigin: string): string {
  const url = new URL(resolveE2eApiOrigin(apiOrigin, 'http://localhost:8090'));
  url.port = '5173';
  return url.origin;
}
