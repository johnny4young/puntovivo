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
 * (MODULE_NOT_FOUND / dlopen / NODE_MODULE_VERSION). The smoke injects an
 * ephemeral SQLCipher key so it never reads or writes the operator's OS
 * keychain; safeStorage behavior is covered by dedicated hermetic tests.
 *
 * @module scripts/run-desktop-smoke
 */
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { listPackage } from '@electron/asar';
import { chromium } from '@playwright/test';
import {
  classifyElectronStderrLine,
  classifyElectronStdoutLine,
} from './electron-process-log-policy.mjs';
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

  // Use @electron/asar's public API rather than its CLI file layout. The v4
  // package renamed bin/asar.js to bin/asar.mjs; importing listPackage keeps
  // this smoke stable across that packaging-only change.
  const entries = listPackage(asar, { isPack: false }).join('\n').replace(/\\/g, '/');
  // SQLite v13 resolves its target-specific Node-API prebuild directly and no
  // longer depends on the legacy `bindings` package. Requiring that obsolete
  // transitive dependency here would reject a healthy v13 package.
  for (const mod of ['better-sqlite3', 'argon2']) {
    if (!entries.includes(`node_modules/${mod}/`)) {
      fail(`app.asar is missing node_modules/${mod} (vite-externalized native not bundled)`);
    }
  }
  if (!hasNodeAddon(path.join(unpacked, 'node_modules', 'better-sqlite3'))) {
    fail('better_sqlite3.node was not unpacked into app.asar.unpacked');
  }
  console.log('[desktop-smoke] structure OK: better-sqlite3 + argon2 in app.asar, .node unpacked');
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
const serverPort = await reserveLoopbackPort();
const rendererPort = VERIFY_RENDERER ? await reserveLoopbackPort() : null;
const childArgs = [`--user-data-dir=${userDataDir}`];
// Chromium can initialize password storage even when the application injects
// its own temporary DB key. Keep the smoke isolated from host keychain prompts.
if (process.platform === 'darwin') childArgs.push('--use-mock-keychain');
if (process.platform === 'linux') {
  childArgs.push('--password-store=basic', '--disable-gpu', '--disable-software-rasterizer');
}
if (rendererPort !== null) {
  childArgs.push(`--remote-debugging-port=${rendererPort}`, '--remote-debugging-address=127.0.0.1');
}
const child = spawn(binary, childArgs, {
  env: {
    ...process.env,
    ELECTRON_ENABLE_LOGGING: '1',
    ELECTRON_DISABLE_GPU: '1',
    // This flag is the packaged-runtime authority for the ephemeral key below.
    // Keep it enabled in BOTH smoke modes: without it, packaged builds correctly
    // ignore PUNTOVIVO_DB_KEY and reach for the operator's real OS keychain.
    PUNTOVIVO_E2E: '1',
    // Avoid colliding with a local dev stack or a parallel smoke on port 8090.
    PUNTOVIVO_BIND_PORT: String(serverPort),
    // Never let a validation build access the operator's real safeStorage
    // envelope. A fresh random key still proves SQLCipher + native startup.
    PUNTOVIVO_DB_KEY: randomBytes(32).toString('hex'),
    // Update transport has separate contract tests. A --dir validation bundle
    // intentionally has no app-update.yml and must not perform network I/O.
    AUTO_UPDATE: 'false',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});

let output = '';
let stdoutOutput = '';
let stderrOutput = '';
let firstRunAdminPassword = null;
const seen = { launched: false, serverAttempt: false, serverUp: false };
let done = false;
let completed = false;

function scan(chunk) {
  output += chunk;
  const passwordMatch = /\[Database\] Password:\s+([^\s]+)/.exec(output);
  if (passwordMatch) firstRunAdminPassword = passwordMatch[1];
  if (LAUNCHED.test(chunk)) seen.launched = true;
  if (SERVER_ATTEMPT.test(chunk)) seen.serverAttempt = true;
  if (SERVER_UP.test(chunk)) seen.serverUp = true;
  for (const re of FATAL) {
    if (re.test(chunk)) {
      finish(`native/module load failure: ${re}`);
      return;
    }
  }
  // Enough signal to call the runtime-only smoke. Renderer mode additionally
  // proves that the packaged web assets + preload bridge load and a first-run
  // admin session reaches a data-backed route.
  if (seen.launched && seen.serverUp) {
    if (!VERIFY_RENDERER) {
      finish(null);
    }
  }
}

async function waitForRendererReadyTarget(endpoint) {
  const deadline = Date.now() + RENDERER_TIMEOUT_MS;
  while (Date.now() < deadline) {
    try {
      // The DevTools port becomes reachable before Electron finishes
      // initializing the sandboxed preload. Attaching during that gap can
      // produce binding.startupData=null in Electron's sandbox bundle even
      // though the real application later loads. Wait for the first-run route
      // and title so CDP observes a stable renderer instead of creating that
      // false, intermittent failure.
      const response = await fetch(`${endpoint}/json/list`, {
        signal: AbortSignal.timeout(500),
      });
      if (response.ok) {
        const targets = await response.json();
        if (
          Array.isArray(targets) &&
          targets.some(
            target =>
              target?.type === 'page' &&
              typeof target.url === 'string' &&
              target.url.startsWith('puntovivo-app:') &&
              target.url.includes('#/login') &&
              typeof target.title === 'string' &&
              target.title.length > 0
          )
        ) {
          return;
        }
      }
    } catch {
      // Electron has not exposed a fully initialized renderer yet.
    }
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  throw new Error('timed out waiting for the packaged renderer to finish initialization');
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
  let rendererError = null;
  let page = null;
  try {
    await waitForRendererReadyTarget(endpoint);
    const browser = await chromium.connectOverCDP(endpoint);
    const context = browser.contexts()[0];
    if (!context) throw new Error('packaged renderer did not expose a browser context');
    page =
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
  } catch (error) {
    rendererError = `packaged renderer journey failed: ${error.message}`;
  }

  // Playwright exposes no public disconnect operation for a Browser returned
  // by connectOverCDP(). Browser.close() is NOT a connection-only cleanup: it
  // sends Browser.close to the remote Electron instance. On headless Linux
  // that destroys the renderer surface while its GPU service is still
  // publishing frames, producing SharedImageManager and PutImage Drawable
  // errors after an otherwise successful journey. macOS and Windows need the
  // test-only preload IPC so app.quit() drains native lifecycle state without
  // a signal race. X11 is the inverse: app.quit() destroys the renderer while
  // its final PutImage is in flight, whereas the owned-process SIGTERM path
  // exits cleanly. Select exactly one shutdown authority per platform; child
  // exit then closes the CDP transport without a second shutdown.
  if (page && process.platform !== 'linux') {
    try {
      const quitResult = await page.evaluate(() => window.electron?.requestE2eAppQuit?.());
      if (quitResult?.ok !== true) {
        throw new Error('packaged preload did not acknowledge the E2E quit request');
      }
      finish(rendererError, { gracefulQuitRequested: true });
      return;
    } catch (error) {
      rendererError ??= `packaged graceful shutdown failed: ${error.message}`;
    }
  }
  finish(rendererError);
}

child.stdout.on('data', d => {
  const chunk = d.toString();
  stdoutOutput += chunk;
  scan(chunk);
});
child.stderr.on('data', d => {
  const chunk = d.toString();
  stderrOutput += chunk;
  scan(chunk);
});

const timer = setTimeout(
  () => finish('timed out before the app reached a boot milestone'),
  VERIFY_RENDERER ? RENDERER_TIMEOUT_MS : TIMEOUT_MS
);

// Do not attach until the packaged renderer has reached its stable first-run
// route. Electron exposes the DevTools port before its sandbox preload has
// startup data, and an eager CDP attach can intermittently trip that boundary.
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
  if (!error) {
    const unexpectedOutput = [
      ...stdoutOutput
        .split(/\r?\n/)
        .filter(line => classifyElectronStdoutLine(line) === 'unexpected'),
      ...stderrOutput
        .split(/\r?\n/)
        .filter(line => classifyElectronStderrLine(line) === 'unexpected'),
    ];
    if (unexpectedOutput.length > 0) {
      error =
        `packaged process emitted unexpected warning/error output:\n` +
        redactSensitiveOutput(unexpectedOutput.slice(-25).join('\n'));
    }
  }
  if (error) {
    console.error('[desktop-smoke] --- captured output (tail) ---');
    console.error(redactSensitiveOutput(output).split('\n').slice(-25).join('\n'));
    console.error(`[desktop-smoke] FAIL: ${error}`);
    process.exit(1);
  }
  const mode = VERIFY_RENDERER ? 'renderer journey completed' : 'server up';
  console.log(`[desktop-smoke] PASS: app launched, natives loaded, ${mode}`);
  process.exit(0);
}

function finish(error, { gracefulQuitRequested = false } = {}) {
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

  // The test-only preload IPC has already scheduled app.quit(), which drains
  // the embedded server and SQLite through the production lifecycle. Sending
  // SIGTERM here would create a second competing shutdown and surface OS/GPU
  // teardown errors after a successful journey.
  if (gracefulQuitRequested) return;

  try {
    if (!child.kill('SIGTERM')) complete(error);
  } catch {
    complete(error);
  }
}

child.on('error', err => finish(`failed to spawn: ${err.message}`));
child.on('exit', (code, signal) => {
  if (done) return;
  finish(`app exited early (code=${code} signal=${signal}) before a boot milestone`);
});
