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
import { randomBytes } from 'node:crypto';
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import { resolvePackagedBinary } from './lib/packaged-binary.mjs';

const APP_NAME = 'Puntovivo';
const TIMEOUT_MS = Number(process.env.PUNTOVIVO_SMOKE_TIMEOUT_MS) || 45_000;
const RENDERER_TIMEOUT_MS = Number(process.env.PUNTOVIVO_RENDERER_SMOKE_TIMEOUT_MS) || 90_000;
const VERIFY_RENDERER = process.argv.includes('--renderer');

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
const KEY_STORE_GATED = /keychain (is )?unavailable|key store|libsecret|gnome-keyring|DPAPI/i;

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

async function reserveLoopbackPort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : null;
      server.close(error => {
        if (error) reject(error);
        else if (port === null) reject(new Error('could not reserve a renderer smoke port'));
        else resolve(port);
      });
    });
  });
}

function redactSensitiveOutput(value) {
  return value.replace(/(\[Database\] Password:\s+)\S+/g, '$1[Redacted]');
}

/** Shallow BFS for a dir (or file) whose basename matches, skipping into .app. */
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

  // fileURLToPath (not new URL(...).pathname) so the Windows drive letter is
  // handled - .pathname yields /D:/... which resolves to a bogus D:\D:\... path.
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const asarCli = path.join(repoRoot, 'node_modules', '@electron', 'asar', 'bin', 'asar.js');
  const listing = spawnSync(process.execPath, [asarCli, 'list', asar], {
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024, // the asar listing easily exceeds the 1 MB default
  });
  if (listing.status !== 0) fail(`could not list ${asar}: ${listing.stderr}`);
  // asar list prints OS-native separators, so normalize backslashes before the
  // check - on Windows it emits node_modules\better-sqlite3\... which a
  // forward-slash substring test would miss (false "native not bundled").
  const entries = listing.stdout.replace(/\\/g, '/');
  for (const mod of ['better-sqlite3', 'argon2', 'bindings']) {
    if (!entries.includes(`node_modules/${mod}/`)) {
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
let binary;
try {
  binary = resolvePackagedBinary(input);
} catch (error) {
  fail(error.message);
}
checkStructure(binary);

if (process.argv.includes('--structure-only')) {
  console.log('[desktop-smoke] PASS (structure-only): natives are packaged');
  process.exit(0);
}

console.log(`[desktop-smoke] launching ${binary}`);

const userDataDir = mkdtempSync(path.join(os.tmpdir(), 'puntovivo-smoke-'));
const rendererPort = VERIFY_RENDERER ? await reserveLoopbackPort() : null;
const childArgs = [`--user-data-dir=${userDataDir}`];
if (rendererPort !== null) {
  childArgs.push(`--remote-debugging-port=${rendererPort}`, '--remote-debugging-address=127.0.0.1');
  // Chromium initializes its own cookie/password crypto before app.whenReady.
  // Ad-hoc macOS signatures can block on the global Chrome Safe Storage item,
  // and headless Linux runners may not have libsecret. These switches isolate
  // only the temporary renderer profile; the runtime-only smoke uses defaults.
  if (process.platform === 'darwin') childArgs.push('--use-mock-keychain');
  if (process.platform === 'linux') childArgs.push('--password-store=basic');
}
const child = spawn(binary, childArgs, {
  env: {
    ...process.env,
    ELECTRON_ENABLE_LOGGING: '1',
    ELECTRON_DISABLE_GPU: '1',
    ...(VERIFY_RENDERER
      ? {
          PUNTOVIVO_E2E: '1',
          // Isolate UI verification from OS key-store prompts. A separate
          // runtime-only smoke keeps exercising normal safeStorage startup.
          PUNTOVIVO_DB_KEY: randomBytes(32).toString('hex'),
        }
      : {}),
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});

let output = '';
let firstRunAdminPassword = null;
const seen = { launched: false, serverAttempt: false, serverUp: false, keyGated: false };
let done = false;
let completed = false;

function scan(chunk) {
  output += chunk;
  const passwordMatch = /\[Database\] Password:\s+([^\s]+)/.exec(output);
  if (passwordMatch) firstRunAdminPassword = passwordMatch[1];
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
  // Enough signal to call the runtime-only smoke. Renderer mode additionally
  // proves that the packaged web assets + preload bridge load and a first-run
  // admin session reaches a data-backed route.
  if (seen.launched && (seen.serverUp || (seen.serverAttempt && seen.keyGated))) {
    if (!VERIFY_RENDERER) {
      finish(null);
    } else if (seen.keyGated) {
      finish('renderer smoke requires an available OS key store');
    }
  }
}

async function waitForRendererEndpoint(endpoint) {
  const deadline = Date.now() + RENDERER_TIMEOUT_MS;
  while (Date.now() < deadline) {
    try {
      // Chromium can accept the TCP connection before its DevTools HTTP
      // handler is ready. Bound each probe so an early half-ready socket does
      // not consume the entire renderer timeout and miss the CDP grace period.
      const response = await fetch(`${endpoint}/json/version`, {
        signal: AbortSignal.timeout(500),
      });
      if (response.ok) return;
    } catch {
      // Electron has not opened the DevTools endpoint yet.
    }
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  throw new Error('timed out waiting for the packaged renderer DevTools endpoint');
}

async function waitForFirstRunPassword() {
  const deadline = Date.now() + 15_000;
  while (!firstRunAdminPassword && Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  if (!firstRunAdminPassword) {
    throw new Error('packaged first-run admin credential was not emitted');
  }
  return firstRunAdminPassword;
}

async function verifyPackagedRenderer() {
  const endpoint = `http://127.0.0.1:${rendererPort}`;
  let browser;
  try {
    await waitForRendererEndpoint(endpoint);
    browser = await chromium.connectOverCDP(endpoint);
    const context = browser.contexts()[0];
    if (!context) throw new Error('packaged renderer did not expose a browser context');
    const page =
      context.pages().find(candidate => candidate.url().startsWith('puntovivo-app:')) ??
      context.pages()[0] ??
      (await context.waitForEvent('page', { timeout: RENDERER_TIMEOUT_MS }));

    await page.getByLabel(/email/i).waitFor({
      state: 'visible',
      timeout: RENDERER_TIMEOUT_MS,
    });
    const bridge = await page.evaluate(async () => ({
      electron: Boolean(window.electron),
      api: Boolean(window.api),
      serverUrl: await window.electron?.getServerUrl?.(),
    }));
    if (
      !bridge.electron ||
      !bridge.api ||
      !/^http:\/\/127\.0\.0\.1:\d+$/.test(bridge.serverUrl ?? '')
    ) {
      throw new Error(
        'packaged preload bridge is missing or returned an invalid embedded-server URL'
      );
    }

    const password = await waitForFirstRunPassword();
    await page.getByLabel(/email/i).fill('admin@localhost');
    await page.getByRole('textbox', { name: /password/i }).fill(password);
    await page
      .getByRole('button', { name: /enter workspace|entrar al espacio de trabajo/i })
      .click();
    await page
      .waitForFunction(
        () =>
          window.location.hash.includes('/dashboard') || window.location.hash.includes('/company'),
        undefined,
        { timeout: 30_000 }
      )
      .catch(error => {
        throw new Error(`post-login route stayed at ${page.url()}: ${error.message}`);
      });
    if (page.url().includes('/company')) {
      const readinessTab = page.getByTestId('company-tab-readiness');
      await readinessTab.waitFor({ state: 'visible', timeout: 30_000 });
      if ((await readinessTab.getAttribute('aria-current')) !== 'page') {
        throw new Error('first-run company landing did not activate the readiness tab');
      }
    } else {
      await page
        .getByText(/today's sales|ventas de hoy/i)
        .first()
        .waitFor({ state: 'visible', timeout: 30_000 });
    }

    console.log(
      '[desktop-smoke] renderer OK: preload bridge, first-run login, and data-backed landing'
    );
    finish(null);
  } catch (error) {
    finish(`packaged renderer journey failed: ${error.message}`);
  } finally {
    // Disconnecting is best-effort; finish() owns process teardown.
    await browser?.close().catch(() => {});
  }
}

child.stdout.on('data', d => scan(d.toString()));
child.stderr.on('data', d => scan(d.toString()));

const timer = setTimeout(
  () => finish('timed out before the app reached a boot milestone'),
  VERIFY_RENDERER ? RENDERER_TIMEOUT_MS : TIMEOUT_MS
);

// Connect as soon as Chromium exposes its loopback endpoint. Hardened packaged
// builds terminate an unclaimed remote-debugging endpoint after a short grace
// period, which can be earlier than first-boot DB migrations + server startup.
// Holding the CDP connection open lets the journey wait truthfully for the
// BrowserWindow instead of racing a 15-second endpoint shutdown.
if (VERIFY_RENDERER) {
  void verifyPackagedRenderer();
}

function removeUserDataBestEffort() {
  try {
    rmSync(userDataDir, {
      recursive: true,
      force: true,
      maxRetries: 10,
      retryDelay: 100,
    });
  } catch (error) {
    // Windows can keep Chromium profile files locked briefly after the parent
    // exits. Cleanup hygiene must not turn a valid runtime smoke into a false
    // failure; the runner will also reclaim its temporary directory.
    console.warn(
      `[desktop-smoke] WARN: could not remove temporary profile ${userDataDir}: ${error.message}`
    );
  }
}

function complete(error) {
  if (completed) return;
  completed = true;
  removeUserDataBestEffort();
  if (error) {
    console.error('[desktop-smoke] --- captured output (tail) ---');
    console.error(redactSensitiveOutput(output).split('\n').slice(-25).join('\n'));
    console.error(`[desktop-smoke] FAIL: ${error}`);
    process.exit(1);
  }
  const mode = VERIFY_RENDERER
    ? 'renderer journey completed'
    : seen.serverUp
      ? 'server up'
      : 'boot reached key step (no OS key store — unsigned build)';
  console.log(`[desktop-smoke] PASS: app launched, natives loaded, ${mode}`);
  process.exit(0);
}

function finish(error) {
  if (done) return;
  done = true;
  clearTimeout(timer);

  if (child.exitCode !== null || child.signalCode !== null) {
    complete(error);
    return;
  }

  // Wait for Electron to release its profile before cleanup. This matters on
  // Windows, where deleting the directory immediately after child.kill() can
  // throw EPERM while Chromium helpers still hold files open.
  const forceTimer = setTimeout(() => {
    child.kill('SIGKILL');
    const cleanupTimer = setTimeout(() => complete(error), 1_000);
    cleanupTimer.unref();
  }, 5_000);
  forceTimer.unref();
  child.once('exit', () => {
    clearTimeout(forceTimer);
    complete(error);
  });

  try {
    if (!child.kill('SIGTERM')) complete(error);
  } catch {
    complete(error);
  }
}

child.on('error', err => finish(`failed to spawn: ${err.message}`));
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
