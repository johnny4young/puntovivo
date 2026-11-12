#!/usr/bin/env node
/**
 * Desktop soak: runs the built app against a disposable encrypted demo
 * database, sells over loopback HTTP, injects server worker crashes and
 * backups, samples memory and main-thread stalls, and checks the books at the
 * end (ADR 0034, ADR 0035).
 *
 * Run it with `pnpm run soak:desktop`, which serves the built renderer (the
 * gate runner needs pnpm's entry on Windows). `--profile=short` (default) is the 20-minute CI run;
 * `--profile=long` is the 8-hour run. `--minutes=N` overrides the duration and
 * `--out=DIR` keeps the samples and the summary.
 *
 * @module scripts/desktop-soak
 */

import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import {
  DESKTOP_PACKAGE_JSON,
  ELECTRON_MAIN_ENTRY,
  MEASURE_DB_KEY,
  parseJsonLine,
  readMainThreadBudget,
  seedFixture,
} from './check-electron-main-thread.mjs';
import { ensureNativeRuntime } from './check-electron-memory.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CASHIER = { email: 'cashier.norte@demo.co', password: 'Admin123!Dev' };
const ADMIN = { email: 'admin@demo.co', password: 'Admin123!Dev' };
const MAX_RECOVERY_MS = 10_000;
const MAX_SLOPE_MB_PER_HOUR = 5;
const HOUR_MS = 3_600_000;

export const SOAK_PROFILES = {
  short: {
    minutes: 20,
    saleEveryMs: 5_000,
    backupEveryMin: 5,
    crashesPerHour: 6,
    burstEveryMin: 0,
  },
  long: {
    minutes: 480,
    saleEveryMs: 20_000,
    backupEveryMin: 30,
    crashesPerHour: 1,
    burstEveryMin: 30,
  },
};

