#!/usr/bin/env node
/**
 * Builds the Electron main + preload Vite artefacts without launching
 * Electron or packaging the app.
 *
 * Electron Forge owns the exact Vite config shape through
 * @electron-forge/plugin-vite. Calling `vite build --config ...`
 * directly misses the Forge-injected entry points and can build the
 * wrong target. This script runs only the Vite plugin production hooks, so E2E
 * smoke gets the same `.vite/build` and `.vite/preload` output that
 * Forge produces, without invoking native rebuilds, packagers, or publishers.
 *
 * @module scripts/build-electron-main
 */

import { Listr } from 'listr2';
import forgeConfig from '../apps/desktop/forge.config.js';
import { cp, mkdir, rm } from 'node:fs/promises';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..');
const desktopRoot = resolve(repoRoot, 'apps/desktop');
const mainOutput = resolve(desktopRoot, '.vite/build');
const migrationsSource = resolve(repoRoot, 'packages/server/src/db/migrations');
const migrationsOutput = resolve(mainOutput, 'migrations');

// Use the public plugin and its hook contract. Forge 8 intentionally stops
// exporting its internal config generator; resolving a private file would
// bypass that boundary and silently couple builds to unsupported internals.
const plugin = forgeConfig.plugins.find(candidate => candidate.name === 'vite');
if (!plugin) throw new Error('The desktop Forge config must provide its Vite plugin');
plugin.setDirectories(desktopRoot);
const prePackage = plugin.getHooks().prePackage;
const hooks = Array.isArray(prePackage) ? prePackage : [prePackage];
if (hooks.some(hook => typeof hook !== 'function')) {
  throw new Error('The Vite plugin must provide its production build hook');
}
await new Listr(
  hooks.map(hook => ({
    title: 'Building Electron main and preload with the Forge Vite plugin',
    // Forge binds task-aware hooks to a real Listr task; returned nested
    // tasks must execute, not merely resolve their task-list description.
    task: (_context, task) => hook.call(task, forgeConfig, desktopRoot),
  })),
  { concurrent: false, exitOnError: true, renderer: 'simple' }
).run();

await rm(migrationsOutput, { recursive: true, force: true });
await mkdir(dirname(migrationsOutput), { recursive: true });
await cp(migrationsSource, migrationsOutput, { recursive: true });
process.stdout.write(
  `[electron-main-build] Copied ${relative(repoRoot, migrationsSource)} -> ${relative(repoRoot, migrationsOutput)}\n`
);
