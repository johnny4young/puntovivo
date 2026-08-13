#!/usr/bin/env node
/**
 * Lighthouse web-vitals CI gate (warn-first, LOCAL).
 *
 * Launches a real Chromium (via Playwright), logs in once (so authenticated
 * routes can be measured), and runs Lighthouse against each top user-facing
 * route, comparing LCP / TTI / CLS / performance-score against the budget in
 * the repo's `perf-budget.json` (`lighthouse` section).
 *
 * This is the FOURTH metric of the  perf-budget engine, mirroring
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
 * 0 — within budget, OR warn-first over-budget, OR self-skipped.
 * 1 — `--strict` and a metric regressed, `--require-measurement` and a
 * measurement / metric is missing, OR perf-budget.json is malformed.
 *
 * @module scripts/check-lighthouse
 */

import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { arch, cpus, platform, release, tmpdir, totalmem } from 'node:os';
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
 * Keep calibration evidence useful without collecting a hostname or other
 * machine identity. The profile distinguishes shared CI from local hardware.
 */
export function resolveLighthouseHostProfile({ env = process.env } = {}) {
  const cpu = cpus()[0];
  return {
    runner:
      env.GITHUB_ACTIONS === 'true'
        ? env.RUNNER_ENVIRONMENT || 'github-actions'
        : env.CI
          ? 'ci'
          : 'local',
    platform: platform(),
    osRelease: release(),
    arch: arch(),
    node: process.version,
    logicalCpus: cpus().length,
    cpuModel: cpu?.model?.trim().slice(0, 80) || 'unknown',
    memoryGiB: roundTo(totalmem() / 1024 ** 3, 1),
  };
}

function medianOfSorted(values) {
  if (values.length === 0) return null;
  const middle = Math.floor(values.length / 2);
  return values.length % 2 === 1 ? values[middle] : (values[middle - 1] + values[middle]) / 2;
}

function roundTo(value, digits) {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

/**
 * Tukey hinges keep the stability summary deterministic for the gate's small,
 * odd sample set. The median itself is excluded from both halves.
 */
function scoreDistribution(values) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  const lower = sorted.slice(0, middle);
  const upper = sorted.slice(Math.ceil(sorted.length / 2));
  const q1 = medianOfSorted(lower) ?? sorted[middle];
  const q3 = medianOfSorted(upper) ?? sorted[middle];
  return {
    scoreMin: sorted[0],
    scoreMax: sorted.at(-1),
    scoreIqr: roundTo(q3 - q1, 1),
  };
}

/**
 * Reduce repeated route samples to a stable median. Lighthouse score and CPU
 * timings are noisy even on an otherwise idle workstation; one sample made an
 * exact score floor behave like a scheduler lottery. Missing metrics remain
 * null so the strict proof contract can reject them.
 */
export function aggregateRouteSamples(samples) {
  const aggregated = {};
  for (const metric of Object.keys(METRIC_DIRECTION)) {
    const values = samples
      .map(sample => sample?.[metric])
      .filter(value => typeof value === 'number' && Number.isFinite(value))
      .sort((a, b) => a - b);
    // A median is only valid when every requested sample produced the metric.
    // Dropping one partial Lighthouse result would let --require-measurement
    // pass on less evidence than the configured sample count promises.
    if (samples.length === 0 || values.length !== samples.length) {
      aggregated[metric] = null;
      continue;
    }
    const median = medianOfSorted(values);
    aggregated[metric] = metric === 'cls' ? Math.round(median * 1000) / 1000 : Math.round(median);
  }
  const scores = samples
    .map(sample => sample?.score)
    .filter(value => typeof value === 'number' && Number.isFinite(value));
  aggregated.sampleCount = samples.length;
  Object.assign(
    aggregated,
    samples.length > 0 && scores.length === samples.length
      ? scoreDistribution(scores)
      : { scoreMin: null, scoreMax: null, scoreIqr: null }
  );
  return aggregated;
}

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
 * Extra performance signals printed for diagnosis but not budgeted directly.
 * The score can regress while LCP/TTI/CLS remain healthy (for example, when
 * Total Blocking Time rises), so keeping these in the gate log makes the root
 * cause visible instead of leaving operators with only an opaque score.
 */
export function extractDiagnostics(lhr) {
  const audits = lhr?.audits ?? {};
  const rounded = id => {
    const value = audits[id]?.numericValue;
    return typeof value === 'number' && Number.isFinite(value) ? Math.round(value) : null;
  };
  const topBootupScripts = [...(audits['bootup-time']?.details?.items ?? [])]
    .filter(item => typeof item?.total === 'number')
    .sort((a, b) => b.total - a.total)
    .slice(0, 5)
    .map(item => ({
      url: String(item.url ?? '').replace(BASE_URL, ''),
      totalMs: Math.round(item.total),
      scriptingMs:
        typeof item.scripting === 'number' && Number.isFinite(item.scripting)
          ? Math.round(item.scripting)
          : null,
    }));
  return {
    fcpMs: rounded('first-contentful-paint'),
    speedIndexMs: rounded('speed-index'),
    tbtMs: rounded('total-blocking-time'),
    mainThreadWorkMs: rounded('mainthread-work-breakdown'),
    bootupTimeMs: rounded('bootup-time'),
    topBootupScripts,
  };
}