export function parseSoakArgs(argv = process.argv.slice(2)) {
  const read = name => argv.find(arg => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
  const profileName = read('profile') ?? 'short';
  const profile = SOAK_PROFILES[profileName];
  if (!profile) throw new Error(`unknown soak profile: ${profileName}`);
  const minutes = Number(read('minutes') ?? profile.minutes);
  if (!(minutes > 0)) throw new Error('--minutes must be positive');
  const crashes = Math.max(1, Math.round((minutes / 60) * profile.crashesPerHour));
  return { ...profile, profileName, minutes, crashes, out: read('out') ?? null };
}

/** Evenly spaced crash offsets, away from the start and the end of the run. */
export function planCrashes(durationMs, count) {
  return Array.from({ length: count }, (_, index) =>
    Math.round((durationMs * (index + 1)) / (count + 1))
  );
}

/** Least-squares slope of `{ hours, value }` points, in units per hour. */
export function slopePerHour(points) {
  if (points.length < 2) return 0;
  const meanX = points.reduce((sum, p) => sum + p.hours, 0) / points.length;
  const meanY = points.reduce((sum, p) => sum + p.value, 0) / points.length;
  let num = 0;
  let den = 0;
  for (const p of points) {
    num += (p.hours - meanX) * (p.value - meanY);
    den += (p.hours - meanX) ** 2;
  }
  return den === 0 ? 0 : num / den;
}

/** Working-set slope per process type over the last six hours of samples. */
export function memorySlopes(samples) {
  const last = samples.at(-1)?.at ?? 0;
  const byType = new Map();
  for (const sample of samples.filter(s => s.at >= last - 6 * HOUR_MS)) {
    const totals = new Map();
    for (const proc of sample.processes) {
      totals.set(proc.type, (totals.get(proc.type) ?? 0) + proc.workingSetMb);
    }
    for (const [type, mb] of totals) {
      if (!byType.has(type)) byType.set(type, []);
      byType.get(type).push({ hours: sample.at / HOUR_MS, value: mb });
    }
  }
  return Object.fromEntries([...byType].map(([type, points]) => [type, slopePerHour(points)]));
}

/** Pass/fail rows for the soak criteria. */
export function evaluateSoak({ run, books, samples, budget, crashLog }) {
  const rows = [];
  const add = (name, ok, detail) => rows.push({ name, ok, detail });
  add(
    'confirmed sales are in the database once',
    books.missing === 0 && books.extra === 0,
    `confirmed ${run.confirmed.length}, new in db ${books.inDb}, missing ${books.missing}, extra ${books.extra}`
  );
  add('no repeated sale numbers', books.duplicateNumbers === 0, String(books.duplicateNumbers));
  add(
    'each fiscal sale has its intent or document',
    books.salesWithoutFiscal === 0,
    `${books.salesWithoutFiscal} without (fiscal ${books.fiscalEnabled ? 'on' : 'off'})`
  );
  add(
    'no repeated fiscal consecutives',
    books.duplicateConsecutives === 0,
    String(books.duplicateConsecutives)
  );
  add('audit chain verifies', run.auditValid === true, String(run.auditValid));
  const restarted = crashLog.filter(entry => entry.outcome === 'restarted').length;
  add(
    'restarts equal injected crashes',
    restarted === run.crashes.length,
    `${restarted} restarts / ${run.crashes.length} crashes`
  );
  const slowest = Math.max(0, ...run.crashes.map(crash => crash.recoveryMs));
  add('each recovery under 10 s', slowest <= MAX_RECOVERY_MS, `${slowest} ms worst`);
  const backupStall = Math.max(0, ...run.backups.map(b => b.mainMaxStallMs ?? 0));
  add(
    'main stays responsive during backups',
    backupStall <= budget.maxStallMs,
    `${backupStall} ms worst stall, budget ${budget.maxStallMs}`
  );
  add(
    'backups succeed',
    run.backups.length > 0 && run.backups.every(b => b.ok),
    `${run.backups.filter(b => b.ok).length}/${run.backups.length}`
  );
  const slopes = memorySlopes(samples);
  const spanMs = (samples.at(-1)?.at ?? 0) - (samples[0]?.at ?? 0);
  const judged = spanMs >= 2 * HOUR_MS;
  const worst = Math.max(0, ...Object.values(slopes));
  add(
    judged
      ? 'memory slope under 5 MB/h per process type'
      : 'memory slope (reported only under 2 h)',
    !judged || worst < MAX_SLOPE_MB_PER_HOUR,
    Object.entries(slopes)
      .map(([type, slope]) => `${type} ${slope.toFixed(1)}`)
      .join(', ')
  );
  return { rows, ok: rows.every(row => row.ok), slopes };
}

function createClient(serverUrl) {
  const headers = { 'content-type': 'application/json' };
  async function call(kind, path, input, extraHeaders = {}) {
    const url =
      kind === 'query'
        ? `${serverUrl}/api/trpc/${path}?batch=1&input=${encodeURIComponent(JSON.stringify({ 0: input }))}`
        : `${serverUrl}/api/trpc/${path}?batch=1`;
    const response = await fetch(url, {
      method: kind === 'query' ? 'GET' : 'POST',
      headers: { ...headers, ...extraHeaders },
      ...(kind === 'query' ? {} : { body: JSON.stringify({ 0: input }) }),
      signal: AbortSignal.timeout(30_000),
    });
    const body = await response.json().catch(() => null);
    const entry = Array.isArray(body) ? body[0] : null;
    if (!response.ok || !entry?.result) {
      const code = entry?.error?.data?.errorCode ?? entry?.error?.data?.code ?? response.status;
      throw Object.assign(new Error(`${path} failed: ${code}`), { code, structured: !!entry });
    }
    return entry.result.data;
  }
  return { headers, call };
}

async function loadProducts(client) {
  const page = await client.call('query', 'products.list', { limit: 40, isActive: true });
  const products = [];
  for (const row of page.items) {
    if (!row.tracksStock || row.tracksLots || row.tracksSerials || !(row.stock > 0)) continue;
    const full = await client.call('query', 'products.getById', { id: row.id });
    const unit = full.unitAssignments?.find(item => item.isBase) ?? full.unitAssignments?.[0];
    const price = unit?.price ?? full.price;
    if (unit && price > 0) {
      products.push({ id: full.id, unitId: unit.unitId, price, taxRate: full.taxRate });
    }
  }
  if (products.length === 0) throw new Error('the fixture has no sellable products');
  return products;
}

const RETRYABLE_CODES = new Set(['COMMAND_IN_PROGRESS', 'COMMAND_DATABASE_BUSY']);

/** One sale that replays the same envelope until the server gives an answer. */
async function sellOnce(client, product) {
  const envelope = JSON.stringify({
    operationId: randomUUID(),
    idempotencyKey: randomUUID(),
    clientCreatedAt: new Date().toISOString(),
  });
  const input = {
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
  };
  const startedAt = performance.now();
  for (let attempts = 1; ; attempts += 1) {
    try {
      const sale = await client.call('mutation', 'sales.create', input, {
        'x-puntovivo-envelope': envelope,
      });
      return { id: sale.id, attempts, ms: performance.now() - startedAt };
    } catch (error) {
      // Only an unanswered call or a retryable code may replay the envelope.
      const retryable = !error.structured || RETRYABLE_CODES.has(error.code);
      if (!retryable || attempts >= 120) throw error;
      await delay(500);
    }
  }
}

function readBooks(dbPath, saleIds, startIso) {
  const Database = createRequire(join(REPO_ROOT, 'packages', 'server', 'package.json'))(
    'better-sqlite3'
  );
  const db = new Database(dbPath, { readonly: true });
  try {
    db.pragma("cipher='sqlcipher'");
    db.pragma('legacy = 4');
    db.pragma(`key = "x'${MEASURE_DB_KEY}'"`);
    const created = db
      .prepare('SELECT id FROM sales WHERE created_at >= ?')
      .all(startIso)
      .map(row => row.id);
    const createdSet = new Set(created);
    const confirmed = new Set(saleIds);
    const scalar = (sql, ...args) => db.prepare(sql).get(...args).n;
    return {
      inDb: created.length,
      missing: [...confirmed].filter(id => !createdSet.has(id)).length,
      extra: created.filter(id => !confirmed.has(id)).length,
      duplicateNumbers: scalar(
        'SELECT COUNT(*) AS n FROM (SELECT 1 FROM sales GROUP BY tenant_id, sale_number HAVING COUNT(*) > 1)'
      ),
      fiscalEnabled:
        scalar(
          'SELECT COUNT(*) AS n FROM fiscal_emission_intents WHERE created_at >= ?',
          startIso
        ) > 0,
      salesWithoutFiscal: scalar(
        `SELECT COUNT(*) AS n FROM sales s
         WHERE s.created_at >= ?
           AND EXISTS (SELECT 1 FROM fiscal_emission_intents i
                       WHERE i.tenant_id = s.tenant_id AND i.created_at >= ?)
           AND NOT EXISTS (SELECT 1 FROM fiscal_emission_intents i WHERE i.sale_id = s.id)
           AND NOT EXISTS (SELECT 1 FROM fiscal_documents d WHERE d.source_id = s.id)`,
        startIso,
        startIso
      ),
      duplicateConsecutives: scalar(
        'SELECT COUNT(*) AS n FROM (SELECT 1 FROM fiscal_documents GROUP BY resolution_id, consecutive HAVING COUNT(*) > 1)'
      ),
    };
  } finally {
    db.close();
  }
}

/** Time until `/api/health` answers again, from `sinceMs`. */
async function timeToHealthy(serverUrl, sinceMs) {
  while (performance.now() - sinceMs < 60_000) {
    try {
      const response = await fetch(`${serverUrl}/api/health`, {
        signal: AbortSignal.timeout(1_000),
      });
      if (response.ok) return performance.now() - sinceMs;
    } catch {
      // still restarting
    }
    await delay(100);
  }
  return Infinity;
}

/** Waits until the old worker is gone, so a fast health check is not the dead one's. */
async function waitForCrashEvent(events, count) {
  const deadline = performance.now() + 15_000;
  while (events.filter(e => e.type === 'crash-injected').length < count) {
    if (performance.now() > deadline) throw new Error('the app never injected the crash');
    await delay(50);
  }
}

export async function runSoak(options) {
  if (!existsSync(ELECTRON_MAIN_ENTRY)) {
    throw new Error(`${ELECTRON_MAIN_ENTRY} missing; build the desktop main first`);
  }
  const electronBin = createRequire(DESKTOP_PACKAGE_JSON)('electron');
  const nativeLabel = { label: 'desktop-soak' };
  if (!ensureNativeRuntime('node', nativeLabel) || !ensureNativeRuntime('electron', nativeLabel)) {
    throw new Error('native runtime unavailable');
  }
  const workDir = mkdtempSync(join(tmpdir(), 'puntovivo-soak-'));
  const dbPath = join(workDir, 'fixture.db');
  const controlDir = join(workDir, 'control');
  const profileDir = join(workDir, 'profile');
  mkdirSync(controlDir);
  const out = options.out ? resolve(options.out) : join(workDir, 'out');
  mkdirSync(out, { recursive: true });
  seedFixture(dbPath);

  const isLinux = process.platform === 'linux';
  const electronArgs = [ELECTRON_MAIN_ENTRY, `--user-data-dir=${profileDir}`];
  if (isLinux) electronArgs.push('--no-sandbox');
  const child = spawn(
    isLinux ? 'xvfb-run' : electronBin,
    isLinux ? ['-a', electronBin, ...electronArgs] : electronArgs,
    {
      cwd: REPO_ROOT,
      detached: isLinux,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        PUNTOVIVO_SOAK: '1',
        PUNTOVIVO_SOAK_CONTROL_DIR: controlDir,
        DATABASE_URL: dbPath,
        PUNTOVIVO_DB_KEY: MEASURE_DB_KEY,
        PUNTOVIVO_LOG_LEVEL: 'warn',
        PUNTOVIVO_GLOBAL_RATE_LIMIT_MAX: '100000',
        // The mock fiscal provider answers slowly and fails one call in five.
        PUNTOVIVO_SOAK_FISCAL_LATENCY_MS: '250',
        PUNTOVIVO_SOAK_FISCAL_FAIL_EVERY: '5',
      },
    }
  );
  const kill = () => {
    try {
      if (isLinux && child.pid) process.kill(-child.pid, 'SIGKILL');
      else child.kill('SIGKILL');
    } catch {
      // already gone
    }
  };
  let buffered = '';
  const samples = [];
  const events = [];
  let resolveReady;
  const ready = new Promise(resolvePromise => (resolveReady = resolvePromise));
  const exited = new Promise(resolvePromise => child.once('exit', resolvePromise));
  child.stderr.on('data', chunk => process.stderr.write(chunk));
  child.stdout.on('data', chunk => {
    buffered += String(chunk);
    const lines = buffered.split('\n');
    buffered = lines.pop() ?? '';
    for (const line of lines) {
      const readyLine = parseJsonLine(line, 'PUNTOVIVO_SOAK_READY');
      if (readyLine?.serverUrl) resolveReady(readyLine.serverUrl);
      if (parseJsonLine(line, 'PUNTOVIVO_SOAK_SKIP')) resolveReady(null);
      const sample = parseJsonLine(line, 'PUNTOVIVO_SOAK_SAMPLE');
      if (sample) samples.push(sample);
      const event = parseJsonLine(line, 'PUNTOVIVO_SOAK_EVENT');
      if (event) events.push(event);
    }
  });

  try {
    const serverUrl = await Promise.race([ready, delay(240_000).then(() => null)]);
    if (!serverUrl) throw new Error('the app never reported soak readiness');
    let sequence = 0;
    const control = (name, body = '') =>
      writeFileSync(join(controlDir, `${name}-${String(++sequence).padStart(6, '0')}`), body);

    const admin = createClient(serverUrl);
    const cashier = createClient(serverUrl);
    const signIn = async (client, account) => {
      delete client.headers.authorization;
      const session = await client.call('mutation', 'auth.login', account);
      client.headers.authorization = `Bearer ${session.token}`;
      return session;
    };
    const login = await signIn(cashier, CASHIER);
    const tenantId = login.user?.tenantId;
    const device = await cashier.call('mutation', 'auth.registerDevice', {
      kind: 'desktop',
      name: 'desktop soak',
    });
    cashier.headers['x-device-id'] = device.deviceId;
    const session = await cashier.call('query', 'cashSessions.getActive', {});
    if (!session) throw new Error('the fixture cashier has no open cash session');
    cashier.headers['x-site-id'] = session.siteId;
    const products = await loadProducts(cashier);

    const durationMs = options.minutes * 60_000;
    const startIso = new Date().toISOString();
    const startedAt = performance.now();
    const crashAt = planCrashes(durationMs, options.crashes);
    const crashes = [];
    const confirmed = [];
    const failures = [];
    let nextBackupAt = options.backupEveryMin * 60_000;
    let nextBurstAt = options.burstEveryMin ? options.burstEveryMin * 60_000 : Infinity;
    let backupsRequested = 0;

    while (performance.now() - startedAt < durationMs) {
      const elapsed = performance.now() - startedAt;
      if (crashAt.length > 0 && elapsed >= crashAt[0]) {
        crashAt.shift();
        control('crash');
        await waitForCrashEvent(events, crashes.length + 1);
        const at = performance.now();
        crashes.push({
          atMs: Math.round(elapsed),
          recoveryMs: Math.round(await timeToHealthy(serverUrl, at)),
        });
      }
      if (elapsed >= nextBackupAt) {
        nextBackupAt += options.backupEveryMin * 60_000;
        backupsRequested += 1;
        control('backup', tenantId);
      }
      const burst = elapsed >= nextBurstAt ? 10 : 1;
      if (burst > 1) nextBurstAt += options.burstEveryMin * 60_000;
      for (let i = 0; i < burst; i += 1) {
        const product = products[confirmed.length % products.length];
        try {
          confirmed.push(
            await sellOnce(cashier, product).catch(async error => {
              // An expired access token is refused before the command runs,
              // so a fresh session may sell again under a new envelope.
              if (error.code !== 'UNAUTHORIZED') throw error;
              await signIn(cashier, CASHIER);
              return sellOnce(cashier, product);
            })
          );
        } catch (error) {
          failures.push(String(error.message));
          if (failures.length > 20) throw error;
        }
      }
      await delay(options.saleEveryMs);
    }

    // One last backup, so even a run shorter than the interval ends with a bundle.
    backupsRequested += 1;
    control('backup', tenantId);
    const backupDeadline = performance.now() + 600_000;
    while (
      events.filter(e => e.type === 'backup').length < backupsRequested &&
      performance.now() < backupDeadline
    ) {
      await delay(1_000);
    }
    let auditValid = null;
    try {
      await signIn(admin, ADMIN);
      auditValid = (await admin.call('query', 'auditLogs.verifyChain', {})).valid;
    } catch (error) {
      failures.push(`audit verify: ${error.message}`);
    }
    control('quit');
    await Promise.race([exited, delay(120_000)]);

    const crashLogPath = join(profileDir, 'worker-crashes.ndjson');
    const crashLog = existsSync(crashLogPath)
      ? readFileSync(crashLogPath, 'utf8')
          .split('\n')
          .filter(Boolean)
          .map(line => JSON.parse(line))
      : [];
    const books = readBooks(
      dbPath,
      confirmed.map(sale => sale.id),
      startIso
    );
    const budget = readMainThreadBudget(
      JSON.parse(readFileSync(join(REPO_ROOT, 'perf-budget.json'), 'utf8'))
    );
    const backups = events.filter(e => e.type === 'backup');
    const verdict = evaluateSoak({
      run: { confirmed, crashes, backups, auditValid },
      books,
      samples,
      budget,
      crashLog,
    });
    const latencies = confirmed.map(sale => sale.ms).sort((a, b) => a - b);
    const summary = {
      profile: options.profileName,
      minutes: options.minutes,
      platform: process.platform,
      sales: confirmed.length,
      saleP50Ms: Math.round(latencies[Math.floor(latencies.length / 2)] ?? 0),
      saleP95Ms: Math.round(latencies[Math.floor(latencies.length * 0.95)] ?? 0),
      retriedSales: confirmed.filter(sale => sale.attempts > 1).length,
      crashes,
      backups,
      failures: failures.slice(0, 10),
      books,
      slopes: verdict.slopes,
      rows: verdict.rows,
      ok: verdict.ok,
    };
    writeFileSync(join(out, 'summary.json'), JSON.stringify(summary, null, 2));
    writeFileSync(join(out, 'samples.ndjson'), samples.map(s => JSON.stringify(s)).join('\n'));
    return summary;
  } finally {
    kill();
    if (!options.out) rmSync(workDir, { recursive: true, force: true });
  }
}

export function renderSoakReport(summary) {
  return [
    `Desktop soak ${summary.ok ? 'PASS' : 'FAIL'} (${summary.profile}, ${summary.minutes} min, ${summary.platform})`,
    `sales ${summary.sales}, p50 ${summary.saleP50Ms} ms, p95 ${summary.saleP95Ms} ms, retried ${summary.retriedSales}`,
    '',
    '| criterion | result | detail |',
    '| --- | --- | --- |',
    ...summary.rows.map(row => `| ${row.name} | ${row.ok ? 'pass' : 'FAIL'} | ${row.detail} |`),
  ].join('\n');
}

const isDirectInvocation =
  process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirectInvocation) {
  try {
    const summary = await runSoak(parseSoakArgs());
    console.log(renderSoakReport(summary));
    process.exit(summary.ok ? 0 : 1);
  } catch (error) {
    console.error(`desktop-soak: FAIL — ${error.message}`);
    process.exit(1);
  }
}
