/**
 * ENG-181 — server error code → i18n key parity sentinel.
 *
 * `SERVER_ERROR_CODES` in `lib/errorCodes.ts` is the canonical
 * enumeration of every `errorCode` the frontend may receive from a
 * TRPCError. The web client funnels these through
 * `translateServerError`, which looks up `errors.server.<CODE>` in
 * the i18n JSON catalogs. Adding a code without adding both locale
 * entries means the user sees an untranslated fallback string in
 * production.
 *
 * This test reads the en / es `errors.json` files directly (no
 * cross-workspace runtime import needed) and asserts every code in
 * `SERVER_ERROR_CODES` has a matching `server.<CODE>` key in both
 * locales. The web side runs `locale-parity.test.ts` which already
 * pins en ⊆ es and es ⊆ en for every namespace — the two tests
 * together close the gap from both directions:
 *
 *   server-side (this file)  → every CODE ⊆ en + es
 *   web-side (parity test)   → en ⇔ es key trees
 *
 * Drift in either lane fails CI before it reaches the user.
 */

import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { SERVER_ERROR_CODES } from '../lib/errorCodes.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Anchor: this file lives at
 * `packages/server/src/__tests__/error-codes-coverage.test.ts`, so
 * four `..` traversals reach the monorepo root and we then descend
 * into `apps/web/src/i18n/locales/<locale>/errors.json`. If the
 * workspace layout changes, update the depth here AND fail loud
 * via the `existsSync` guard below rather than silently parsing
 * the wrong file.
 */
function loadLocaleErrors(locale: 'en' | 'es'): Record<string, unknown> {
  const path = resolve(
    __dirname,
    '..',
    '..',
    '..',
    '..',
    'apps',
    'web',
    'src',
    'i18n',
    'locales',
    locale,
    'errors.json'
  );
  if (!existsSync(path)) {
    throw new Error(
      `error-codes-coverage.test.ts: locale file not found at resolved path:\n` +
        `  ${path}\n` +
        `Anchor: packages/server/src/__tests__ + four '..' traversals.\n` +
        `If the workspace layout changed, update the traversal depth.`
    );
  }
  return JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
}

function getServerNamespace(tree: Record<string, unknown>): Record<string, unknown> {
  const server = tree.server;
  if (!server || typeof server !== 'object') {
    throw new Error(`errors.json missing 'server' namespace`);
  }
  return server as Record<string, unknown>;
}

describe('ENG-181 — SERVER_ERROR_CODES ↔ i18n key parity', () => {
  const enErrors = loadLocaleErrors('en');
  const esErrors = loadLocaleErrors('es');
  const enServer = getServerNamespace(enErrors);
  const esServer = getServerNamespace(esErrors);
  const codes = Object.values(SERVER_ERROR_CODES) as readonly string[];

  it('every SERVER_ERROR_CODES value has a matching errors.server.<CODE> key in EN', () => {
    const missing = codes.filter(code => typeof enServer[code] !== 'string');
    expect(missing).toEqual([]);
  });

  it('every SERVER_ERROR_CODES value has a matching errors.server.<CODE> key in ES', () => {
    const missing = codes.filter(code => typeof esServer[code] !== 'string');
    expect(missing).toEqual([]);
  });

  // Reserved client-side fallback keys that have no SERVER_ERROR_CODES
  // counterpart because they describe transport-level conditions the
  // server cannot label (the request never reached it).
  // - `unknown`: catch-all when the error has no resolvable code.
  // - `networkUnavailable`: the tRPC client never got past TCP/DNS.
  const CLIENT_ONLY_KEYS = new Set<string>(['unknown', 'networkUnavailable']);

  it('no orphan errors.server.<CODE> keys exist that the enum does not declare', () => {
    const allowed = new Set<string>([...CLIENT_ONLY_KEYS, ...codes]);
    const orphansEn = Object.keys(enServer).filter(key => !allowed.has(key));
    const orphansEs = Object.keys(esServer).filter(key => !allowed.has(key));
    expect({ en: orphansEn, es: orphansEs }).toEqual({ en: [], es: [] });
  });

  it('SERVER_ERROR_CODES enum and errors.server keyset have the same cardinality (modulo client-only fallbacks)', () => {
    // Cardinality check is redundant with the two ⊆ tests above but
    // emits a clearer diagnostic when a new code lands without docs.
    const enCount = Object.keys(enServer).length;
    const esCount = Object.keys(esServer).length;
    const expected = codes.length + CLIENT_ONLY_KEYS.size;
    expect(enCount).toBe(expected);
    expect(esCount).toBe(expected);
  });
});
