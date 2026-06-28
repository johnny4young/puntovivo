#!/usr/bin/env node
/**
 * Packaged-desktop smoke test (mirrors Lingua's smoke:desktop:packaged).
 *
 * Boots the PACKAGED Electron app and asserts it launches far enough to prove
 * the vite-externalized native modules (better-sqlite3, argon2) and their
 * runtime closure actually shipped in the bundle. This is the check that was
 * missing when the packaged app silently lacked node_modules and could never
 * require('better-sqlite3') — a regression component/unit tests cannot catch.
 *
 * Usage:
 *   node scripts/run-desktop-smoke.mjs --against-packaged <dir|.app>
 *
 * Success = the app process starts, emits "electron runtime detected", reaches
 * the embedded-server start, and logs NO native/module load failure
 * (MODULE_NOT_FOUND / dlopen / NODE_MODULE_VERSION). On an unsigned build with
 * no OS key store the DB open is gated behind the encryption-key step, so the
 * known "OS keychain is unavailable" message is treated as a tolerated stop
 * (the bundle + natives still loaded). A signed build with a key store boots
 * fully and the smoke additionally sees the server come up.
 *
 * @module scripts/run-desktop-smoke
 */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, rmSync, statSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';

const EXECUTABLE = 'puntovivo';
const APP_NAME = 'Puntovivo';
const TIMEOUT_MS = Number(process.env.PUNTOVIVO_SMOKE_TIMEOUT_MS) || 45_000;