/**
 * Compare measured `{ route: { lcpMs, ttiMs, cls, score } }` against the budget
 * of the same shape. `lower` metrics regress past `budget * (1 + t/100)`;
 * the normalised `score` regresses below its explicit absolute variance band.
 * A budgeted route or metric with no measurement lands in `missing`. Score
 * uses a small absolute point band rather than the generic percentage
 * threshold, and a score distribution above the configured IQR limit lands in
 * `unstable` only when its observed range crosses the enforced floor;
 * otherwise the noisy but conclusive result lands in `volatile` for diagnosis.
 */
export function compareToLighthouseBudget({
  measured,
  budget,
  thresholdPercent,
  scoreTolerancePoints = 0,
  maxScoreIqrPoints = Number.POSITIVE_INFINITY,
  expectedSamplesPerRoute,
}) {
  const result = {
    regressions: [],
    ok: [],
    missing: [],
    unstable: [],
    volatile: [],
    varianceAccepted: [],
  };
  for (const route of Object.keys(budget)) {
    const measuredRoute = measured[route];
    if (!measuredRoute) {
      result.missing.push({ route, metric: '*' });
      continue;
    }
    if (
      expectedSamplesPerRoute !== undefined &&
      measuredRoute.sampleCount !== expectedSamplesPerRoute
    ) {
      result.missing.push({
        route,
        metric: 'sampleCount',
        budget: expectedSamplesPerRoute,
        actual: measuredRoute.sampleCount ?? null,
      });
    }
    if (Object.hasOwn(budget[route], 'score')) {
      const scoreFloor = budget[route].score - scoreTolerancePoints;
      if (typeof measuredRoute.scoreIqr !== 'number' || !Number.isFinite(measuredRoute.scoreIqr)) {
        if (Number.isFinite(maxScoreIqrPoints)) {
          result.missing.push({ route, metric: 'scoreIqr', budget: maxScoreIqrPoints });
        }
      } else if (measuredRoute.scoreIqr > maxScoreIqrPoints) {
        const row = {
          route,
          scoreIqr: measuredRoute.scoreIqr,
          maxScoreIqrPoints,
          enforcedFloor: scoreFloor,
          sampleCount: measuredRoute.sampleCount ?? null,
          scoreMin: measuredRoute.scoreMin ?? null,
          scoreMax: measuredRoute.scoreMax ?? null,
        };
        const hasValidRange =
          typeof row.scoreMin === 'number' &&
          Number.isFinite(row.scoreMin) &&
          typeof row.scoreMax === 'number' &&
          Number.isFinite(row.scoreMax) &&
          row.scoreMin <= measuredRoute.score &&
          measuredRoute.score <= row.scoreMax;
        if (!hasValidRange) {
          result.missing.push({ route, metric: 'scoreRange' });
        } else if (row.scoreMin < scoreFloor && row.scoreMax >= scoreFloor) {
          result.unstable.push(row);
        } else {
          result.volatile.push(row);
        }
      }
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
      let enforcedLimit;
      if (direction === 'lower') {
        enforcedLimit = budgetValue * (1 + thresholdPercent / 100);
        isRegression = actual > enforcedLimit;
      } else {
        // Lighthouse score is a rounded, CPU-sensitive composite. Keep its
        // declared floor visible, but permit only the small, explicit absolute
        // point band calibrated from release-line shared-runner evidence. This is
        // intentionally not the generic percentage tolerance: 30% would turn
        // a floor of 70 into 49 and hide real regressions.
        enforcedLimit = budgetValue - scoreTolerancePoints;
        isRegression = actual < enforcedLimit;
      }
      const row = {
        route,
        metric,
        budget: budgetValue,
        enforcedLimit,
        actual,
        deltaPercent,
        direction,
      };
      if (isRegression) result.regressions.push(row);
      else if (direction === 'higher' && actual < budgetValue) result.varianceAccepted.push(row);
      else result.ok.push(row);
    }
  }
  return result;
}

