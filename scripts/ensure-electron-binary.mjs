#!/usr/bin/env node
// Guarantees the Electron native binary is installed.
//
// The `electron` npm package relies on a `postinstall` hook that downloads
// its platform-specific runtime (Electron.app on macOS, electron.exe on
// Windows, electron on Linux) from GitHub Releases. Under flaky networks,
// aggressive caches, or with npm's default behaviour of treating
// postinstall failures as soft warnings, the download can fail silently
// during `pnpm install`. The package stays on disk but `dist/` and
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

import { existsSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
// ENG-072 — resolve electron via Node module resolution starting from the
// desktop workspace so the script works whether npm hoists `electron` to
// `node_modules/electron` (single-package install) or keeps it nested under
// `apps/desktop/node_modules/electron` (workspace dedup).
const requireFromDesktop = createRequire(join(repoRoot, 'apps/desktop/package.json'));
const electronDir = dirname(requireFromDesktop.resolve('electron/package.json'));
const pathTxt = join(electronDir, 'path.txt');
const installJs = join(electronDir, 'install.js');
const distDir = join(electronDir, 'dist');
const electronApp = join(distDir, 'Electron.app');

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

function codeSignatureIssue() {
  if (process.platform !== 'darwin' || !existsSync(electronApp)) {
    return null;
  }

  const result = spawnSync(
    'codesign',
    ['--verify', '--deep', '--strict', '--verbose=2', electronApp],
    { encoding: 'utf8' }
  );

  if (result.status === 0) {
    return null;
  }

  return (
    result.stderr.trim() ||
    result.stdout.trim() ||
    'codesign verification failed'
  );
}

function healthIssue() {
  const exe = executablePath();
  if (exe === null || !existsSync(exe)) {
    return 'Electron runtime missing (no dist/ + path.txt)';
  }

  const signatureIssue = codeSignatureIssue();
  if (signatureIssue) {
    return `Electron runtime has an invalid macOS code signature: ${signatureIssue}`;
  }

  return null;
}

function runInstall() {
  log('running node_modules/electron/install.js to fetch the runtime');
  // ENG-072 / Electron 42 — the `ELECTRON_SKIP_BINARY_DOWNLOAD` env var was
  // removed upstream when the binary download moved out of `postinstall` and
  // became lazy on first execution. We just inherit env now.
  const result = spawnSync(process.execPath, [installJs], {
    cwd: electronDir,
    stdio: 'inherit',
  });

  if (result.status !== 0) {
    log('install.js exited with a non-zero status');
    return false;
  }

  return true;
}

function runAdHocCodesign() {
  if (process.platform !== 'darwin' || !existsSync(electronApp)) {
    return true;
  }

  log('applying local ad-hoc codesign to Electron.app');
  const result = spawnSync(
    'codesign',
    ['--force', '--deep', '--sign', '-', electronApp],
    {
      cwd: electronDir,
      stdio: 'inherit',
    }
  );

  if (result.status !== 0) {
    log('codesign repair exited with a non-zero status');
    return false;
  }

  return true;
}

if (!existsSync(electronDir)) {
  log('node_modules/electron is missing — run `pnpm install` first');
  process.exit(1);
}

const initialIssue = healthIssue();
if (!initialIssue) {
  // Fast path: nothing to do.
  process.exit(0);
}

log(`${initialIssue}; attempting auto-repair`);

if (!existsSync(installJs)) {
  log('node_modules/electron/install.js not found — run `pnpm install` to reinstall the package');
  process.exit(1);
}

if (existsSync(distDir)) {
  rmSync(distDir, { recursive: true, force: true });
}
if (existsSync(pathTxt)) {
  rmSync(pathTxt, { force: true });
}

if (!runInstall()) {
  log('auto-repair failed. Try:');
  log('  1) rm -rf node_modules/electron && pnpm install');
  log('  2) if the download keeps failing, clear the Electron cache:');
  log('       rm -rf "$HOME/Library/Caches/electron"   # macOS');
  log('       rm -rf "$HOME/.cache/electron"           # Linux');
  log('       rm -rf "$LOCALAPPDATA\\electron\\Cache"  # Windows');
  log('     then re-run `pnpm install`');
  process.exit(1);
}

if (healthIssue() && !runAdHocCodesign()) {
  process.exit(1);
}

if (healthIssue()) {
  log('auto-repair failed. Try:');
  log('  1) rm -rf node_modules/electron && pnpm install');
  log('  2) if the download keeps failing, clear the Electron cache:');
  log('       rm -rf "$HOME/Library/Caches/electron"   # macOS');
  log('       rm -rf "$HOME/.cache/electron"           # Linux');
  log('       rm -rf "$LOCALAPPDATA\\electron\\Cache"  # Windows');
  log('     then re-run `pnpm install`');
  process.exit(1);
}

log('Electron runtime ready');
