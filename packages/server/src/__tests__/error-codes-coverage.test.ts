/**
 * server error code → i18n key parity sentinel.
 *
 * `SERVER_ERROR_CODES` in `lib/errorCodes.ts` is the canonical
 * enumeration of every `errorCode` the frontend may receive from a
 * TRPCError. The web client funnels these through
 * `translateServerError`, which routes each code to either the bootstrap
 * `errors` namespace or a registered lazy namespace. Adding a code without
 * adding both locale entries means the user sees an untranslated fallback
 * string in production.
 *
 * This test reads the web-owned namespace manifest and its en / es JSON files
 * directly (no cross-workspace runtime import needed). It asserts every code
 * in `SERVER_ERROR_CODES` has exactly one matching `server.<CODE>` key in the
 * namespace selected by the same manifest that the renderer consumes. The web
 * side runs `locale-parity.test.ts`, which also pins en ⇔ es key trees.
 *
 * server-side (this file)  → every CODE exists once in its routed namespace
 * web-side (parity test)   → en ⇔ es key trees across every namespace
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
const WEB_I18N_ROOT = resolve(__dirname, '..', '..', '..', '..', 'apps', 'web', 'src', 'i18n');

interface ServerErrorNamespaceRoute {
  namespace: string;
  prefixes: string[];
}

interface ServerErrorNamespaceManifest {
  defaultNamespace: string;
  routes: ServerErrorNamespaceRoute[];
}

function loadNamespaceManifest(): ServerErrorNamespaceManifest {
  const path = resolve(WEB_I18N_ROOT, 'server-error-namespaces.json');
  if (!existsSync(path)) {
    throw new Error(`Server-error namespace manifest not found at ${path}`);
  }

  const manifest = JSON.parse(readFileSync(path, 'utf8')) as Partial<ServerErrorNamespaceManifest>;
  if (
    typeof manifest.defaultNamespace !== 'string' ||
    !Array.isArray(manifest.routes) ||
    manifest.routes.some(
      route =>
        !route ||
        typeof route.namespace !== 'string' ||
        !Array.isArray(route.prefixes) ||
        route.prefixes.length === 0 ||
        route.prefixes.some(prefix => typeof prefix !== 'string' || prefix.length === 0)
    )
  ) {
    throw new Error(`Invalid server-error namespace manifest at ${path}`);
  }

  return manifest as ServerErrorNamespaceManifest;
}

function loadLocaleNamespace(locale: 'en' | 'es', namespace: string): Record<string, unknown> {
  const path = resolve(WEB_I18N_ROOT, 'locales', locale, `${namespace}.json`);
  if (!existsSync(path)) {
    throw new Error(
      `error-codes-coverage.test.ts: locale namespace not found at resolved path:\n` +
        `  ${path}\n` +
        `Anchor: packages/server/src/__tests__ + four '..' traversals.\n` +
        `If the workspace layout changed, update the traversal depth.`
    );
  }
  return JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
}

function getServerNamespace(
  tree: Record<string, unknown>,
  namespace: string
): Record<string, unknown> {
  const server = tree.server;
  if (!server || typeof server !== 'object') {
    throw new Error(`${namespace}.json missing 'server' object`);
  }
  return server as Record<string, unknown>;
}

function getPrimaryNamespace(code: string, manifest: ServerErrorNamespaceManifest): string {
  const matches = manifest.routes.filter(route =>
    route.prefixes.some(prefix => code.startsWith(prefix))
  );
  if (matches.length > 1) {
    throw new Error(
      `Server error code ${code} matches multiple namespace routes: ${matches
        .map(route => route.namespace)
        .join(', ')}`
    );
  }
  return matches[0]?.namespace ?? manifest.defaultNamespace;
}

describe(' — SERVER_ERROR_CODES ↔ i18n key parity', () => {
  const manifest = loadNamespaceManifest();
  const namespaces = [manifest.defaultNamespace, ...manifest.routes.map(route => route.namespace)];
  const duplicateNamespaces = namespaces.filter(
    (namespace, index) => namespaces.indexOf(namespace) !== index
  );
  if (duplicateNamespaces.length > 0) {
    throw new Error(
      `Duplicate server-error namespaces in manifest: ${duplicateNamespaces.join(', ')}`
    );
  }

  const localeServers = Object.fromEntries(
    (['en', 'es'] as const).map(locale => [
      locale,
      Object.fromEntries(
        namespaces.map(namespace => [
          namespace,
          getServerNamespace(loadLocaleNamespace(locale, namespace), namespace),
        ])
      ),
    ])
  ) as Record<'en' | 'es', Record<string, Record<string, unknown>>>;
  const codes = Object.values(SERVER_ERROR_CODES) as readonly string[];

  it.each(['en', 'es'] as const)(
    'every SERVER_ERROR_CODES value exists once in its routed %s namespace',
    locale => {
      const failures = codes.flatMap(code => {
        const primaryNamespace = getPrimaryNamespace(code, manifest);
        const placements = namespaces.filter(
          namespace => typeof localeServers[locale][namespace]?.[code] === 'string'
        );
        return placements.length === 1 && placements[0] === primaryNamespace
          ? []
          : [{ code, expected: primaryNamespace, actual: placements }];
      });
      expect(failures).toEqual([]);
    }
  );

  // Reserved client-side fallback keys that have no SERVER_ERROR_CODES
  // counterpart because they describe transport-level conditions the
  // server cannot label (the request never reached it) or client-side
  // shaping of an uncoded server response.
  // - `unknown`: catch-all when the error has no resolvable code.
  // - `networkUnavailable`: the tRPC client never got past TCP/DNS.
  // - `validationFailed`: client-side reshaping of a raw Zod BAD_REQUEST
  // so the operator never sees the stringified issues array.
  // - `desktopSessionRequired`: Electron main-process session-gate
  //   rejections (SESSION_NOT_REGISTERED wrapped by IPC) mapped by the
  //   renderer; the embedded server never emits this code.
  const CLIENT_ONLY_KEYS = new Set<string>([
    'unknown',
    'networkUnavailable',
    'validationFailed',
    'desktopSessionRequired',
    'desktopRoleForbidden',
  ]);

  it('keeps client-only fallbacks in the bootstrap namespace', () => {
    for (const locale of ['en', 'es'] as const) {
      for (const key of CLIENT_ONLY_KEYS) {
        expect(localeServers[locale][manifest.defaultNamespace]?.[key]).toEqual(expect.any(String));
        for (const namespace of namespaces.slice(1)) {
          expect(localeServers[locale][namespace]?.[key]).toBeUndefined();
        }
      }
    }
  });

  it('has no orphan keys and preserves total cardinality across registered namespaces', () => {
    const allowed = new Set<string>([...CLIENT_ONLY_KEYS, ...codes]);
    const expected = codes.length + CLIENT_ONLY_KEYS.size;
    for (const locale of ['en', 'es'] as const) {
      const keys = namespaces.flatMap(namespace => Object.keys(localeServers[locale][namespace]!));
      const orphans = keys.filter(key => !allowed.has(key));
      expect({ locale, orphans }).toEqual({ locale, orphans: [] });
      expect(new Set(keys).size).toBe(keys.length);
      expect(keys).toHaveLength(expected);
    }
  });
});
