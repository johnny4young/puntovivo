#!/usr/bin/env node
/**
 * ENG-133c — Lighthouse web-vitals CI gate (warn-first, LOCAL).
 *
 * Launches a real Chromium (via Playwright), logs in once (so authenticated
 * routes can be measured), and runs Lighthouse against each top user-facing
 * route, comparing LCP / TTI / CLS / performance-score against the budget in
 * the repo's `perf-budget.json` (`lighthouse` section).
 *
 * This is the FOURTH metric of the ENG-133 perf-budget engine, mirroring
 * `check-electron-memory.mjs`: WARN-FIRST + SELF-SKIPPING for local operator
 * diagnostics, and hard-fail in CI when `--strict --require-measurement` is
 * passed by `run-lighthouse-gate.mjs`.
 *
 * Auth note: the web access token lives in-memory (`apps/web/src/lib/trpc.ts`),
 * but the refresh token is an httpOnly cookie (`auth.ts`). Lighthouse runs with
 * `disableStorageReset:true` so the cookie survives each navigation and the app
 * re-auths via `auth.refresh` — which is what makes authenticated-route
 * measurement work in a fresh tab.
 *
 * Exit codes:
 *   0 — within budget, OR warn-first over-budget, OR self-skipped.
 *   1 — `--strict` and a metric regressed, `--require-measurement` and a
 *       measurement / metric is missing, OR perf-budget.json is malformed.
 *
 * @module scripts/check-lighthouse
 */

import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const BUDGET_PATH = join(REPO_ROOT, 'perf-budget.json');

/** Web dev server the e2e suite serves on. */
const BASE_URL = process.env.PUNTOVIVO_LIGHTHOUSE_BASE_URL || 'http://localhost:3000';
/** CDP port Lighthouse attaches to (Playwright exposes it via the launch arg). */
const CDP_PORT = Number(process.env.PUNTOVIVO_LIGHTHOUSE_CDP_PORT || 9222);
/**
 * Demo-seed admin — from docs/DEV-SEED.md. The dev seed (`pnpm run seed:dev`)
 * populates `local.db` with the rich `demo-co` tenant so the measured routes
 * render REAL content (products, sales, dashboard), which is more
 * representative than the empty e2e baseline. NEVER invented. Override both via
 * env for a different seed.
 */
const CREDENTIALS = {
  email: process.env.PUNTOVIVO_LIGHTHOUSE_EMAIL || 'admin@demo.co',
  password: process.env.PUNTOVIVO_LIGHTHOUSE_PASSWORD || 'Admin123!Dev',
};

/**
 * The routes the gate measures. `auth:true` routes are only measured after a
 * successful login; `auth:false` routes (the public login screen) are measured
 * regardless, so the gate still yields a baseline when login fails.
 */
const ROUTES = [
  { key: 'login', path: '/login', auth: false },
  { key: 'dashboard', path: '/dashboard', auth: true },
  { key: 'sales', path: '/sales', auth: true },
  { key: 'products', path: '/products', auth: true },
];

/**
 * Per-metric optimisation direction. `lower` metrics (load timings, layout
 * shift) regress when they grow past the ceiling; `higher` metrics (the 0-100
 * performance score) regress when they drop below the floor.
 */
const METRIC_DIRECTION = {
  lcpMs: 'lower',
  ttiMs: 'lower',
  cls: 'lower',
  score: 'higher',
};

const METRIC_UNIT = { lcpMs: 'ms', ttiMs: 'ms', cls: '', score: '' };

/**
 * Pull the four tracked metrics out of a Lighthouse result object (`lhr`).
 * Pure + fixture-testable: it never touches a browser. Missing audits map to
 * `null` so the comparison reports them as `missing` rather than crashing.
 */
