#!/usr/bin/env node
/**
 * Fixture for the target-hardware harness self-test in build-desktop.yml.
 *
 *   seed  --profile <dir> --barcodes <file>   demo data in a throwaway profile
 *   login --port <devtools port>              signs the demo cashier in
 *   check --run <dir> --min-sales <n>         asserts the run folder is complete
 *
 * The packaged app accepts PUNTOVIVO_DB_KEY only with PUNTOVIVO_E2E=1, which
 * the harness sets for -TestProfile. Never point --profile at a real profile.
 *
 * @module scripts/target-hardware/ci-fixture
 */

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import process from 'node:process';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SERVER = path.join(ROOT, 'packages', 'server');
const SEED_SCRIPT = path.join(SERVER, 'dist', 'scripts', 'seed-dev.js');
const SEED_MODULE = path.join(SERVER, 'dist', 'db', 'seed-dev.js');
const CASHIER = 'cashier.norte@demo.co';
const VERDICT_IDS = ['U1', 'U2', 'U3', 'U4', 'U5', 'U6', 'U7', 'U8'];

function option(name) {
  const index = process.argv.indexOf(name);
  const value = index > 0 ? process.argv[index + 1] : undefined;
  if (!value) throw new Error(`missing ${name}`);
  return value;
}

function testKey() {
  const key = process.env.PUNTOVIVO_DB_KEY ?? '';
  if (!/^[0-9a-f]{64}$/iu.test(key))
    throw new Error('PUNTOVIVO_DB_KEY must be a throwaway 64-hex key');
  return key;
}

function seed() {
  const profile = path.resolve(option('--profile'));
  const barcodesFile = path.resolve(option('--barcodes'));
  const key = testKey();
  if (!existsSync(SEED_SCRIPT))
    throw new Error(`${SEED_SCRIPT} is missing; build @puntovivo/server first`);
  const dbPath = path.join(profile, 'data', 'local.db');
  if (existsSync(dbPath)) throw new Error(`${dbPath} already exists; use a fresh profile`);
  mkdirSync(path.dirname(dbPath), { recursive: true });
  const run = spawnSync(process.execPath, [SEED_SCRIPT], {
    cwd: SERVER,
    encoding: 'utf8',
    timeout: 300_000,
    env: {
      ...process.env,
      DATABASE_URL: dbPath,
      PUNTOVIVO_DB_KEY: key,
      PUNTOVIVO_LOG_LEVEL: 'warn',
      PUNTOVIVO_SUPPRESS_CREDENTIAL_BANNER: 'true',
    },
  });
  if (run.status !== 0)
    throw new Error(`seed failed (${run.status}): ${(run.stderr || run.stdout).slice(-2000)}`);

  const Database = createRequire(path.join(SERVER, 'package.json'))('better-sqlite3');
  const db = new Database(dbPath);
  let barcodes;
  try {
    db.pragma("cipher='sqlcipher'");
    db.pragma('legacy = 4');
    db.pragma(`key = "x'${key}'"`);
    // A short soak outsells the demo stock; same reset as the main-thread gate.
    db.transaction(() => {
      db.prepare('UPDATE inventory_balances SET on_hand = 1000000').run();
      db.prepare(
        'UPDATE products SET inventory_value_cents = NULL, cogs_value_cents = NULL, valuation_quantity = NULL'
      ).run();
    })();
    barcodes = db
      .prepare(
        `SELECT p.barcode FROM products p JOIN users u ON u.tenant_id = p.tenant_id
         WHERE u.email = ? AND p.is_active = 1 AND p.barcode IS NOT NULL AND length(p.barcode) >= 6
           AND p.tracks_stock = 1 AND p.tracks_lots = 0 AND p.tracks_serials = 0
           AND p.sell_by_fraction = 0 AND p.catalog_type = 'standard' AND p.price > 0
         ORDER BY p.barcode LIMIT 40`
      )
      .all(CASHIER)
      .map(row => row.barcode);
  } finally {
    db.close();
  }
  if (barcodes.length < 3)
    throw new Error(`only ${barcodes.length} sellable barcodes in the demo seed`);
  writeFileSync(barcodesFile, `${barcodes.join('\r\n')}\r\n`);
  console.log(`[ci-fixture] seeded ${dbPath}; ${barcodes.length} barcodes in ${barcodesFile}`);
}

