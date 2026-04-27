/**
 * URL safety helpers (ENG-025 vector 3).
 *
 * Server-side gate against URL schemes that turn an `<img src=...>`
 * (or any other URL-bearing attribute) into an XSS / privilege-
 * escalation primitive when the document is loaded in a Chromium
 * `BrowserWindow` via `data:text/html;...`. The receipt renderer
 * lives behind exactly that surface (`apps/desktop/src/main/index.ts`
 * uses `printWindow.loadURL('data:text/html;...')`), so a tenant-
 * controlled `imageUrl` that resolved to `javascript:alert(1)` would
 * fire on every print preview.
 *
 * Defense in depth — the consumer also escapes the URL before
 * inlining it into HTML; this module's job is to reject bad schemes
 * at input time so they never reach storage.
 *
 * @module lib/urlSafety
 */

/**
 * Schemes the receipt renderer (and any other consumer of operator-
 * supplied URLs) MUST refuse. The set is intentionally conservative:
 * `javascript:` and `vbscript:` are obvious script vectors;
 * `data:text/html` is the historical XSS-via-data-URL path;
 * `file:` and `about:` would let a logo URL navigate the print
 * window away from the receipt content. `data:image/...` stays
 * allowed — that is the canonical inline-image use case.
 */
export const RESOLVED_URL_SCHEME_BLOCKLIST: ReadonlySet<string> = new Set([
  'javascript:',
  'data:text/html',
  'data:application/xhtml',
  'data:application/javascript',
  'vbscript:',
  'file:',
  'about:',
]);

/**
 * Returns `true` when `url` starts (case-insensitive, with leading
 * whitespace stripped) with any prefix in the blocklist. Used by Zod
 * refines and any other server-side validator.
 *
 * Intentionally permissive about non-string input: returns `false`,
 * letting the consumer's structural validator surface the type
 * error. The contract is "if it would resolve to a banned scheme,
 * say so"; nothing else.
 */
export function isUrlSchemeBlocked(url: unknown): boolean {
  if (typeof url !== 'string') return false;
  const normalized = url.trim().toLowerCase();
  if (normalized.length === 0) return false;
  for (const prefix of RESOLVED_URL_SCHEME_BLOCKLIST) {
    if (normalized.startsWith(prefix)) return true;
  }
  return false;
}