/** Keep the checked-in statistical contract bounded and intentionally odd. */
export function isValidLighthousePolicy({
  budget,
  thresholdPercent,
  samplesPerRoute,
  scoreTolerancePoints,
  maxScoreIqrPoints,
}) {
  return (
    budget !== null &&
    typeof budget === 'object' &&
    !Array.isArray(budget) &&
    Object.keys(budget).length > 0 &&
    typeof thresholdPercent === 'number' &&
    Number.isFinite(thresholdPercent) &&
    thresholdPercent >= 0 &&
    thresholdPercent <= 100 &&
    Number.isInteger(samplesPerRoute) &&
    samplesPerRoute >= 5 &&
    samplesPerRoute <= 9 &&
    samplesPerRoute % 2 === 1 &&
    Number.isInteger(scoreTolerancePoints) &&
    scoreTolerancePoints >= 0 &&
    scoreTolerancePoints <= 5 &&
    typeof maxScoreIqrPoints === 'number' &&
    Number.isFinite(maxScoreIqrPoints) &&
    maxScoreIqrPoints >= 0 &&
    maxScoreIqrPoints <= 10
  );
}

/** Render one metric row, e.g. `dashboard.lcpMs | 1800 ms | 1750 ms | -2.8%`. */
function renderRow(row) {
  const unit = METRIC_UNIT[row.metric] ?? '';
  const suffix = unit ? ` ${unit}` : '';
  const sign = row.deltaPercent >= 0 ? '+' : '';
  const delta = Number.isFinite(row.deltaPercent)
    ? `${sign}${row.deltaPercent.toFixed(1)}%`
    : 'n/a';
  const limit = row.enforcedLimit ?? row.budget;
  const renderedLimit = row.metric === 'cls' ? roundTo(limit, 3) : Math.round(limit);
  return `| ${row.route}.${row.metric} | ${row.budget}${suffix} | ${renderedLimit}${suffix} | ${row.actual}${suffix} | ${delta} |`;
}