async function login() {
  const port = Number(option('--port'));
  const { chromium } = await import('@playwright/test');
  const { DEV_USER_PASSWORD } = await import(pathToFileURL(SEED_MODULE).href);
  const deadline = Date.now() + 300_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/version`, {
        signal: AbortSignal.timeout(1000),
      });
      if (response.ok) break;
    } catch {
      // DevTools is not listening yet.
    }
    await delay(500);
  }
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  try {
    const context = browser.contexts()[0];
    let page = null;
    while (!page && Date.now() < deadline) {
      page = context
        .pages()
        .find(p => p.url().startsWith('puntovivo-app:') && !p.url().includes('customer-display'));
      if (!page) await delay(500);
    }
    if (!page) throw new Error('no Puntovivo page');
    const pos = page.locator('#sales-product-search-input');
    const email = page.locator('#email');
    await page
      .locator('#email, #sales-product-search-input')
      .first()
      .waitFor({ state: 'visible', timeout: 180_000 });
    if (await email.isVisible()) {
      await email.fill(CASHIER);
      await page.locator('#password').fill(DEV_USER_PASSWORD);
      await page.locator('#password').press('Enter');
    }
    await pos.waitFor({ state: 'visible', timeout: 120_000 });
    console.log(`[ci-fixture] ${CASHIER} is on ${new URL(page.url()).hash}`);
  } finally {
    // Disconnects only; the app keeps running for the harness.
    await browser.close();
  }
}

function parseCsv(file) {
  const text = readFileSync(file, 'utf8');
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') {
      row.push(cell);
      cell = '';
    } else if (c === '\n') {
      row.push(cell.replace(/\r$/u, ''));
      rows.push(row);
      row = [];
      cell = '';
    } else cell += c;
  }
  if (cell || row.length) rows.push([...row, cell]);
  const [header, ...body] = rows;
  return body.map(values => Object.fromEntries(header.map((name, i) => [name, values[i] ?? ''])));
}

function check() {
  const dir = path.resolve(option('--run'));
  const minSales = Number(option('--min-sales'));
  const problems = [];
  const read = name => {
    const file = path.join(dir, name);
    if (!existsSync(file)) {
      problems.push(`${name} is missing`);
      return [];
    }
    return parseCsv(file);
  };
  const summaryFile = path.join(dir, 'summary.json');
  const summary = existsSync(summaryFile) ? JSON.parse(readFileSync(summaryFile, 'utf8')) : null;
  if (!summary) problems.push('summary.json is missing');
  const ids = summary?.verdicts?.map(v => v.id) ?? [];
  for (const id of VERDICT_IDS)
    if (!ids.includes(id)) problems.push(`summary.json has no ${id} verdict`);
  for (const v of summary?.verdicts ?? []) {
    if (!['PASS', 'FAIL', 'SKIP'].includes(v.status))
      problems.push(`${v.id} has status ${v.status}`);
  }

  const startup = read('startup.csv');
  if (!startup.some(r => Number(r.login_ready_ms) > 0))
    problems.push('startup.csv has no login time');
  const samples = read('samples.csv');
  for (const role of ['main', 'renderer', 'harness']) {
    if (!samples.some(r => r.role === role && Number(r.working_set_mb) > 0))
      problems.push(`samples.csv has no ${role} rows`);
  }
  const system = read('system.csv');
  if (system.filter(r => r.avail_mb !== '').length < 30)
    problems.push('system.csv has fewer than 30 samples with free memory');
  const renderer = read('renderer.csv');
  if (!renderer.some(r => Number(r.ipc_count) > 0))
    problems.push('renderer.csv has no IPC round trips');
  const sales = read('sales.csv').filter(r => r.mode === 'drive');
  const ok = sales.filter(r => r.status === 'ok');
  if (ok.length < minSales)
    problems.push(`${ok.length} simulated sales completed, expected ${minSales} or more`);

  const meta = summary?.phases?.soak ?? {};
  console.log(
    `[ci-fixture] ${ok.length}/${sales.length} simulated sales ok, input ${meta.input ?? 'unknown'}, ` +
      `result ${summary?.result ?? 'none'}: ${(summary?.verdicts ?? []).map(v => `${v.id} ${v.status}`).join(', ')}`
  );
  if (problems.length)
    throw new Error(`run folder ${dir} is incomplete:\n- ${problems.join('\n- ')}`);
}

const commands = { seed, login, check };
const command = commands[process.argv[2]];
if (!command) {
  console.error('usage: ci-fixture.mjs seed|login|check ...');
  process.exit(2);
}
try {
  await command();
} catch (error) {
  console.error(`[ci-fixture] ${error.message}`);
  process.exit(1);
}
