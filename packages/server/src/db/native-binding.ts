/**
 * Dev-runtime selection of the better-sqlite3 native addon.
 *
 * Electron and standalone Node load different ABI builds of the addon
 * (MODULE_VERSION 146 vs 137). `scripts/ensure-native-runtime.mjs` compiles
 * each one ONCE and caches both under
 * `node_modules/.cache/puntovivo/native-binaries/`, historically swapping the
 * active copy at `better-sqlite3/build/Release/better_sqlite3.node` — a design
 * that broke with ERR_DLOPEN_FAILED every time something rebuilt the addon
 * behind the state marker's back (a desktop boot followed by vitest / seed:dev
 * / dev:server, or an electron-forge package run).
 *
 * This module ends the swap dependency for every NODE-runtime entry point that
 * goes through `initDatabase`: it points the Database constructor's
 * `nativeBinding` option straight at the cached Node-ABI artifact, so the
 * on-disk default copy can stay on whichever ABI the desktop needs.
 *
 * Deliberately scoped to plain Node:
 * - Under Electron (`process.versions.electron`) it returns undefined — the
 *   desktop preflight (`ensure-native-runtime electron`) owns the on-disk
 *   default, and a packaged build must keep resolving its own rebuilt binary.
 * - Inside the desktop's CJS bundle `import.meta.url` is undefined (see
 *   `getDefaultMigrationsFolder` in db/index.ts); the guard below keeps
 *   `createRequire` untouched there.
 * - Any resolution or IO failure falls back to undefined → better-sqlite3's
 *   default lookup, i.e. exactly the pre-existing behavior.
 *
 * The cache filename replicates `getDesiredKey` + `getCachedBinaryPath` in
 * `scripts/ensure-native-runtime.mjs`. A drift between the two yields a cache
 * MISS (undefined → default lookup), never a wrong binary: the key embeds the
 * Node version, ABI, platform, arch and the addon package name@version.
 */

import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, sep } from 'node:path';

/**
 * Mirror of the cache-key sanitizer in scripts/ensure-native-runtime.mjs:
 * collapse every run of characters outside [a-zA-Z0-9._-] into one underscore
 * (so `node:v24.15.0:137` and `electron:^42.6.2` become `node_v24.15.0_137`
 * and `electron_42.6.2`).
 */
export function sanitizeRuntimeKey(key: string): string {
  return key.replaceAll(/[^a-zA-Z0-9._-]+/g, '_');
}

/**
 * Assemble the Node-runtime cache key exactly like
 * `getDesiredKey('node')` does in scripts/ensure-native-runtime.mjs.
 */
export function buildNodeRuntimeKey(parts: {
  nodeVersion: string;
  modulesAbi: string;
  platform: string;
  arch: string;
  addonNameAndVersion: string;
}): string {
  return [
    'node',
    parts.nodeVersion,
    parts.modulesAbi,
    parts.platform,
    parts.arch,
    parts.addonNameAndVersion,
  ].join(':');
}

/**
 * Resolve the cached Node-ABI better-sqlite3 addon for the CURRENT process,
 * or undefined when it does not apply (Electron, bundled CJS, missing cache,
 * any resolution failure).
 */
export function resolveCachedNodeBinding(): string | undefined {
  try {
    if (process.versions.electron) {
      return undefined;
    }
    if (typeof import.meta.url !== 'string' || import.meta.url.length === 0) {
      return undefined;
    }

    const require = createRequire(import.meta.url);
    const packageJsonPath = require.resolve('better-sqlite3/package.json');

    // The resolved path may run through pnpm's `.pnpm` store; the cache lives
    // under the OUTERMOST node_modules, so cut at the first marker.
    const marker = `${sep}node_modules${sep}`;
    const markerIndex = packageJsonPath.indexOf(marker);
    if (markerIndex === -1) {
      return undefined;
    }
    const nodeModulesDir = packageJsonPath.slice(0, markerIndex + marker.length - 1);

    const addonPackage = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as {
      name: string;
      version: string;
    };

    const runtimeKey = buildNodeRuntimeKey({
      nodeVersion: process.version,
      modulesAbi: process.versions.modules,
      platform: process.platform,
      arch: process.arch,
      addonNameAndVersion: `${addonPackage.name}@${addonPackage.version}`,
    });

    const candidate = join(
      nodeModulesDir,
      '.cache',
      'puntovivo',
      'native-binaries',
      `${sanitizeRuntimeKey(runtimeKey)}.node`
    );

    return existsSync(candidate) ? candidate : undefined;
  } catch {
    return undefined;
  }
}