export function extractMetrics(lhr) {
  const audits = lhr?.audits ?? {};
  const numeric = id => {
    const value = audits[id]?.numericValue;
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
  };
  const lcp = numeric('largest-contentful-paint');
  const tti = numeric('interactive');
  const cls = numeric('cumulative-layout-shift');
  const score = lhr?.categories?.performance?.score;
  return {
    lcpMs: lcp === null ? null : Math.round(lcp),
    ttiMs: tti === null ? null : Math.round(tti),
    cls: cls === null ? null : Math.round(cls * 1000) / 1000,
    score: typeof score === 'number' ? Math.round(score * 100) : null,
  };
}

/**
 * Compare measured `{ route: { lcpMs, ttiMs, cls, score } }` against the budget
 * of the same shape. `lower` metrics regress past `budget * (1 + t/100)`;
 * the normalised `score` regresses below its exact declared floor. A budgeted
 * route or metric with no measurement lands in `missing` (warning-only).
 */
export function compareToLighthouseBudget({ measured, budget, thresholdPercent }) {
  const result = { regressions: [], ok: [], missing: [] };
  for (const route of Object.keys(budget)) {
    const measuredRoute = measured[route];
    if (!measuredRoute) {
      result.missing.push({ route, metric: '*' });
      continue;
    }
    for (const metric of Object.keys(budget[route])) {
      const budgetValue = budget[route][metric];
      const actual = measuredRoute[metric];
      if (actual === undefined || actual === null) {
        result.missing.push({ route, metric, budget: budgetValue });
        continue;
      }
      const direction = METRIC_DIRECTION[metric] ?? 'lower';
      const deltaPercent =
        budgetValue === 0
          ? actual === 0
            ? 0
            : Infinity
          : ((actual - budgetValue) / budgetValue) * 100;
      let isRegression;
      if (direction === 'lower') {
        isRegression = actual > budgetValue * (1 + thresholdPercent / 100);
      } else {
        // ENG-200 — score is already a 0-100 quality floor, not a noisy raw
        // duration. Applying the generic tolerance made a checked score of 58
        // permit a route to fall to 40.6. Treat the declared score as the exact
        // minimum while timing/CLS metrics retain their variance allowance.
        isRegression = actual < budgetValue;
      }
      const row = { route, metric, budget: budgetValue, actual, deltaPercent, direction };
      if (isRegression) result.regressions.push(row);
      else result.ok.push(row);
    }
  }
  return result;
}

/** Render one metric row, e.g. `dashboard.lcpMs | 1800 ms | 1750 ms | -2.8%`. */
function renderRow(row) {
  const unit = METRIC_UNIT[row.metric] ?? '';
  const suffix = unit ? ` ${unit}` : '';
  const sign = row.deltaPercent >= 0 ? '+' : '';
  const delta = Number.isFinite(row.deltaPercent) ? `${sign}${row.deltaPercent.toFixed(1)}%` : 'n/a';
  return `| ${row.route}.${row.metric} | ${row.budget}${suffix} | ${row.actual}${suffix} | ${delta} |`;
}

/** Render the comparison as a markdown table for the CI / local log. */
export function renderReport({ regressions, ok, missing }, threshold) {
  const lines = [];
  if (regressions.length > 0) {
    lines.push(
      `Lighthouse regression (score uses its exact floor; other metrics allow ${threshold}% variance):`
    );
    lines.push('| metric | budget | actual | delta |');
    lines.push('| --- | ---: | ---: | ---: |');
    for (const r of regressions) lines.push(renderRow(r));
  }
  if (missing.length > 0) {
    if (lines.length) lines.push('');
    lines.push('Budgeted routes/metrics with no measurement (warning):');
    for (const m of missing) lines.push(`  - ${m.route}.${m.metric}`);
  }
  if (regressions.length === 0 && ok.length > 0) {
    lines.push('Lighthouse PASS — web vitals within budget:');
    lines.push('| metric | budget | actual | delta |');
    lines.push('| --- | ---: | ---: | ---: |');
    for (const o of ok) lines.push(renderRow(o));
  }
  return lines.join('\n');
}

