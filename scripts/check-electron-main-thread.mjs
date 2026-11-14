#!/usr/bin/env node
/**
 * Electron main-thread responsiveness gate: budget config and the sales
 * workload for `@electron-stagewright/plugin-budget`.
 *
 * Seeds a disposable encrypted database and launches the built app three
 * times against it. In each window the workload keeps the embedded server busy
 * with real sales over loopback HTTP while the kit samples main-thread
 * blocking and a renderer IPC round trip. The gate compares the median of the
 * rounds with `perf-budget.json::electronMainThread`, so one host stall in one
 * window cannot fail it, while a stall the code causes repeats in every round.
 *
 * Run it through `run-electron-memory-gate.mjs --check=main-thread`, which
 * serves the built renderer and reserves the API port.
 *
 * @module scripts/check-electron-main-thread
 */

import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { ensureNativeRuntime } from './check-electron-memory.mjs';
import {
  BUDGET_PATH,
  ELECTRON_MAIN_ENTRY,
  REPO_ROOT,
  runBudgetGate,
} from './lib/electron-budget.mjs';

export { ELECTRON_MAIN_ENTRY };
export const DESKTOP_PACKAGE_JSON = join(REPO_ROOT, 'apps', 'desktop', 'package.json');
const SEED_SCRIPT = join(REPO_ROOT, 'packages', 'server', 'dist', 'scripts', 'seed-dev.js');
/** Throwaway key for the disposable fixture, like the memory gate's. */
export const MEASURE_DB_KEY = 'dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd';
/** Demo fixture cashier; DEV-SEED.md documents the account and password. */
const FIXTURE_CASHIER = { email: 'cashier.norte@demo.co', password: 'Admin123!Dev' };
const PRODUCT_POOL = 40;
/** No pause between sales: the window keeps the server saturated. */
const THINK_MS = 0;
const SALES_WORKLOAD = join(REPO_ROOT, 'scripts', 'electron-budget-sales-workload.mjs');

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

export async function runCli({ argv = process.argv.slice(2), env = process.env } = {}) {
  let budget;
  try {
    budget = readMainThreadBudget(JSON.parse(readFileSync(BUDGET_PATH, 'utf8')));
  } catch (err) {
    console.error(`check-electron-main-thread: ${err.message}`);
    return 1;
  }
  for (const [path, hint] of [
    [ELECTRON_MAIN_ENTRY, 'pnpm --filter @puntovivo/desktop run build:main'],
    [SEED_SCRIPT, 'pnpm --filter @puntovivo/server run build'],
  ]) {
    if (!existsSync(path)) {
      console.error(`check-electron-main-thread: ${path} missing. Run "${hint}".`);
      return 1;
    }
  }
  const nativeLabel = { label: 'check-electron-main-thread' };
  if (!ensureNativeRuntime('node', nativeLabel) || !ensureNativeRuntime('electron', nativeLabel)) {
    return 1;
  }
  const workDir = mkdtempSync(join(tmpdir(), 'puntovivo-main-thread-'));
  const dbPath = join(workDir, 'fixture.db');
  try {
    seedFixture(dbPath);
    return await runBudgetGate({
      check: 'main-thread',
      label: 'check-electron-main-thread',
      argv,
      workload: SALES_WORKLOAD,
      // Each launch sells against its own copy: a fixture that inherits the
      // previous launches' sales slows down launch after launch.
      prepareRound: async (round, roundDir) => {
        const copy = join(roundDir, `fixture-${round}.db`);
        copyFileSync(dbPath, copy);
        if (existsSync(`${dbPath}-wal`)) copyFileSync(`${dbPath}-wal`, `${copy}-wal`);
        return { DATABASE_URL: copy };
      },
      // Read by the workload, which runs in the budget CLI's process.
      processEnv: {
        ...env,
        PUNTOVIVO_BUDGET_SERVER_URL: `http://127.0.0.1:${env.PUNTOVIVO_BIND_PORT ?? '8090'}`,
        PUNTOVIVO_BUDGET_WINDOW_MS: String(budget.windowMs),
        PUNTOVIVO_BUDGET_MIN_SALES: String(budget.minSales),
      },
      env: {
        PUNTOVIVO_E2E: '1',
        DATABASE_URL: dbPath,
        PUNTOVIVO_DB_KEY: MEASURE_DB_KEY,
        PUNTOVIVO_LOG_LEVEL: 'warn',
      },
    });
  } catch (err) {
    console.error(`check-electron-main-thread: ${err.message}`);
    return 1;
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
}

const isDirectInvocation =
  process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirectInvocation) {
  process.exit(await runCli());
}
