#!/usr/bin/env node
/**
 * ENG-133d — portable Electron memory gate runner.
 *
 * Starts a Vite preview for the already-built web app, points the Electron
 * measurement launch at that renderer, then runs `check-electron-memory.mjs`.
 * Keeping the lifecycle in Node avoids POSIX-only shell backgrounding in
 * package scripts and GitHub Actions. `ci:desktop` builds the web app and the
 * Electron main/preload bundle before invoking this runner.
 *
 * @module scripts/run-electron-memory-gate
 */

import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const DEFAULT_PREVIEW_HOST = '127.0.0.1';
export const DEFAULT_PREVIEW_PORT = 4173;
export const DEFAULT_READY_TIMEOUT_MS = 30_000;
export const DEFAULT_POLL_INTERVAL_MS = 500;

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CHECK_ELECTRON_MEMORY_SCRIPT = resolve(REPO_ROOT, 'scripts', 'check-electron-memory.mjs');
const PNPM_COMMAND = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';

function parsePositiveInteger(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

/**
 * Parse runner-owned flags and leave the rest for check-electron-memory.mjs.
 *
 * Runner flags:
 * - `--host <host>` / `--host=<host>`
 * - `--port <port>` / `--port=<port>`
 * - `--ready-timeout-ms <ms>` / `--ready-timeout-ms=<ms>`
 * - `--skip-preview` (for operators who already started a renderer target)
 */
export function resolveRunElectronMemoryGateOptions({ argv = process.argv.slice(2), env = process.env } = {}) {
  let host = env.PUNTOVIVO_MEMORY_WEB_HOST || DEFAULT_PREVIEW_HOST;
  let port = parsePositiveInteger(env.PUNTOVIVO_MEMORY_WEB_PORT, DEFAULT_PREVIEW_PORT);
  let readyTimeoutMs = parsePositiveInteger(env.PUNTOVIVO_MEMORY_WEB_READY_TIMEOUT_MS, DEFAULT_READY_TIMEOUT_MS);
  let skipPreview = env.PUNTOVIVO_MEMORY_SKIP_PREVIEW === '1';
  const passThroughArgs = [];

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--') {
      passThroughArgs.push(...argv.slice(i + 1));
      break;
    }
    if (arg === '--host') {
      host = argv[++i] || host;
      continue;
    }
    if (arg.startsWith('--host=')) {
      host = arg.slice('--host='.length) || host;
      continue;
    }
    if (arg === '--port') {
      port = parsePositiveInteger(argv[++i], port);
      continue;
    }
    if (arg.startsWith('--port=')) {
      port = parsePositiveInteger(arg.slice('--port='.length), port);
      continue;
    }
    if (arg === '--ready-timeout-ms') {
      readyTimeoutMs = parsePositiveInteger(argv[++i], readyTimeoutMs);
      continue;
    }
    if (arg.startsWith('--ready-timeout-ms=')) {
      readyTimeoutMs = parsePositiveInteger(arg.slice('--ready-timeout-ms='.length), readyTimeoutMs);
      continue;
    }
    if (arg === '--skip-preview') {
      skipPreview = true;
      continue;
    }
    passThroughArgs.push(arg);
  }

  const previewUrl = skipPreview
    ? env.WEB_DEV_SERVER_URL || `http://${host}:${port}`
    : `http://${host}:${port}`;
  return { host, port, readyTimeoutMs, skipPreview, previewUrl, passThroughArgs };
}

export function buildPreviewArgs({ host, port }) {
  return [
    '--filter',
    '@puntovivo/web',
    'exec',
    'vite',
    'preview',
    '--host',
    host,
    '--port',
    String(port),
    '--strictPort',
  ];
}

export function buildCheckArgs(passThroughArgs = []) {
  return [CHECK_ELECTRON_MEMORY_SCRIPT, ...passThroughArgs];
}

export function buildCheckEnv(env, previewUrl) {
  return {
    ...env,
    WEB_DEV_SERVER_URL: previewUrl,
  };
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

  child.kill('SIGTERM');
  const exited = await waitForExit(child, 5_000);
  if (!exited) {
    child.kill('SIGKILL');
    await waitForExit(child, 2_000);
  }
}

/** Wait until a URL answers with any HTTP response (including SPA 404s). */
export async function waitForUrl(url, {
  timeoutMs = DEFAULT_READY_TIMEOUT_MS,
  intervalMs = DEFAULT_POLL_INTERVAL_MS,
  fetchImpl = fetch,
  shouldAbort = () => false,
} = {}) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    const abortReason = shouldAbort();
    if (abortReason) {
      throw new Error(abortReason);
    }
    try {
      const response = await fetchImpl(url, { method: 'GET' });
      // A listening Vite preview returns 200 for `/`, but accepting any HTTP
      // response keeps this helper useful for tests and SPA fallback changes.
      if (response) {
        return;
      }
    } catch (err) {
      lastError = err;
    }
    await delay(intervalMs);
  }
  throw new Error(`Timed out waiting for ${url}${lastError?.message ? ` (${lastError.message})` : ''}`);
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
      console.error(`run-electron-memory-gate: failed to start ${command}: ${err.message}`);
      resolvePromise(1);
    });
    child.once('exit', (code, signal) => {
      if (signal) {
        console.error(`run-electron-memory-gate: ${command} exited from signal ${signal}`);
        resolvePromise(1);
        return;
      }
      resolvePromise(code ?? 1);
    });
  });
}

export async function runCli({ argv = process.argv.slice(2), env = process.env } = {}) {
  const options = resolveRunElectronMemoryGateOptions({ argv, env });
  let previewProcess;
  let previewExit;
  let previewError;

  try {
    if (!options.skipPreview) {
      const previewArgs = buildPreviewArgs(options);
      console.log(`run-electron-memory-gate: starting web preview at ${options.previewUrl}`);
      previewProcess = spawn(PNPM_COMMAND, previewArgs, {
        cwd: REPO_ROOT,
        env,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      previewProcess.once('exit', (code, signal) => {
        previewExit = { code, signal };
      });
      previewProcess.once('error', err => {
        previewError = err;
      });
      pipeWithPrefix(previewProcess.stdout, '[web-preview] ', process.stdout);
      pipeWithPrefix(previewProcess.stderr, '[web-preview] ', process.stderr);
      await waitForUrl(options.previewUrl, {
        timeoutMs: options.readyTimeoutMs,
        shouldAbort: () => {
          if (previewError) {
            return `web preview failed to start: ${previewError.message}`;
          }
          return previewExit
            ? `web preview exited before readiness (code=${previewExit.code ?? 'null'}, signal=${previewExit.signal ?? 'null'})`
            : false;
        },
      });
    } else {
      console.log(`run-electron-memory-gate: using existing renderer at ${options.previewUrl}`);
    }

    return await runChild(process.execPath, buildCheckArgs(options.passThroughArgs), {
      cwd: REPO_ROOT,
      env: buildCheckEnv(env, options.previewUrl),
      stdio: 'inherit',
    });
  } catch (err) {
    console.error(`run-electron-memory-gate: ${err.message}`);
    return 1;
  } finally {
    await stopChild(previewProcess);
  }
}

const isDirectInvocation = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirectInvocation) {
  process.exit(await runCli());
}
