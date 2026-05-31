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

const MODE_CONFIG = {
  web: {
    ports: [3000],
    steps: [{ name: 'WEB', args: ['--filter', '@puntovivo/web', 'run', 'dev']}],
  },
  server: {
    ports: [8090],
    steps: [{ name: 'SERVER', args: ['--filter', '@puntovivo/server', 'run', 'dev']}],
  },
  fullstack: {
    ports: [3000, 8090],
    steps: [
      { name: 'SERVER', args: ['--filter', '@puntovivo/server', 'run', 'dev']},
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
      { name: 'WEB', args: ['--filter', '@puntovivo/web', 'run', 'dev']},
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