/** Render the comparison as a markdown table for the CI / local log. */
export function renderReport(
  { regressions, ok, missing, unstable, volatile, varianceAccepted },
  { thresholdPercent, scoreTolerancePoints, maxScoreIqrPoints, samplesPerRoute }
) {
  const lines = [];
  if (regressions.length > 0) {
    lines.push(
      `Lighthouse regression (${samplesPerRoute}-sample medians; score allows ${scoreTolerancePoints} points; other metrics allow ${thresholdPercent}% variance):`
    );
    lines.push('| metric | declared budget | enforced limit | actual | delta |');
    lines.push('| --- | ---: | ---: | ---: | ---: |');
    for (const r of regressions) lines.push(renderRow(r));
  }
  if (unstable.length > 0) {
    if (lines.length) lines.push('');
    lines.push(
      `Unstable Lighthouse score distributions (evidence rejected; max IQR ${maxScoreIqrPoints} points):`
    );
    lines.push('| route | samples | score range | score IQR |');
    lines.push('| --- | ---: | ---: | ---: |');
    for (const row of unstable) {
      lines.push(
        `| ${row.route} | ${row.sampleCount ?? 'n/a'} | ${row.scoreMin ?? 'n/a'}–${row.scoreMax ?? 'n/a'} | ${row.scoreIqr} |`
      );
    }
  }
  if (volatile.length > 0) {
    if (lines.length) lines.push('');
    lines.push(
      `High-variance but conclusive score distributions (IQR above ${maxScoreIqrPoints}; every sample remains on one side of the enforced floor):`
    );
    lines.push('| route | samples | enforced floor | score range | score IQR |');
    lines.push('| --- | ---: | ---: | ---: | ---: |');
    for (const row of volatile) {
      lines.push(
        `| ${row.route} | ${row.sampleCount ?? 'n/a'} | ${row.enforcedFloor} | ${row.scoreMin ?? 'n/a'}–${row.scoreMax ?? 'n/a'} | ${row.scoreIqr} |`
      );
    }
  }
  if (missing.length > 0) {
    if (lines.length) lines.push('');
    lines.push('Budgeted routes/metrics with no measurement (warning):');
    for (const m of missing) lines.push(`  - ${m.route}.${m.metric}`);
  }
  if (varianceAccepted.length > 0) {
    if (lines.length) lines.push('');
    lines.push(
      `Score medians inside the bounded ${scoreTolerancePoints}-point runner-variance band:`
    );
    lines.push('| metric | declared budget | enforced limit | actual | delta |');
    lines.push('| --- | ---: | ---: | ---: | ---: |');
    for (const row of varianceAccepted) lines.push(renderRow(row));
  }
  if (regressions.length === 0 && unstable.length === 0 && ok.length > 0) {
    if (lines.length) lines.push('');
    lines.push('Lighthouse PASS — web vitals within budget:');
    lines.push('| metric | declared budget | enforced limit | actual | delta |');
    lines.push('| --- | ---: | ---: | ---: | ---: |');
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
export async function launchAndMeasure({ samplesPerRoute = 5 } = {}) {
  let chromium;
  let lighthouse;
  try {
    ({ chromium } = await import('playwright'));
    lighthouse = (await import('lighthouse')).default;
  } catch (err) {
    console.warn(
      `check-lighthouse: WARN skipped — playwright/lighthouse not available: ${err.message}`
    );
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
      const samples = [];
      for (let sample = 1; sample <= samplesPerRoute; sample += 1) {
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
            samples.push(extractMetrics(runnerResult.lhr));
            console.log(
              `check-lighthouse: diagnostics ${route.key} sample ${sample}/${samplesPerRoute} = ${JSON.stringify(
                extractDiagnostics(runnerResult.lhr)
              )}`
            );
          } else {
            console.warn(
              `check-lighthouse: WARN — route ${route.path} sample ${sample}/${samplesPerRoute} produced no Lighthouse result.`
            );
          }
        } catch (err) {
          console.warn(
            `check-lighthouse: WARN — route ${route.path} sample ${sample}/${samplesPerRoute} failed: ${err.message}`
          );
        }
      }
      if (samples.length === samplesPerRoute) {
        measured[route.key] = aggregateRouteSamples(samples);
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
export async function runCli({
  measure = launchAndMeasure,
  strict,
  requireMeasurement,
  logger = console,
  hostProfile = resolveLighthouseHostProfile(),
} = {}) {
  const enforce =
    strict ??
    (process.argv.includes('--strict') || process.env.PUNTOVIVO_LIGHTHOUSE_STRICT === '1');
  const requireProof =
    requireMeasurement ??
    (process.argv.includes('--require-measurement') ||
      process.env.PUNTOVIVO_LIGHTHOUSE_REQUIRE_MEASUREMENT === '1');
  let budgetFile;
  try {
    budgetFile = JSON.parse(readFileSync(BUDGET_PATH, 'utf8'));
  } catch (err) {
    logger.error(`check-lighthouse: cannot read budget file at ${BUDGET_PATH}: ${err.message}`);
    return 1;
  }
  const budget = budgetFile?.lighthouse?.perRoute;
  const thresholdPercent = budgetFile?.lighthouse?.thresholdPercent;
  const samplesPerRoute = budgetFile?.lighthouse?.samplesPerRoute;
  const scoreTolerancePoints = budgetFile?.lighthouse?.scoreTolerancePoints;
  const maxScoreIqrPoints = budgetFile?.lighthouse?.maxScoreIqrPoints;
  if (
    !isValidLighthousePolicy({
      budget,
      thresholdPercent,
      samplesPerRoute,
      scoreTolerancePoints,
      maxScoreIqrPoints,
    })
  ) {
    logger.error(
      'check-lighthouse: perf-budget.json is missing a valid Lighthouse statistical policy'
    );
    return 1;
  }

  logger.log(`check-lighthouse: host = ${JSON.stringify(hostProfile)}`);
  const measured = await measure({ samplesPerRoute });
  if (!measured) {
    // Self-skip: the warning was already printed by launchAndMeasure.
    if (requireProof) {
      logger.error(
        'check-lighthouse: FAIL (--require-measurement) — no Lighthouse measurement was produced.'
      );
      return 1;
    }
    return 0;
  }

  // Echo the raw measurement so the operator can copy it into the budget when
  // (re)capturing a baseline — the report below only surfaces regressions/PASS.
  logger.log(`check-lighthouse: measured = ${JSON.stringify(measured)}`);

  const policy = {
    thresholdPercent,
    scoreTolerancePoints,
    maxScoreIqrPoints,
    samplesPerRoute,
  };
  const result = compareToLighthouseBudget({
    measured,
    budget,
    thresholdPercent,
    scoreTolerancePoints,
    maxScoreIqrPoints,
    expectedSamplesPerRoute: samplesPerRoute,
  });
  const report = renderReport(result, policy);
  logger.log(report);

  if (result.missing.length > 0 && requireProof) {
    logger.error(
      'check-lighthouse: FAIL (--require-measurement) — a budgeted route or metric was not measured.'
    );
    return 1;
  }
  if (result.unstable.length > 0 && requireProof) {
    logger.error(
      'check-lighthouse: FAIL (--require-measurement) — score variance is too high for reliable evidence.'
    );
    return 1;
  }
  if (result.regressions.length > 0 && enforce) {
    logger.error('check-lighthouse: FAIL (--strict) — a web-vital regressed past budget.');
    return 1;
  }
  if (result.unstable.length > 0 && enforce) {
    logger.error(
      'check-lighthouse: FAIL (--strict) — score distribution is statistically unstable.'
    );
    return 1;
  }
  if (result.regressions.length > 0) {
    logger.warn(
      'check-lighthouse: WARN — over the web-vitals budget (warn-first; pass --strict to enforce).'
    );
  }
  if (result.unstable.length > 0) {
    logger.warn(
      'check-lighthouse: WARN — score distribution is unstable (warn-first; rerun on an idle host).'
    );
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