/** Lightweight reachability probe for the dev web server. */
async function isServing(url) {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    try {
      const response = await fetch(url, { signal: controller.signal });
      return response.ok;
    } finally {
      clearTimeout(timeout);
    }
  } catch {
    return false;
  }
}

/**
 * Launch Chromium (Playwright), log in once, and run Lighthouse against every
 * route. Returns `{ route: { lcpMs, ttiMs, cls, score } }` or `null` when the
 * measurement is infeasible (no playwright/lighthouse, server down, browser
 * launch failure, or no route produced a result) — every `null` path prints a
 * WARN first so the CLI can self-skip warn-first.
 */
export async function launchAndMeasure() {
  let chromium;
  let lighthouse;
  try {
    ({ chromium } = await import('playwright'));
    lighthouse = (await import('lighthouse')).default;
  } catch (err) {
    console.warn(`check-lighthouse: WARN skipped — playwright/lighthouse not available: ${err.message}`);
    return null;
  }

  if (!(await isServing(`${BASE_URL}/login`))) {
    console.warn(
      `check-lighthouse: WARN skipped — ${BASE_URL} is not serving. Boot dev:server + dev:web and seed local.db first (see docs/PERF-BUDGETS.md).`
    );
    return null;
  }

  const userDataDir = mkdtempSync(join(tmpdir(), 'puntovivo-lh-'));
  let context;
  try {
    context = await chromium.launchPersistentContext(userDataDir, {
      headless: true,
      args: [`--remote-debugging-port=${CDP_PORT}`, '--no-sandbox'],
    });

    const page = context.pages()[0] ?? (await context.newPage());

    // Login once so the refresh cookie is set for the authenticated routes.
    let loggedIn = false;
    try {
      await page.goto(`${BASE_URL}/login`, { waitUntil: 'load', timeout: 30_000 });
      await page.fill('#email', CREDENTIALS.email);
      await page.fill('#password', CREDENTIALS.password);
      await page.getByRole('button', { name: /Enter workspace|Entrar al espacio/ }).click();
      await page.waitForURL(/\/(dashboard|sales)(?:$|\?)/, { timeout: 30_000 });
      loggedIn = true;
    } catch (err) {
      console.warn(
        `check-lighthouse: WARN — login failed (${err.message}); measuring anonymous routes only.`
      );
    }

    // Warm up each route first. The Vite dev server compiles route modules
    // on-demand, so the FIRST visit to a route is dominated by compilation
    // (10s+) while warm visits are stable (~3s). Measuring cold would make the
    // baseline meaningless; this primes Vite's module cache before Lighthouse
    // measures — same intent as the warmupIterations in the latency gate.
    for (const route of ROUTES) {
      if (route.auth && !loggedIn) continue;
      try {
        await page.goto(`${BASE_URL}${route.path}`, { waitUntil: 'networkidle', timeout: 45_000 });
      } catch {
        /* warmup is best-effort; the measured pass will surface a real failure */
      }
    }

    const measured = {};
    for (const route of ROUTES) {
      if (route.auth && !loggedIn) continue;
      try {
        const runnerResult = await lighthouse(
          `${BASE_URL}${route.path}`,
          { port: CDP_PORT, output: 'json', logLevel: 'error' },
          {
            extends: 'lighthouse:default',
            settings: {
              onlyCategories: ['performance'],
              // Preserve the refresh cookie across the navigation so the app
              // re-auths (the access token is in-memory and is lost on reload).
              disableStorageReset: true,
              formFactor: 'desktop',
              screenEmulation: { disabled: true },
            },
          }
        );
        if (runnerResult?.lhr) {
          measured[route.key] = extractMetrics(runnerResult.lhr);
        } else {
          console.warn(`check-lighthouse: WARN — route ${route.path} produced no Lighthouse result.`);
        }
      } catch (err) {
        console.warn(`check-lighthouse: WARN — route ${route.path} failed: ${err.message}`);
      }
    }

    if (Object.keys(measured).length === 0) {
      console.warn('check-lighthouse: WARN skipped — no route produced a Lighthouse result.');
      return null;
    }
    return measured;
  } catch (err) {
    console.warn(`check-lighthouse: WARN skipped — browser launch failed: ${err.message}`);
    return null;
  } finally {
    if (context) {
      try {
        await context.close();
      } catch {
        /* best effort */
      }
    }
    try {
      rmSync(userDataDir, { recursive: true, force: true });
    } catch {
      /* leave the temp dir for the OS to reap */
    }
  }
}

