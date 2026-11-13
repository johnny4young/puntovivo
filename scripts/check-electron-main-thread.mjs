#!/usr/bin/env node
/**
 * Electron main-thread responsiveness gate.
 *
 * Seeds a disposable encrypted database, launches the built app in
 * measurement mode (`PUNTOVIVO_MEASURE_MAIN_THREAD=1`) against it, and keeps
 * the embedded server busy with real sales over loopback HTTP while the main
 * process samples its own blocking and the renderer times a trivial IPC round
 * trip. The main process prints `PUNTOVIVO_MAIN_THREAD_METRICS=<json>`; this
 * script compares it with `perf-budget.json::electronMainThread`.
 *
 * Run it through `run-electron-memory-gate.mjs --check=main-thread`, which
 * serves the built renderer and reserves the API port. Flags mirror the
 * memory gate: `--strict` fails over budget, `--require-measurement` fails
 * when nothing could be measured.
 *
 * @module scripts/check-electron-main-thread
 */

import { spawn, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { ensureNativeRuntime } from './check-electron-memory.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const BUDGET_PATH = join(REPO_ROOT, 'perf-budget.json');
const ELECTRON_MAIN_ENTRY = join(REPO_ROOT, 'apps', 'desktop', '.vite', 'build', 'index.cjs');
const DESKTOP_PACKAGE_JSON = join(REPO_ROOT, 'apps', 'desktop', 'package.json');
const SEED_SCRIPT = join(REPO_ROOT, 'packages', 'server', 'dist', 'scripts', 'seed-dev.js');
/** Throwaway key for the disposable fixture, like the memory gate's. */
const MEASURE_DB_KEY = 'dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd';
/** Demo fixture cashier; DEV-SEED.md documents the account and password. */
const FIXTURE_CASHIER = { email: 'cashier.norte@demo.co', password: 'Admin123!Dev' };
const PRODUCT_POOL = 40;
/** No pause between sales: the window keeps the server saturated. */
const THINK_MS = 0;
const LAUNCH_TIMEOUT_MS = 240_000;

/** Resolve CLI/env flags without reading process state in tests. */
export function resolveMainThreadGateMode({
  argv = process.argv.slice(2),
  env = process.env,
} = {}) {
  return {
    enforce: argv.includes('--strict') || env.PUNTOVIVO_MAIN_THREAD_STRICT === '1',
    requireMeasurement:
      argv.includes('--require-measurement') ||
      env.PUNTOVIVO_MAIN_THREAD_REQUIRE_MEASUREMENT === '1',
  };
}

/** Read one `NAME=<json>` line the main process printed, or null. */
export function parseJsonLine(stdout, name) {
  const match = new RegExp(`^${name}=(.+)$`, 'm').exec(stdout ?? '');
  if (!match) return null;
  try {
    return JSON.parse(match[1]);
  } catch {
    return null;
  }
}

/** Validate and return the budget entry; throws on a malformed file. */
export function readMainThreadBudget(raw) {
  const budget = raw?.electronMainThread;
  const keys = ['windowMs', 'maxBlockedPercent', 'maxStallMs', 'maxIpcP99Ms', 'minSales'];
  if (!budget || keys.some(key => !(typeof budget[key] === 'number' && budget[key] > 0))) {
    throw new Error(`perf-budget.json::electronMainThread needs positive ${keys.join(', ')}`);
  }
  return budget;
}

/** Compare measured metrics and workload against the budget. */
export function compareToMainThreadBudget({ metrics, workload, budget }) {
  const rows = [
    ['main thread blocked %', metrics.mainThread.blockedPercent, budget.maxBlockedPercent, 'max'],
    ['worst main-thread stall ms', metrics.mainThread.maxStallMs, budget.maxStallMs, 'max'],
    ['IPC round trip p99 ms', metrics.ipc.p99, budget.maxIpcP99Ms, 'max'],
    // Without samples the p99 reads 0 and would pass unmeasured.
    ['IPC samples', metrics.ipc.count, 1, 'min'],
    ['sales during the window', workload.salesInWindow, budget.minSales, 'min'],
  ].map(([name, actual, limit, kind]) => ({
    name,
    actual,
    limit,
    kind,
    ok: kind === 'max' ? actual <= limit : actual >= limit,
  }));
  return { rows, regressions: rows.filter(row => !row.ok) };
}

export function renderMainThreadReport({ rows }, { metrics, workload }) {
  const lines = ['| metric | limit | actual |', '| --- | ---: | ---: |'];
  for (const row of rows) {
    const limit = `${row.kind === 'max' ? '<=' : '>='} ${row.limit}`;
    lines.push(`| ${row.name} | ${limit} | ${row.actual}${row.ok ? '' : ' (over)'} |`);
  }
  lines.push('');
  lines.push(
    `window ${metrics.mainThread.windowMs} ms, blocked ${metrics.mainThread.blockedMs} ms, ` +
      `stalls >50 ms ${metrics.mainThread.stallsOver50Ms}, >100 ms ${metrics.mainThread.stallsOver100Ms}`
  );
  lines.push(
    `IPC samples ${metrics.ipc.count}: p50 ${metrics.ipc.p50} / p95 ${metrics.ipc.p95} / ` +
      `p99 ${metrics.ipc.p99} / max ${metrics.ipc.max} ms`
  );
  lines.push(
    `sales ${workload.salesInWindow} ok, ${workload.failures} failed, ` +
      `HTTP sale p50 ${workload.saleLatency.p50} / p95 ${workload.saleLatency.p95} ms` +
      (workload.firstFailure ? ` (first failure: ${workload.firstFailure})` : '')
  );
  return lines.join('\n');
}

function percentile(sorted, value) {
  if (sorted.length === 0) return 0;
  const index = Math.min(sorted.length - 1, Math.ceil((value / 100) * sorted.length) - 1);
  return Math.round(sorted[index] * 10) / 10;
}

/**
 * Real checkout traffic for one cashier: scanner lookup, `sales.create` with
 * a command envelope, and the active-session refetch the sales page makes.
 */
export function createSaleWorkload({ serverUrl, fetchImpl = fetch, thinkMs = THINK_MS }) {
  const headers = { 'content-type': 'application/json' };
  const products = [];

  async function call(kind, path, input, extraHeaders = {}) {
    const url =
      kind === 'query'
        ? `${serverUrl}/api/trpc/${path}?batch=1&input=${encodeURIComponent(JSON.stringify({ 0: input }))}`
        : `${serverUrl}/api/trpc/${path}?batch=1`;
    const response = await fetchImpl(url, {
      method: kind === 'query' ? 'GET' : 'POST',
      headers: { ...headers, ...extraHeaders },
      ...(kind === 'query' ? {} : { body: JSON.stringify({ 0: input }) }),
    });
    const body = await response.json().catch(() => null);
    const entry = Array.isArray(body) ? body[0] : null;
    if (!response.ok || !entry?.result) {
      const code = entry?.error?.data?.errorCode ?? entry?.error?.data?.code ?? response.status;
      throw new Error(`${path} failed: ${code}`);
    }
    return entry.result.data;
  }

  return {
    async warmUp() {
      const login = await call('mutation', 'auth.login', FIXTURE_CASHIER);
      headers.authorization = `Bearer ${login.token}`;
      const device = await call('mutation', 'auth.registerDevice', {
        kind: 'desktop',
        name: 'main-thread gate',
      });
      headers['x-device-id'] = device.deviceId;
      const session = await call('query', 'cashSessions.getActive', {});
      if (!session) throw new Error('the fixture cashier has no open cash session');
      headers['x-site-id'] = session.siteId;
      const page = await call('query', 'products.list', { limit: PRODUCT_POOL, isActive: true });
      for (const row of page.items) {
        if (!row.tracksStock || row.tracksLots || row.tracksSerials || !(row.stock > 0)) continue;
        const full = await call('query', 'products.getById', { id: row.id });
        const unit = full.unitAssignments?.find(item => item.isBase) ?? full.unitAssignments?.[0];
        const price = unit?.price ?? full.price;
        if (unit && price > 0) {
          products.push({
            id: full.id,
            name: full.name,
            unitId: unit.unitId,
            price,
            taxRate: full.taxRate,
          });
        }
      }
      if (products.length === 0) throw new Error('the fixture has no sellable products');
    },
    /** Sell, pause `thinkMs`, repeat until `shouldStop()` is true. */
    async run(shouldStop) {
      const latencies = [];
      let failures = 0;
      let firstFailure = null;
      let sold = 0;
      while (!shouldStop()) {
        const product = products[sold % products.length];
        const startedAt = performance.now();
        try {
          await call('query', 'products.search', { q: product.name.split(' ')[0], limit: 10 });
          await call(
            'mutation',
            'sales.create',
            {
              paymentMethod: 'cash',
              status: 'completed',
              items: [
                {
                  productId: product.id,
                  unitId: product.unitId,
                  quantity: 1,
                  unitPrice: product.price,
                  discount: 0,
                  taxRate: product.taxRate,
                },
              ],
              payments: [{ method: 'cash', amount: product.price }],
            },
            {
              'x-puntovivo-envelope': JSON.stringify({
                operationId: randomUUID(),
                idempotencyKey: randomUUID(),
                clientCreatedAt: new Date().toISOString(),
              }),
            }
          );
          await call('query', 'cashSessions.getActive', {});
          latencies.push(performance.now() - startedAt);
          sold += 1;
        } catch (error) {
          // The request in flight when the app quits is not a workload failure.
          if (shouldStop()) break;
          failures += 1;
          firstFailure ??= error.message;
          if (failures > 20) throw error;
        }
        if (thinkMs > 0) await delay(thinkMs);
      }
      const sorted = latencies.sort((a, b) => a - b);
      return {
        salesInWindow: sold,
        failures,
        firstFailure,
        saleLatency: { p50: percentile(sorted, 50), p95: percentile(sorted, 95) },
      };
    },
  };
}

/** Seeds the demo data into an encrypted file; the target-hardware fixture reuses it. */
export function seedFixture(dbPath, { key = MEASURE_DB_KEY, timeoutMs = 180_000 } = {}) {
  const run = spawnSync(process.execPath, [SEED_SCRIPT], {
    cwd: join(REPO_ROOT, 'packages', 'server'),
    encoding: 'utf8',
    timeout: timeoutMs,
    killSignal: 'SIGKILL',
    env: {
      ...process.env,
      DATABASE_URL: dbPath,
      PUNTOVIVO_DB_KEY: key,
      PUNTOVIVO_LOG_LEVEL: 'warn',
      PUNTOVIVO_SUPPRESS_CREDENTIAL_BANNER: 'true',
    },
  });
  if (run.status !== 0) {
    throw new Error(
      `seed failed (${run.status}): ${(run.stderr || run.stdout).trim().slice(-2000)}`
    );
  }
  // A saturated window outsells the fixture's stock. The rollup triggers keep
  // totals in step; clearing the exact valuation puts products on the legacy
  // cost path, whose quantity basis follows the new stock.
  const Database = createRequire(join(REPO_ROOT, 'packages', 'server', 'package.json'))(
    'better-sqlite3'
  );
  const db = new Database(dbPath);
  try {
    db.pragma("cipher='sqlcipher'");
    db.pragma('legacy = 4');
    db.pragma(`key = "x'${key}'"`);
    db.transaction(() => {
      db.prepare('UPDATE inventory_balances SET on_hand = 1000000').run();
      db.prepare(
        'UPDATE products SET inventory_value_cents = NULL, cogs_value_cents = NULL, valuation_quantity = NULL'
      ).run();
    })();
  } finally {
    db.close();
  }
}

/**
 * Launch, drive and measure. Returns `{ metrics, workload }`, or `null` with a
 * printed reason when the measurement could not run.
 */
export async function launchAndMeasure({ windowMs }) {
  for (const [path, hint] of [
    [ELECTRON_MAIN_ENTRY, 'pnpm --filter @puntovivo/desktop run build:main'],
    [SEED_SCRIPT, 'pnpm --filter @puntovivo/server run build'],
  ]) {
    if (!existsSync(path)) {
      console.warn(`check-electron-main-thread: WARN skipped — ${path} missing. Run "${hint}".`);
      return null;
    }
  }
  let electronBin;
  try {
    electronBin = createRequire(DESKTOP_PACKAGE_JSON)('electron');
  } catch (err) {
    console.warn(
      `check-electron-main-thread: WARN skipped — electron not resolvable: ${err.message}`
    );
    return null;
  }
  const nativeLabel = { label: 'check-electron-main-thread' };
  if (!ensureNativeRuntime('node', nativeLabel) || !ensureNativeRuntime('electron', nativeLabel)) {
    return null;
  }

  const workDir = mkdtempSync(join(tmpdir(), 'puntovivo-main-thread-'));
  const dbPath = join(workDir, 'fixture.db');
  const startFile = join(workDir, 'start');
  try {
    try {
      seedFixture(dbPath);
    } catch (err) {
      console.warn(`check-electron-main-thread: WARN skipped — ${err.message}`);
      return null;
    }
    const isLinux = process.platform === 'linux';
    const electronArgs = [ELECTRON_MAIN_ENTRY, `--user-data-dir=${join(workDir, 'profile')}`];
    // Same reason as the memory gate: CI runners lack a configured SUID helper.
    if (isLinux) electronArgs.push('--no-sandbox');
    const child = spawn(
      isLinux ? 'xvfb-run' : electronBin,
      isLinux ? ['-a', electronBin, ...electronArgs] : electronArgs,
      {
        cwd: REPO_ROOT,
        // xvfb-run forks Electron and Xvfb, so kill the whole group on Linux.
        detached: isLinux,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: {
          ...process.env,
          PUNTOVIVO_MEASURE_MAIN_THREAD: '1',
          PUNTOVIVO_MAIN_THREAD_START_FILE: startFile,
          PUNTOVIVO_MAIN_THREAD_WINDOW_MS: String(windowMs),
          PUNTOVIVO_E2E: '1',
          DATABASE_URL: dbPath,
          PUNTOVIVO_DB_KEY: MEASURE_DB_KEY,
          PUNTOVIVO_LOG_LEVEL: 'warn',
        },
      }
    );
    let stdout = '';
    let workloadStop = false;
    let workloadRun = null;
    let workloadError = null;
    let launchError = null;
    const stopChild = () => {
      try {
        if (isLinux && child.pid) process.kill(-child.pid, 'SIGKILL');
        else child.kill('SIGKILL');
      } catch {
        // Already gone.
      }
    };
    const exited = new Promise(resolvePromise => {
      child.once('exit', resolvePromise);
      // A failed spawn emits only 'error'.
      child.once('error', error => {
        launchError = error;
        resolvePromise();
      });
    });
    const timeout = setTimeout(stopChild, LAUNCH_TIMEOUT_MS);
    child.stderr.on('data', chunk => process.stderr.write(chunk));
    child.stdout.on('data', chunk => {
      stdout += String(chunk);
      if (!workloadRun) {
        const ready = parseJsonLine(stdout, 'PUNTOVIVO_MAIN_THREAD_READY');
        if (ready?.serverUrl) {
          const workload = createSaleWorkload({
            serverUrl: ready.serverUrl,
            thinkMs: Number(process.env.PUNTOVIVO_MAIN_THREAD_THINK_MS ?? THINK_MS),
          });
          workloadRun = workload
            .warmUp()
            .then(() => {
              writeFileSync(startFile, '');
              return workload.run(() => workloadStop);
            })
            .catch(error => {
              workloadError = error;
              // Main would otherwise wait minutes for a start file that never comes.
              stopChild();
              return null;
            });
        }
      }
      if (/^PUNTOVIVO_MAIN_THREAD_(METRICS|SKIP)=/m.test(stdout)) workloadStop = true;
    });
    await exited;
    clearTimeout(timeout);
    workloadStop = true;
    const workload = workloadRun ? await workloadRun : null;
    const skip = /^PUNTOVIVO_MAIN_THREAD_SKIP=(.+)$/m.exec(stdout)?.[1];
    const metrics = parseJsonLine(stdout, 'PUNTOVIVO_MAIN_THREAD_METRICS');
    if (launchError)
      console.warn(
        `check-electron-main-thread: WARN skipped — launch failed: ${launchError.message}`
      );
    if (workloadError)
      console.warn(`check-electron-main-thread: workload failed: ${workloadError.message}`);
    if (skip) console.warn(`check-electron-main-thread: measurement skipped: ${skip}`);
    if (!metrics || !workload) return null;
    return { metrics, workload };
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
}

export async function runCli({ argv = process.argv.slice(2), env = process.env } = {}) {
  const mode = resolveMainThreadGateMode({ argv, env });
  let budget;
  try {
    budget = readMainThreadBudget(JSON.parse(readFileSync(BUDGET_PATH, 'utf8')));
  } catch (err) {
    console.error(`check-electron-main-thread: ${err.message}`);
    return 1;
  }
  const measured = await launchAndMeasure({ windowMs: budget.windowMs });
  if (!measured) {
    if (mode.requireMeasurement) {
      console.error('check-electron-main-thread: FAIL — no measurement (--require-measurement)');
      return 1;
    }
    return 0;
  }
  const comparison = compareToMainThreadBudget({ ...measured, budget });
  const verdict = comparison.regressions.length === 0 ? 'PASS' : 'OVER BUDGET';
  console.log(`Electron main-thread responsiveness ${verdict}`);
  console.log(renderMainThreadReport(comparison, measured));
  return comparison.regressions.length > 0 && mode.enforce ? 1 : 0;
}

const isDirectInvocation =
  process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirectInvocation) {
  process.exit(await runCli());
}
