/**
 * Preview launcher for Claude Code built-in preview.
 *
 * The Claude Code preview system injects PORT=<configured-port> into the
 * launched process, which would cause the standalone Fastify server to bind
 * on the web port (3000) instead of its expected port (8090).
 *
 * This script works around that by:
 *  1. Unsetting PORT before starting the backend so it uses its own default (8090)
 *  2. Starting backend + frontend as two child processes with the right ports
 *  3. Keeping the parent alive so the preview system stays connected
 */

import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const pnpmCommand = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';

const BACKEND_PORT = 8090;
const BACKEND_HEALTH = `http://127.0.0.1:${BACKEND_PORT}/api/health`;
const STARTUP_TIMEOUT_MS = 45_000;

function log(msg) {
  console.log(`[preview-start] ${msg}`);
}

function spawnInherit(command, args, env = {}) {
  return spawn(command, args, {
    cwd: repoRoot,
    stdio: 'inherit',
    env: { ...process.env, ...env },
    detached: false,
  });
}

async function waitForUrl(url, timeoutMs = STARTUP_TIMEOUT_MS) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {
      // not ready yet
    }
    await delay(500);
  }
  throw new Error(`Timed out waiting for ${url}`);
}

const processes = [];
let shuttingDown = false;

async function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  log('Shutting down...');
  for (const child of processes) {
    try { child.kill('SIGTERM'); } catch { /* already dead */ }
  }
  await delay(500);
  process.exit(code);
}

process.on('SIGINT', () => void shutdown(0));
process.on('SIGTERM', () => void shutdown(0));

// ── 1. Start backend on its own port (explicitly unset PORT so it uses 8090)
log(`Starting backend server on port ${BACKEND_PORT}...`);
const backendEnv = { PORT: String(BACKEND_PORT) };
delete backendEnv.PORT; // let standalone.ts use its own default
const backend = spawnInherit(
  pnpmCommand,
  ['--filter', '@puntovivo/server', 'run', 'dev'],
  { PORT: String(BACKEND_PORT) }   // force 8090 even if preview injected 3000
);
processes.push(backend);

backend.on('exit', (code, signal) => {
  if (!shuttingDown) {
    log(`Backend exited (${signal ?? code}), shutting down`);
    void shutdown(1);
  }
});

// ── 2. Wait for backend health
log(`Waiting for backend at ${BACKEND_HEALTH}...`);
try {
  await waitForUrl(BACKEND_HEALTH);
} catch (err) {
  log(`Backend did not start in time: ${err.message}`);
  await shutdown(1);
}
log('Backend ready.');

// ── 3. Start Vite frontend on port 3000
log('Starting web dev server on port 3000...');
const frontend = spawnInherit(
  pnpmCommand,
  ['--filter', '@puntovivo/web', 'run', 'dev'],
  { PORT: undefined }   // Vite reads its own config; don't override
);
processes.push(frontend);

frontend.on('exit', (code, signal) => {
  if (!shuttingDown) {
    log(`Frontend exited (${signal ?? code}), shutting down`);
    void shutdown(1);
  }
});

log('Both services started. Preview is available at http://localhost:3000');

// Keep process alive
await new Promise(() => {});
