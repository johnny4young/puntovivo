#!/usr/bin/env node
/**
 * portable Lighthouse web-vitals CI gate runner.
 *
 * Seeds the demo dataset into an isolated SQLite database, starts the
 * standalone Fastify server plus an already-built Vite preview, then runs
 * `check-lighthouse.mjs --strict --require-measurement` against the preview.
 * Keeping the lifecycle in Node avoids POSIX-only shell backgrounding in
 * package scripts and GitHub Actions while still giving local operators a
 * direct command for reproducing the CI path.
 *
 * @module scripts/run-lighthouse-gate
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

export const DEFAULT_WEB_HOST = 'localhost';
// serve the preview on a CORS-allowed origin. The built web app calls
// the API at an absolute http://localhost:8090 (no preview proxy), so the preview
// origin must be in the server's CORS allow-list (packages/server/src/server/config.ts
// resolveServerConfig default: localhost:3000 / :5173). Vite preview's own default
// (4173) is NOT allowed, which would CORS-block login + every authenticated-route
// tRPC call and trip --require-measurement on a healthy app. 3000 also matches the
// BASE_URL default in check-lighthouse.mjs. Do not "restore" this to 4173.
export const DEFAULT_WEB_PORT = 3000;
export const DEFAULT_API_HOST = 'localhost';
export const DEFAULT_API_PORT = 8090;
export const DEFAULT_CDP_PORT = 9222;
export const DEFAULT_READY_TIMEOUT_MS = 120_000;
export const DEFAULT_POLL_INTERVAL_MS = 500;

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CHECK_LIGHTHOUSE_SCRIPT = resolve(REPO_ROOT, 'scripts', 'check-lighthouse.mjs');
const ENSURE_PLAYWRIGHT_SCRIPT = resolve(REPO_ROOT, 'scripts', 'ensure-playwright-browser.mjs');
const PNPM_COMMAND = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';

function parsePositiveInteger(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parseFlagValue(argv, index, prefix, fallback) {
  const arg = argv[index];
  if (arg === prefix) {
    return { value: argv[index + 1] || fallback, consumed: 1 };
  }
  if (arg.startsWith(`${prefix}=`)) {
    return { value: arg.slice(prefix.length + 1) || fallback, consumed: 0 };
  }
  return null;
}

/**
 * Parse runner-owned flags and leave the rest for check-lighthouse.mjs.
 *
 * Runner flags:
 * - `--web-host <host>` / `--web-host=<host>`
 * - `--web-port <port>` / `--web-port=<port>`
 * - `--api-host <host>` / `--api-host=<host>`
 * - `--api-port <port>` / `--api-port=<port>`
 * - `--cdp-port <port>` / `--cdp-port=<port>`
 * - `--ready-timeout-ms <ms>` / `--ready-timeout-ms=<ms>`
 * - `--skip-seed`, `--skip-server`, `--skip-preview`
 */
