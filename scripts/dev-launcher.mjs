import { execFileSync, spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const pnpmCommand = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
const isWindows = process.platform === 'win32';

const mode = process.argv[2] ?? 'desktop';

/**
 * Launch modes exposed through the root `pnpm run dev:*` commands.
 *
 * The mode table is deliberately data-shaped instead of branching through the
 * launcher body: every mode declares the ports it owns, the pnpm workspace
 * commands it starts, and the readiness URL a later step must wait for. This
 * keeps the desktop/web/server contract visible in one place and prevents the
 * recurring class of docs drift where README commands imply a different stack
 * than the launcher actually starts.
 */
const MODE_CONFIG = {
  web: {
    ports: [3000],
    steps: [{ name: 'WEB', args: ['--filter', '@puntovivo/web', 'run', 'dev'] }],
  },
  server: {
    ports: [8090],
    steps: [{ name: 'SERVER', args: ['--filter', '@puntovivo/server', 'run', 'dev'] }],
  },
  fullstack: {
    ports: [3000, 8090],
    steps: [
      { name: 'SERVER', args: ['--filter', '@puntovivo/server', 'run', 'dev'] },
      {
        name: 'WEB',
        args: ['--filter', '@puntovivo/web', 'run', 'dev'],
        waitForUrl: 'http://127.0.0.1:8090/api/health',
      },
    ],
  },
  desktop: {
    ports: [3000, 8090],
    steps: [
      { name: 'WEB', args: ['--filter', '@puntovivo/web', 'run', 'dev'] },
      {
        name: 'DESKTOP',
        args: ['--filter', '@puntovivo/desktop', 'run', 'dev:desktop'],
        waitForUrl: 'http://localhost:3000',
      },
    ],
  },
  'desktop-only': {
    ports: [8090],
    steps: [
      {
        name: 'DESKTOP',
        args: ['--filter', '@puntovivo/desktop', 'run', 'dev:desktop'],
        waitForUrl: 'http://localhost:3000',
        requireExistingUrl: true,
      },
    ],
  },
  stop: {
    ports: [3000, 8090],
    steps: [],
  },
};

const config = MODE_CONFIG[mode];

if (!config) {
  console.error(`Unknown mode "${mode}". Expected one of: ${Object.keys(MODE_CONFIG).join(', ')}`);
  process.exit(1);
}

function log(message) {
  console.log(`[dev-launcher] ${message}`);
}

// Shared local dev database (operator request): the integrated dev modes open
// ONE encrypted SQLite file so data created in the web stack shows up in the
// desktop app and vice versa. Only `fullstack` (pnpm dev:web-stack) and the
// two desktop modes opt in; the bare `server`/`web` modes are deliberately
// left alone so the Playwright e2e suite — which drives `dev:server`/`dev:web`
// against the default packages/server/data/local.db — keeps its own isolated,
// unencrypted database and never collides with this shared one.
const SHARED_DB_MODES = new Set(['fullstack', 'desktop', 'desktop-only']);
const SHARED_DB_PATH = path.join(repoRoot, 'packages', 'server', 'data', 'shared.db');
// `.local` suffix => already covered by the `*.local` rule in .gitignore, so
// the dev key is never committed. 64 hex chars = the 32 raw bytes the SQLCipher
// `PRAGMA key` path in packages/server/src/db/index.ts expects.
const SHARED_DB_KEY_PATH = path.join(repoRoot, 'packages', 'server', 'data', 'shared-db-key.local');

/**
 * Return the reusable SQLCipher key for integrated dev modes.
 *
 * The file is local-only (`*.local`) and stores 32 random bytes encoded as
 * hex, matching the DB open path in `packages/server/src/db/index.ts`. A
 * malformed key is treated as absent so a damaged checkout heals on the next
 * launch instead of failing later with an opaque SQLCipher error.
 */
function resolveSharedDevDbKey() {
  if (existsSync(SHARED_DB_KEY_PATH)) {
    const existing = readFileSync(SHARED_DB_KEY_PATH, 'utf8').trim();
    if (/^[0-9a-f]{64}$/i.test(existing)) {
      return existing;
    }
    log(`Ignoring malformed dev DB key at ${SHARED_DB_KEY_PATH}; regenerating`);
  }
  const key = randomBytes(32).toString('hex');
  mkdirSync(path.dirname(SHARED_DB_KEY_PATH), { recursive: true });
  writeFileSync(SHARED_DB_KEY_PATH, `${key}\n`, { mode: 0o600 });
  log(`Generated shared dev DB key at ${SHARED_DB_KEY_PATH}`);
  return key;
}

// Inject DATABASE_URL + PUNTOVIVO_DB_KEY so both the standalone server
// (reads them directly) and the Electron embedded server (honours them in dev,
// see apps/desktop/src/main/index.ts) open the same encrypted file. `??=`
// semantics: an operator-provided override always wins, so this never clobbers
// an explicit env (e.g. pointing at a throwaway DB).
/**
 * Point integrated dev modes at the shared encrypted SQLite file.
 *
 * Uses `??=` semantics by hand: an operator-provided `DATABASE_URL` or
 * `PUNTOVIVO_DB_KEY` wins. That allows smoke tests and risky repros to use a
 * throwaway DB without changing the root dev command.
 */
function applySharedDevDatabaseEnv() {
  if (!process.env.DATABASE_URL) {
    process.env.DATABASE_URL = SHARED_DB_PATH;
  }
  if (!process.env.PUNTOVIVO_DB_KEY) {
    process.env.PUNTOVIVO_DB_KEY = resolveSharedDevDbKey();
  }
  log(`Shared dev DB (encrypted): ${process.env.DATABASE_URL}`);
}

if (SHARED_DB_MODES.has(mode)) {
  applySharedDevDatabaseEnv();
}

function runCapture(command, args) {
  return execFileSync(command, args, {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

function killPid(pid, signal = 'SIGTERM') {
  if (isWindows) {
    execFileSync('taskkill', ['/PID', String(pid), '/T', '/F'], {
      stdio: 'ignore',
    });
    return;
  }

  try {
    process.kill(pid, signal);
  } catch (error) {
    const maybeError = error;
    if (maybeError?.code !== 'ESRCH') {
      throw error;
    }
  }
}

/**
 * Clear stale local dev listeners before starting a mode.
 *
 * The helper is intentionally macOS/Linux-only. Windows process-tree cleanup
 * is handled in `killPid()`, but automatic port scanning is skipped there to
 * avoid fragile parsing of localized `netstat` output.
 */
async function freePort(port) {
  if (isWindows) {
    log(`Skipping automatic port cleanup for ${port} on Windows`);
    return;
  }

  let output = '';
  try {
    output = runCapture('lsof', ['-ti', `tcp:${port}`, '-sTCP:LISTEN']);
  } catch {
    return;
  }

  const pids = output
    .split('\n')
    .map(value => Number.parseInt(value, 10))
    .filter(Number.isFinite);

  if (pids.length === 0) {
    return;
  }

  log(`Freeing port ${port} from PIDs ${pids.join(', ')}`);
  for (const pid of pids) {
    killPid(pid, 'SIGTERM');
  }

  await delay(500);

  for (const pid of pids) {
    try {
      process.kill(pid, 0);
      killPid(pid, 'SIGKILL');
    } catch {
      // Process already exited.
    }
  }
}

/**
 * Stop orphaned `dev-launcher` wrappers left behind by background `dev:*` runs.
 *
 * `freePort()` only kills the process LISTENING on a port (the inner
 * `tsx watch` / Vite child). When a `dev:server` / `dev:web` is started as a
 * detached background task, its parent `node dev-launcher.mjs <mode>` keeps
 * blocking on the final `await new Promise(() => {})` even after that listener
 * dies — so the launching shell/task never observes an exit and the process
 * shows as perpetually "running". This sweep SIGTERMs every OTHER
 * `dev-launcher.mjs` process (each then runs its own SIGTERM shutdown, which
 * cascades to its detached child group), escalating to SIGKILL for any that
 * ignore the grace period. macOS/Linux only, mirroring `freePort()`'s platform
 * stance; on Windows the wrapper sweep is skipped (use `taskkill`).
 */
async function killStrayLaunchers() {
  if (isWindows) {
    log('Skipping stray dev-launcher cleanup on Windows');
    return;
  }

  let output = '';
  try {
    output = runCapture('pgrep', ['-f', 'dev-launcher\\.mjs']);
  } catch {
    // pgrep exits non-zero when nothing matches — nothing to clean up.
    return;
  }

  const pids = output
    .split('\n')
    .map(value => Number.parseInt(value, 10))
    .filter(pid => Number.isFinite(pid) && pid !== process.pid && pid !== process.ppid);

  if (pids.length === 0) {
    return;
  }

  log(`Stopping ${pids.length} stray dev-launcher process(es): ${pids.join(', ')}`);
  for (const pid of pids) {
    killPid(pid, 'SIGTERM');
  }

  await delay(700);

  for (const pid of pids) {
    try {
      process.kill(pid, 0);
      killPid(pid, 'SIGKILL');
    } catch {
      // Wrapper already exited after its graceful shutdown.
    }
  }
}

/**
 * Poll a readiness endpoint before starting a dependent process.
 *
 * This is what keeps `desktop` from launching Electron before Vite serves the
 * renderer, and keeps `fullstack` from opening the browser target before the
 * standalone API is healthy.
 */
async function waitForUrl(url, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        return;
      }
    } catch {
      // Service not ready yet.
    }

    await delay(500);
  }

  throw new Error(`Timed out waiting for ${url}`);
}

/**
 * Spawn one pnpm workspace process and inherit stdio for readable dev logs.
 *
 * On POSIX platforms the child is detached so shutdown can signal the whole
 * process group; this catches Vite, tsx watch, Electron Forge, and their
 * nested workers in one pass.
 */
function spawnStep(step) {
  log(`Starting ${step.name}: ${pnpmCommand} ${step.args.join(' ')}`);
  const child = spawn(pnpmCommand, step.args, {
    cwd: repoRoot,
    env: process.env,
    stdio: 'inherit',
    detached: !isWindows,
  });

  return {
    ...step,
    child,
  };
}

async function stopProcess(processInfo) {
  if (!processInfo?.child || processInfo.child.exitCode !== null) {
    return;
  }

  if (isWindows) {
    killPid(processInfo.child.pid);
    return;
  }

  try {
    process.kill(-processInfo.child.pid, 'SIGTERM');
  } catch (error) {
    const maybeError = error;
    if (maybeError?.code !== 'ESRCH') {
      throw error;
    }
    return;
  }

  await delay(500);

  try {
    process.kill(-processInfo.child.pid, 0);
    process.kill(-processInfo.child.pid, 'SIGKILL');
  } catch {
    // Process group already exited.
  }
}

let shuttingDown = false;
const runningProcesses = [];

async function shutdown(exitCode = 0) {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;
  await Promise.allSettled(runningProcesses.map(stopProcess));
  process.exit(exitCode);
}

process.on('SIGINT', () => void shutdown(0));
process.on('SIGTERM', () => void shutdown(0));

for (const port of config.ports) {
  await freePort(port);
}

if (mode === 'stop') {
  await killStrayLaunchers();
  log('Stopped known dev ports');
  process.exit(0);
}

for (const step of config.steps) {
  if (step.waitForUrl) {
    log(`${step.requireExistingUrl ? 'Checking' : 'Waiting for'} ${step.waitForUrl}`);
    await waitForUrl(step.waitForUrl);
  }

  const processInfo = spawnStep(step);
  runningProcesses.push(processInfo);

  processInfo.child.on('exit', (code, signal) => {
    if (shuttingDown) {
      return;
    }

    const normalizedCode = code ?? (signal ? 1 : 0);
    log(`${step.name} exited${signal ? ` via ${signal}` : ''}`);
    void shutdown(normalizedCode);
  });
}

log(`Mode "${mode}" is running. Press Ctrl+C to stop.`);
await new Promise(() => {});