/**
 * CLI entry. Reads `perf-budget.json::lighthouse`, measures, compares, prints
 * the report. Warn-first by default; `--strict` / `PUNTOVIVO_LIGHTHOUSE_STRICT=1`
 * makes an over-budget metric exit 1, while `--require-measurement` /
 * `PUNTOVIVO_LIGHTHOUSE_REQUIRE_MEASUREMENT=1` makes missing proof exit 1.
 */
export async function runCli({ measure = launchAndMeasure, strict, requireMeasurement } = {}) {
  const enforce =
    strict ?? (process.argv.includes('--strict') || process.env.PUNTOVIVO_LIGHTHOUSE_STRICT === '1');
  const requireProof =
    requireMeasurement ??
    (process.argv.includes('--require-measurement') ||
      process.env.PUNTOVIVO_LIGHTHOUSE_REQUIRE_MEASUREMENT === '1');
  let budgetFile;
  try {
    budgetFile = JSON.parse(readFileSync(BUDGET_PATH, 'utf8'));
  } catch (err) {
    console.error(`check-lighthouse: cannot read budget file at ${BUDGET_PATH}: ${err.message}`);
    return 1;
  }
  const budget = budgetFile?.lighthouse?.perRoute;
  const thresholdPercent = budgetFile?.lighthouse?.thresholdPercent;
  if (!budget || typeof thresholdPercent !== 'number') {
    console.error('check-lighthouse: perf-budget.json is missing lighthouse.perRoute or lighthouse.thresholdPercent');
    return 1;
  }

  const measured = await measure();
  if (!measured) {
    // Self-skip: the warning was already printed by launchAndMeasure.
    if (requireProof) {
      console.error('check-lighthouse: FAIL (--require-measurement) — no Lighthouse measurement was produced.');
      return 1;
    }
    return 0;
  }

  // Echo the raw measurement so the operator can copy it into the budget when
  // (re)capturing a baseline — the report below only surfaces regressions/PASS.
  console.log(`check-lighthouse: measured = ${JSON.stringify(measured)}`);

  const result = compareToLighthouseBudget({ measured, budget, thresholdPercent });
  const report = renderReport(result, thresholdPercent);
  console.log(report);

  if (result.missing.length > 0 && requireProof) {
    console.error(
      'check-lighthouse: FAIL (--require-measurement) — a budgeted route or metric was not measured.'
    );
    return 1;
  }
  if (result.regressions.length > 0 && enforce) {
    console.error('check-lighthouse: FAIL (--strict) — a web-vital regressed past budget.');
    return 1;
  }
  if (result.regressions.length > 0) {
    console.warn('check-lighthouse: WARN — over the web-vitals budget (warn-first; pass --strict to enforce).');
  }
  return 0;
}

// Direct invocation guard — when imported by the test suite the CLI must NOT
// execute.
const isDirectInvocation =
  process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirectInvocation) {
  runCli()
    .then(code => process.exit(code))
    .catch(err => {
      const requireProof =
        process.argv.includes('--require-measurement') ||
        process.env.PUNTOVIVO_LIGHTHOUSE_REQUIRE_MEASUREMENT === '1';
      console.warn(`check-lighthouse: WARN skipped — unexpected error: ${err?.message ?? err}`);
      process.exit(requireProof ? 1 : 0);
    });
}