export function resolveRunLighthouseGateOptions({
  argv = process.argv.slice(2),
  env = process.env,
} = {}) {
  let webHost = env.PUNTOVIVO_LIGHTHOUSE_WEB_HOST || DEFAULT_WEB_HOST;
  let webPort = parsePositiveInteger(env.PUNTOVIVO_LIGHTHOUSE_WEB_PORT, DEFAULT_WEB_PORT);
  let apiHost = env.PUNTOVIVO_LIGHTHOUSE_API_HOST || DEFAULT_API_HOST;
  let apiPort = parsePositiveInteger(env.PUNTOVIVO_LIGHTHOUSE_API_PORT, DEFAULT_API_PORT);
  let cdpPort = parsePositiveInteger(env.PUNTOVIVO_LIGHTHOUSE_CDP_PORT, DEFAULT_CDP_PORT);
  let readyTimeoutMs = parsePositiveInteger(
    env.PUNTOVIVO_LIGHTHOUSE_READY_TIMEOUT_MS,
    DEFAULT_READY_TIMEOUT_MS
  );
  let skipSeed = env.PUNTOVIVO_LIGHTHOUSE_SKIP_SEED === '1';
  let skipServer = env.PUNTOVIVO_LIGHTHOUSE_SKIP_SERVER === '1';
  let skipPreview = env.PUNTOVIVO_LIGHTHOUSE_SKIP_PREVIEW === '1';
  const passThroughArgs = [];

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--') {
      passThroughArgs.push(...argv.slice(i + 1));
      break;
    }

    const stringFlags = [
      [
        '--web-host',
        value => {
          webHost = value;
        },
      ],
      [
        '--api-host',
        value => {
          apiHost = value;
        },
      ],
    ];
    let handled = false;
    for (const [flag, apply] of stringFlags) {
      const parsed = parseFlagValue(argv, i, flag, undefined);
      if (parsed) {
        apply(parsed.value);
        i += parsed.consumed;
        handled = true;
        break;
      }
    }
    if (handled) continue;

    const numericFlags = [
      [
        '--web-port',
        value => {
          webPort = parsePositiveInteger(value, webPort);
        },
      ],
      [
        '--api-port',
        value => {
          apiPort = parsePositiveInteger(value, apiPort);
        },
      ],
      [
        '--cdp-port',
        value => {
          cdpPort = parsePositiveInteger(value, cdpPort);
        },
      ],
      [
        '--ready-timeout-ms',
        value => {
          readyTimeoutMs = parsePositiveInteger(value, readyTimeoutMs);
        },
      ],
    ];
    handled = false;
    for (const [flag, apply] of numericFlags) {
      const parsed = parseFlagValue(argv, i, flag, undefined);
      if (parsed) {
        apply(parsed.value);
        i += parsed.consumed;
        handled = true;
        break;
      }
    }
    if (handled) continue;

    if (arg === '--skip-seed') {
      skipSeed = true;
      continue;
    }
    if (arg === '--skip-server') {
      skipServer = true;
      continue;
    }
    if (arg === '--skip-preview') {
      skipPreview = true;
      continue;
    }
    passThroughArgs.push(arg);
  }

  const previewUrl = skipPreview
    ? env.PUNTOVIVO_LIGHTHOUSE_BASE_URL || `http://${webHost}:${webPort}`
    : `http://${webHost}:${webPort}`;
  const apiUrl = `http://${apiHost}:${apiPort}`;

  return {
    webHost,
    webPort,
    apiHost,
    apiPort,
    cdpPort,
    readyTimeoutMs,
    skipSeed,
    skipServer,
    skipPreview,
    previewUrl,
    apiUrl,
    passThroughArgs,
  };
}

export function buildEnsureBrowserArgs() {
  return [ENSURE_PLAYWRIGHT_SCRIPT];
}

export function buildSeedArgs() {
  return ['run', 'seed:dev'];
}

export function buildServerArgs() {
  return ['--filter', '@puntovivo/server', 'run', 'dev'];
}

export function buildPreviewArgs({ webHost, webPort }) {
  return [
    '--filter',
    '@puntovivo/web',
    'exec',
    'vite',
    'preview',
    '--host',
    webHost,
    '--port',
    String(webPort),
    '--strictPort',
  ];
}

export function buildCheckArgs(passThroughArgs = []) {
  return [CHECK_LIGHTHOUSE_SCRIPT, ...passThroughArgs];
}

