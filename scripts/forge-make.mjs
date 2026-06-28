#!/usr/bin/env node
/**
 * Runs `electron-forge make` through the programmatic API while holding a
 * no-op interval that keeps the Node event loop alive, then forces an exit.
 *
 * Why this exists (non-obvious CI-only failure):
 * On the GitHub Actions runners the Node event loop momentarily drains while
 * @electron/packager is mid-copy. Node then fires its `exit` event, and
 * @electron-forge/plugin-vite's `process.on('exit')` cleanup handler tears the
 * vite watchers/servers down and the in-flight packaging promise is abandoned.
 * electron-forge reports success (exit 0) yet writes no `out/` at all, so the
 * makers have nothing to zip. Locally the loop never drains at that instant, so
 * the `electron-forge make` CLI works there and the bug is invisible.
 *
 * Two guards make it deterministic:
 *  - a setInterval keeps the loop alive until api.make() resolves, so packaging
 *    is never abandoned mid-flight;
 *  - process.exit() at the end forces termination once make resolves, so a
 *    lingering vite/esbuild handle can never wedge the step (the keep-alive
 *    would otherwise hold the process open forever).
 *
 * Every forge step is preserved (vite main/preload build, native rebuild, asar,
 * fuses, MakerZIP). The CLI cannot do either guard because the premature exit
 * happens inside its own process.
 *
 * Root cause traced via DEBUG=electron-forge:* on the release runners:
 *   electron-forge:packager packaging with options { ... }
 *   electron-forge:plugin:vite handling process exit with: { cleanup: true }
 *
 * @module scripts/forge-make
 */
import { api } from '@electron-forge/core';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const dir = path.resolve(here, '..', 'apps', 'desktop');

// forge resolves the plugin-vite config paths (vite.main.config.ts, etc.) and
// the packagerConfig.extraResource entries against process.cwd(), not against
// `dir`, so run from the desktop package regardless of the caller's cwd.
process.chdir(dir);

const start = Date.now();
const log = (message) =>
  process.stdout.write(
    `[forge-make +${Math.round((Date.now() - start) / 1000)}s] ${message}\n`
  );

const keepAlive = setInterval(() => {}, 250);
let exitCode = 0;
try {
  log('starting api.make');
  const results = await api.make({ dir, interactive: false });
  const artifacts = results.flatMap((result) => result.artifacts ?? []);
  log(`api.make resolved with ${artifacts.length} artifact(s):`);
  for (const artifact of artifacts) log(`  ${path.relative(dir, artifact)}`);
  if (artifacts.length === 0) {
    log('ERROR: no artifacts produced');
    exitCode = 1;
  }
} catch (error) {
  log(`ERROR: api.make threw: ${error?.stack ?? error}`);
  exitCode = 1;
} finally {
  clearInterval(keepAlive);
}
log(`exiting with code ${exitCode}`);
// Force termination: make has resolved, so any vite/esbuild handle still open
// must not keep the step running. Without this the keep-alive could wedge it.
process.exit(exitCode);
