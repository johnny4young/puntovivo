/** Default suite-owned backend origin when no isolated override is configured. */
export const DEFAULT_E2E_API_ORIGIN = 'http://localhost:8090';

/** Dedicated renderer port; the owned backend must never claim it. */
export const E2E_WEB_PORT = '5173';

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
  if (url.port === E2E_WEB_PORT) {
    throw new Error(`E2E API origin cannot use the dedicated Web port ${E2E_WEB_PORT}`);
  }
  return url.origin;
}

/** Origin for direct HTTP/CLI probes; the Web config exports the validated value. */
export function e2eApiOrigin(): string {
  return resolveE2eApiOrigin(process.env.PUNTOVIVO_E2E_API_ORIGIN, DEFAULT_E2E_API_ORIGIN);
}

/** Keep Web and API on the same site without relaxing strict refresh cookies. */
export function resolveE2eWebOrigin(apiOrigin: string): string {
  const url = new URL(resolveE2eApiOrigin(apiOrigin, DEFAULT_E2E_API_ORIGIN));
  url.port = E2E_WEB_PORT;
  return url.origin;
}