export function buildGateEnv(env, options, dbPath, browsersPath) {
  const nextEnv = {
    ...env,
    PLAYWRIGHT_BROWSERS_PATH: env.PLAYWRIGHT_BROWSERS_PATH || browsersPath,
    DATABASE_URL: env.PUNTOVIVO_LIGHTHOUSE_DATABASE_URL || dbPath,
    PUNTOVIVO_BIND_HOST: options.apiHost,
    PUNTOVIVO_BIND_PORT: String(options.apiPort),
    PUNTOVIVO_LIGHTHOUSE_BASE_URL: options.previewUrl,
    PUNTOVIVO_LIGHTHOUSE_CDP_PORT: String(options.cdpPort),
    PUNTOVIVO_SQLITE_BUSY_TIMEOUT_MS: env.PUNTOVIVO_SQLITE_BUSY_TIMEOUT_MS || '15000',
    PUNTOVIVO_GLOBAL_RATE_LIMIT_MAX: env.PUNTOVIVO_GLOBAL_RATE_LIMIT_MAX || '10000',
    PUNTOVIVO_E2E: env.PUNTOVIVO_E2E || '1',
  };

  if (env.PUNTOVIVO_LIGHTHOUSE_DB_KEY) {
    nextEnv.PUNTOVIVO_DB_KEY = env.PUNTOVIVO_LIGHTHOUSE_DB_KEY;
  } else {
    delete nextEnv.PUNTOVIVO_DB_KEY;
  }

  return nextEnv;
}

async function waitForExit(child, timeoutMs) {
  if (child.exitCode !== null || child.signalCode !== null) {
    return { code: child.exitCode, signal: child.signalCode };
  }
  return await new Promise(resolvePromise => {
    const timeout = setTimeout(() => {
      child.off('exit', onExit);
      resolvePromise(null);
    }, timeoutMs);
    const onExit = (code, signal) => {
      clearTimeout(timeout);
      resolvePromise({ code, signal });
    };
    child.once('exit', onExit);
  });
}

async function stopChild(child) {
  if (!child || !child.pid || child.exitCode !== null || child.signalCode !== null) {
    return;
  }

  if (process.platform === 'win32') {
    spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
    await waitForExit(child, 5_000);
    return;
  }

  try {
    process.kill(-child.pid, 'SIGTERM');
  } catch (error) {
    if (error?.code !== 'ESRCH') {
      throw error;
    }
    return;
  }

  const exited = await waitForExit(child, 5_000);
  if (!exited) {
    try {
      process.kill(-child.pid, 'SIGKILL');
      await waitForExit(child, 2_000);
    } catch (error) {
      if (error?.code !== 'ESRCH') throw error;
    }
  }
}

/** Wait until a URL answers with any HTTP response. */
export async function waitForUrl(
  url,
  {
    timeoutMs = DEFAULT_READY_TIMEOUT_MS,
    intervalMs = DEFAULT_POLL_INTERVAL_MS,
    fetchImpl = fetch,
    shouldAbort = () => false,
  } = {}
) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    const abortReason = shouldAbort();
    if (abortReason) {
      throw new Error(abortReason);
    }
    try {
      const response = await fetchImpl(url, { method: 'GET' });
      if (response) {
        return;
      }
    } catch (err) {
      lastError = err;
    }
    await delay(intervalMs);
  }
  throw new Error(
    `Timed out waiting for ${url}${lastError?.message ? ` (${lastError.message})` : ''}`
  );
}

function pipeWithPrefix(stream, prefix, output) {
  stream?.on('data', chunk => {
    const text = String(chunk);
    for (const line of text.split(/(?<=\n)/)) {
      if (line.length > 0) {
        output.write(`${prefix}${line}`);
      }
    }
  });
}

async function runChild(command, args, options) {
  const child = spawn(command, args, options);
  return await new Promise(resolvePromise => {
    child.once('error', err => {
      console.error(`run-lighthouse-gate: failed to start ${command}: ${err.message}`);
      resolvePromise(1);
    });
    child.once('exit', (code, signal) => {
      if (signal) {
        console.error(`run-lighthouse-gate: ${command} exited from signal ${signal}`);
        resolvePromise(1);
        return;
      }
      resolvePromise(code ?? 1);
    });
  });
}

function spawnLongRunning(command, args, { env, prefix }) {
  const child = spawn(command, args, {
    cwd: REPO_ROOT,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: process.platform !== 'win32',
  });
  pipeWithPrefix(child.stdout, prefix, process.stdout);
  pipeWithPrefix(child.stderr, prefix, process.stderr);
  return child;
}

