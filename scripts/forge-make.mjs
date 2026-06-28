#!/usr/bin/env node
/**
 * Runs `electron-forge make` through the programmatic API while holding a
 * no-op interval that keeps the Node event loop alive.
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
 * The fix is environment-agnostic: a setInterval keeps the loop alive until
 * api.make() resolves, defeating the race while preserving every forge step
 * (vite main/preload build, native rebuild, asar, fuses, MakerZIP). The CLI
 * cannot do this because the premature exit happens inside its own process.
 *
 * Root cause traced via DEBUG=electron-forge:* on the release runners:
 *   electron-forge:packager packaging with options { ... }
 *   electron-forge:packager targets: [ { platform: 'linux', arch: 'x64' } ]
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

const keepAlive = setInterval(() => {}, 250);
try {
  const results = await api.make({ dir, interactive: false });
  const artifacts = results.flatMap((result) => result.artifacts ?? []);
  process.stdout.write(`[forge-make] produced ${artifacts.length} artifact(s):\n`);
  for (const artifact of artifacts) {
    process.stdout.write(`  ${path.relative(dir, artifact)}\n`);
  }
  if (artifacts.length === 0) {
    process.stderr.write('[forge-make] no artifacts were produced\n');
    process.exitCode = 1;
  }
} finally {
  clearInterval(keepAlive);
}
