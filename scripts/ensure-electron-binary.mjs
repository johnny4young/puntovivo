#!/usr/bin/env node
// Guarantees the Electron native binary is installed.
//
// The `electron` npm package relies on a `postinstall` hook that downloads
// its platform-specific runtime (Electron.app on macOS, electron.exe on
// Windows, electron on Linux) from GitHub Releases. Under flaky networks,
// aggressive caches, or with npm's default behaviour of treating
// postinstall failures as soft warnings, the download can fail silently
// during `npm install`. The package stays on disk but `dist/` and
// `path.txt` are missing — so the next `require('electron')` throws
//
//     Error: Electron failed to install correctly, please delete
//     node_modules/electron and try installing again
//
// …and `electron-forge start` crashes at "Locating application".
//
// This script is the last-line defence: before we hand the process to
// electron-forge, it verifies that `path.txt` + the executable exist, and
// re-runs Electron's own `install.js` once if anything is missing. It
// exits non-zero with an actionable message if the repair itself fails.

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const electronDir = join(repoRoot, 'node_modules', 'electron');
const pathTxt = join(electronDir, 'path.txt');
const installJs = join(electronDir, 'install.js');

function log(line) {
  // Keep one stable prefix so operators can grep logs.
  process.stdout.write(`[ensure-electron-binary] ${line}\n`);
}

function executablePath() {
  if (!existsSync(pathTxt)) {
    return null;
  }

  const relative = readFileSync(pathTxt, 'utf8').trim();
  if (!relative) {
    return null;
  }

  return join(electronDir, 'dist', relative);
}

function isHealthy() {
  const exe = executablePath();
  return exe !== null && existsSync(exe);
}

function runInstall() {
  log('running node_modules/electron/install.js to fetch the runtime');
  const result = spawnSync(process.execPath, [installJs], {
    cwd: electronDir,
    stdio: 'inherit',
    env: {
      ...process.env,
      // Drop any SKIP flag a CI job might have set upstream, so the repair
      // attempt actually downloads when invoked at dev-start time.
      ELECTRON_SKIP_BINARY_DOWNLOAD: '',
    },
  });

  if (result.status !== 0) {
    log('install.js exited with a non-zero status');
    return false;
  }

  return true;
}

if (!existsSync(electronDir)) {
  log('node_modules/electron is missing — run `npm install` first');
  process.exit(1);
}

if (isHealthy()) {
  // Fast path: nothing to do.
  process.exit(0);
}

log('Electron runtime missing (no dist/ + path.txt); attempting auto-repair');

if (!existsSync(installJs)) {
  log('node_modules/electron/install.js not found — run `npm install` to reinstall the package');
  process.exit(1);
}

if (!runInstall() || !isHealthy()) {
  log('auto-repair failed. Try:');
  log('  1) rm -rf node_modules/electron && npm install');
  log('  2) if the download keeps failing, clear the Electron cache:');
  log('       rm -rf "$HOME/Library/Caches/electron"   # macOS');
  log('       rm -rf "$HOME/.cache/electron"           # Linux');
  log('       rm -rf "$LOCALAPPDATA\\electron\\Cache"  # Windows');
  log('     then re-run `npm install`');
  process.exit(1);
}

log('Electron runtime ready');