export async function runCli({ argv = process.argv.slice(2), env = process.env } = {}) {
  const options = resolveRunLighthouseGateOptions({ argv, env });
  const tempDir = mkdtempSync(join(tmpdir(), 'puntovivo-lighthouse-'));
  const dbPath = env.PUNTOVIVO_LIGHTHOUSE_DATABASE_URL || join(tempDir, 'lighthouse.db');
  const browsersPath = resolve(REPO_ROOT, '.playwright-browsers');
  const gateEnv = buildGateEnv(env, options, dbPath, browsersPath);
  let serverProcess;
  let previewProcess;
  let serverExit;
  let previewExit;
  let serverError;
  let previewError;

  try {
    console.log('run-lighthouse-gate: ensuring Playwright Chromium');
    const ensureCode = await runChild(process.execPath, buildEnsureBrowserArgs(), {
      cwd: REPO_ROOT,
      env: gateEnv,
      stdio: 'inherit',
    });
    if (ensureCode !== 0) return ensureCode;

    if (!options.skipSeed) {
      console.log(`run-lighthouse-gate: seeding demo data into ${gateEnv.DATABASE_URL}`);
      const seedCode = await runChild(PNPM_COMMAND, buildSeedArgs(), {
        cwd: REPO_ROOT,
        env: gateEnv,
        stdio: 'inherit',
      });
      if (seedCode !== 0) return seedCode;
    } else {
      console.log('run-lighthouse-gate: skipping seed step');
    }

    if (!options.skipServer) {
      console.log(`run-lighthouse-gate: starting API server at ${options.apiUrl}`);
      serverProcess = spawnLongRunning(PNPM_COMMAND, buildServerArgs(), {
        env: gateEnv,
        prefix: '[api] ',
      });
      serverProcess.once('exit', (code, signal) => {
        serverExit = { code, signal };
      });
      serverProcess.once('error', err => {
        serverError = err;
      });
      await waitForUrl(`${options.apiUrl}/api/health`, {
        timeoutMs: options.readyTimeoutMs,
        shouldAbort: () => {
          if (serverError) return `API server failed to start: ${serverError.message}`;
          return serverExit
            ? `API server exited before readiness (code=${serverExit.code ?? 'null'}, signal=${serverExit.signal ?? 'null'})`
            : false;
        },
      });
    } else {
      console.log(`run-lighthouse-gate: using existing API server at ${options.apiUrl}`);
    }

    if (!options.skipPreview) {
      console.log(`run-lighthouse-gate: starting web preview at ${options.previewUrl}`);
      previewProcess = spawnLongRunning(PNPM_COMMAND, buildPreviewArgs(options), {
        env: gateEnv,
        prefix: '[web-preview] ',
      });
      previewProcess.once('exit', (code, signal) => {
        previewExit = { code, signal };
      });
      previewProcess.once('error', err => {
        previewError = err;
      });
      await waitForUrl(options.previewUrl, {
        timeoutMs: options.readyTimeoutMs,
        shouldAbort: () => {
          if (previewError) return `web preview failed to start: ${previewError.message}`;
          return previewExit
            ? `web preview exited before readiness (code=${previewExit.code ?? 'null'}, signal=${previewExit.signal ?? 'null'})`
            : false;
        },
      });
    } else {
      console.log(`run-lighthouse-gate: using existing web target at ${options.previewUrl}`);
    }

    return await runChild(process.execPath, buildCheckArgs(options.passThroughArgs), {
      cwd: REPO_ROOT,
      env: gateEnv,
      stdio: 'inherit',
    });
  } catch (err) {
    console.error(`run-lighthouse-gate: ${err.message}`);
    return 1;
  } finally {
    await Promise.allSettled([stopChild(previewProcess), stopChild(serverProcess)]);
    if (!env.PUNTOVIVO_LIGHTHOUSE_DATABASE_URL) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  }
}

const isDirectInvocation =
  process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirectInvocation) {
  process.exit(await runCli());
}