const FATAL = [
  /Cannot find module/i,
  /MODULE_NOT_FOUND/,
  /ERR_DLOPEN_FAILED/,
  /NODE_MODULE_VERSION/,
  /dlopen\(/i,
  /was compiled against a different Node\.js version/i,
];
const LAUNCHED = /electron runtime detected/i;
const SERVER_ATTEMPT = /embedded server/i;
const SERVER_UP = /listening on|server (started|ready|listening)/i;
// Tolerated on builds without a provisioned OS key store (unsigned / CI):
const KEY_STORE_GATED =
  /keychain (is )?unavailable|key store|libsecret|gnome-keyring|DPAPI/i;

function fail(message) {
  console.error(`[desktop-smoke] FAIL: ${message}`);
  process.exit(1);
}

function findInput() {
  const idx = process.argv.indexOf('--against-packaged');
  if (idx === -1 || !process.argv[idx + 1]) {
    fail('pass --against-packaged <dir or .app>');
  }
  return path.resolve(process.argv[idx + 1]);
}

/** Resolve the launchable binary for the current platform under `input`. */
function resolveBinary(input) {
  if (!existsSync(input)) fail(`path does not exist: ${input}`);

  // macOS: a .app bundle (directly, or the app bundle found under input). forge
  // names it Puntovivo.app, electron-builder puntovivo.app, so match any .app
  // that carries our executable.
  if (process.platform === 'darwin') {
    const app = input.endsWith('.app')
      ? input
      : findUnder(input, (n) => n.endsWith('.app') && /puntovivo/i.test(n));
    if (app) {
      const bin = path.join(app, 'Contents', 'MacOS', EXECUTABLE);
      if (existsSync(bin)) return bin;
    }
    fail(`no *.app with Contents/MacOS/${EXECUTABLE} under ${input}`);
  }

  // Linux / Windows: the executable inside the packaged dir
  const exe = process.platform === 'win32' ? `${EXECUTABLE}.exe` : EXECUTABLE;
  if (statSync(input).isFile() && path.basename(input) === exe) return input;
  const found = findUnder(input, (n) => n === exe, /* wantFile */ true);
  if (found) return found;
  fail(`no ${exe} executable under ${input}`);
}

/** Shallow BFS for a dir (or file) whose basename matches, skipping into .app. */
function findUnder(root, match, wantFile = false) {
  const queue = [root];
  let depth = 0;
  while (queue.length && depth < 6) {
    const next = [];
    for (const dir of queue) {
      let entries;
      try {
        entries = readdirSync(dir, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const e of entries) {
        const full = path.join(dir, e.name);
        const isDir = e.isDirectory();
        if (match(e.name) && (wantFile ? e.isFile() : isDir)) return full;
        if (isDir && !e.name.endsWith('.app')) next.push(full);
      }
    }
    queue.length = 0;
    queue.push(...next);
    depth += 1;
  }
  return null;
}

/** Walk a dir (bounded) and report whether any *.node addon exists under it. */
function hasNodeAddon(dir) {
  if (!existsSync(dir)) return false;
  const queue = [dir];
  let depth = 0;
  while (queue.length && depth < 8) {
    const next = [];
    for (const d of queue) {
      let entries;
      try {
        entries = readdirSync(d, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const e of entries) {
        if (e.isFile() && e.name.endsWith('.node')) return true;
        if (e.isDirectory()) next.push(path.join(d, e.name));
      }
    }
    queue.length = 0;
    queue.push(...next);
    depth += 1;
  }
  return false;
}

/**
 * Definitive native-presence check (no display or OS key store needed): the
 * exact regression is plugin-vite stripping node_modules so the vite-external
 * natives never ship. Assert they are in app.asar and their .node is unpacked.
 */
function checkStructure(binary) {
  const resources =
    process.platform === 'darwin'
      ? path.join(path.dirname(path.dirname(binary)), 'Resources')
      : path.join(path.dirname(binary), 'resources');
  const asar = path.join(resources, 'app.asar');
  const unpacked = path.join(resources, 'app.asar.unpacked');
  if (!existsSync(asar)) fail(`app.asar not found at ${asar}`);

  const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
  const asarCli = path.join(repoRoot, 'node_modules', '@electron', 'asar', 'bin', 'asar.js');
  const listing = spawnSync(process.execPath, [asarCli, 'list', asar], {
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024, // the asar listing easily exceeds the 1 MB default
  });
  if (listing.status !== 0) fail(`could not list ${asar}: ${listing.stderr}`);
  for (const mod of ['better-sqlite3', 'argon2', 'bindings']) {
    if (!listing.stdout.includes(`/node_modules/${mod}/`)) {
      fail(`app.asar is missing node_modules/${mod} (vite-externalized native not bundled)`);
    }
  }
  if (!hasNodeAddon(path.join(unpacked, 'node_modules', 'better-sqlite3'))) {
    fail('better_sqlite3.node was not unpacked into app.asar.unpacked');
  }
  console.log(
    '[desktop-smoke] structure OK: better-sqlite3 + argon2 + bindings in app.asar, .node unpacked'
  );
}

const input = findInput();
const binary = resolveBinary(input);
checkStructure(binary);

if (process.argv.includes('--structure-only')) {
  console.log('[desktop-smoke] PASS (structure-only): natives are packaged');
  process.exit(0);
}

console.log(`[desktop-smoke] launching ${binary}`);

const userDataDir = mkdtempSync(path.join(os.tmpdir(), 'puntovivo-smoke-'));
const child = spawn(binary, [`--user-data-dir=${userDataDir}`], {
  env: { ...process.env, ELECTRON_ENABLE_LOGGING: '1', ELECTRON_DISABLE_GPU: '1' },
  stdio: ['ignore', 'pipe', 'pipe'],
});

let output = '';
const seen = { launched: false, serverAttempt: false, serverUp: false, keyGated: false };

function scan(chunk) {
  output += chunk;
  if (LAUNCHED.test(chunk)) seen.launched = true;
  if (SERVER_ATTEMPT.test(chunk)) seen.serverAttempt = true;
  if (SERVER_UP.test(chunk)) seen.serverUp = true;
  if (KEY_STORE_GATED.test(chunk)) seen.keyGated = true;
  for (const re of FATAL) {
    if (re.test(chunk)) {
      finish(`native/module load failure: ${re}`);
      return;
    }
  }
  // Enough signal to call it: launched + (server up OR boot reached the key step)
  if (seen.launched && (seen.serverUp || (seen.serverAttempt && seen.keyGated))) {
    finish(null);
  }
}

child.stdout.on('data', (d) => scan(d.toString()));
child.stderr.on('data', (d) => scan(d.toString()));

const timer = setTimeout(() => finish('timed out before the app reached a boot milestone'), TIMEOUT_MS);

let done = false;
function finish(error) {
  if (done) return;
  done = true;
  clearTimeout(timer);
  try {
    process.kill(-child.pid, 'SIGTERM');
  } catch {
    child.kill('SIGTERM');
  }
  rmSync(userDataDir, { recursive: true, force: true });

  if (error) {
    console.error('[desktop-smoke] --- captured output (tail) ---');
    console.error(output.split('\n').slice(-25).join('\n'));
    fail(error);
  }
  const mode = seen.serverUp ? 'server up' : 'boot reached key step (no OS key store — unsigned build)';
  console.log(`[desktop-smoke] PASS: app launched, natives loaded, ${mode}`);
  process.exit(0);
}

child.on('error', (err) => finish(`failed to spawn: ${err.message}`));
child.on('exit', (code, signal) => {
  if (done) return;
  // Process exited before a milestone — only OK if it never errored AND we at
  // least launched + reached the key step.
  if (seen.launched && seen.serverAttempt && seen.keyGated) {
    finish(null);
  } else {
    finish(`app exited early (code=${code} signal=${signal}) before a boot milestone`);
  }
});
