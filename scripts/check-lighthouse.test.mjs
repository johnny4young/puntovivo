/**
 * unit tests for the pure helpers of the Lighthouse web-vitals gate.
 *
 * Mirrors check-electron-memory.test.mjs: exercises extractMetrics /
 * compareToLighthouseBudget / renderReport with fixtures, and the runCli
 * warn-first/self-skip/strict contract with an injected async `measure` — so
 * NO browser or Lighthouse run is needed. Runs in ci:web via `node --test`.
 *
 * @module scripts/check-lighthouse.test
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  aggregateRouteSamples,
  extractDiagnostics,
  extractMetrics,
  compareToLighthouseBudget,
  isValidLighthousePolicy,
  renderReport,
  resolveLighthouseHostProfile,
  runCli,
} from './check-lighthouse.mjs';

const THRESHOLD = 30;
const REPORT_POLICY = {
  thresholdPercent: THRESHOLD,
  scoreTolerancePoints: 2,
  maxScoreIqrPoints: 4,
  samplesPerRoute: 5,
};
const SILENT_LOGGER = { log() {}, warn() {}, error() {} };

function stableRoute(overrides = {}) {
  return {
    lcpMs: 10,
    ttiMs: 10,
    cls: 0,
    score: 100,
    sampleCount: 5,
    scoreMin: 100,
    scoreMax: 100,
    scoreIqr: 0,
    ...overrides,
  };
}

function runCliSilent(options = {}) {
  return runCli({ ...options, logger: SILENT_LOGGER });
}

test('extractMetrics pulls LCP/TTI/CLS (rounded) + score (0-100) from an lhr', () => {
  const lhr = {
    audits: {
      'largest-contentful-paint': { numericValue: 1842.7 },
      interactive: { numericValue: 2510.2 },
      'cumulative-layout-shift': { numericValue: 0.04321 },
    },
    categories: { performance: { score: 0.83 } },
  };
  assert.deepEqual(extractMetrics(lhr), { lcpMs: 1843, ttiMs: 2510, cls: 0.043, score: 83 });
});

test('extractMetrics maps missing audits / score to null (no crash)', () => {
  assert.deepEqual(extractMetrics({ audits: {}, categories: {} }), {
    lcpMs: null,
    ttiMs: null,
    cls: null,
    score: null,
  });
  assert.deepEqual(extractMetrics(undefined), {
    lcpMs: null,
    ttiMs: null,
    cls: null,
    score: null,
  });
});

test('aggregateRouteSamples uses the per-metric median and preserves missing metrics', () => {
  assert.deepEqual(
    aggregateRouteSamples([
      { lcpMs: 3100, ttiMs: 3300, cls: 0.007, score: 60 },
      { lcpMs: 2400, ttiMs: 2500, cls: 0.004, score: 75 },
      { lcpMs: 2600, ttiMs: 2700, cls: 0.006, score: 72 },
    ]),
    {
      lcpMs: 2600,
      ttiMs: 2700,
      cls: 0.006,
      score: 72,
      sampleCount: 3,
      scoreMin: 60,
      scoreMax: 75,
      scoreIqr: 15,
    }
  );
  assert.deepEqual(aggregateRouteSamples([{ score: 80 }]), {
    lcpMs: null,
    ttiMs: null,
    cls: null,
    score: 80,
    sampleCount: 1,
    scoreMin: 80,
    scoreMax: 80,
    scoreIqr: 0,
  });
  assert.deepEqual(
    aggregateRouteSamples([
      { lcpMs: 2000, ttiMs: 2200, cls: 0.004, score: 80 },
      { lcpMs: 2100, ttiMs: null, cls: 0.005, score: 79 },
      { lcpMs: 2200, ttiMs: 2400, cls: 0.006, score: 78 },
    ]),
    {
      lcpMs: 2100,
      ttiMs: null,
      cls: 0.005,
      score: 79,
      sampleCount: 3,
      scoreMin: 78,
      scoreMax: 80,
      scoreIqr: 2,
    }
  );
});

test('aggregateRouteSamples reports robust five-sample score spread', () => {
  assert.deepEqual(
    aggregateRouteSamples([
      { score: 69 },
      { score: 74 },
      { score: 70 },
      { score: 71 },
      { score: 69 },
    ]),
    {
      lcpMs: null,
      ttiMs: null,
      cls: null,
      score: 70,
      sampleCount: 5,
      scoreMin: 69,
      scoreMax: 74,
      scoreIqr: 3.5,
    }
  );
  assert.deepEqual(aggregateRouteSamples([]), {
    lcpMs: null,
    ttiMs: null,
    cls: null,
    score: null,
    sampleCount: 0,
    scoreMin: null,
    scoreMax: null,
    scoreIqr: null,
  });
});

test('extractDiagnostics exposes blocking-time signals and the heaviest scripts', () => {
  const lhr = {
    audits: {
      'first-contentful-paint': { numericValue: 1000.4 },
      'speed-index': { numericValue: 1300.7 },
      'total-blocking-time': { numericValue: 220.3 },
      'mainthread-work-breakdown': { numericValue: 2500.8 },
      'bootup-time': {
        numericValue: 1800.1,
        details: {
          items: [
            { url: 'http://localhost:3000/assets/small.js', total: 100, scripting: 80 },
            { url: 'http://localhost:3000/assets/large.js', total: 900.2, scripting: 700.8 },
          ],
        },
      },
    },
  };
  assert.deepEqual(extractDiagnostics(lhr), {
    fcpMs: 1000,
    speedIndexMs: 1301,
    tbtMs: 220,
    mainThreadWorkMs: 2501,
    bootupTimeMs: 1800,
    topBootupScripts: [
      { url: '/assets/large.js', totalMs: 900, scriptingMs: 701 },
      { url: '/assets/small.js', totalMs: 100, scriptingMs: 80 },
    ],
  });
});

test('compareToLighthouseBudget: a lower-is-better metric within ceiling is ok', () => {
  const result = compareToLighthouseBudget({
    measured: { login: { lcpMs: 1500 } },
    budget: { login: { lcpMs: 1300 } }, // ceiling 1300 * 1.30 = 1690
    thresholdPercent: THRESHOLD,
  });
  assert.equal(result.regressions.length, 0);
  assert.equal(result.ok.length, 1);
});

test('compareToLighthouseBudget: a lower-is-better metric past the ceiling regresses', () => {
  const result = compareToLighthouseBudget({
    measured: { login: { lcpMs: 1800 } }, // > 1690 ceiling
    budget: { login: { lcpMs: 1300 } },
    thresholdPercent: THRESHOLD,
  });
  assert.equal(result.regressions.length, 1);
  assert.equal(result.regressions[0].metric, 'lcpMs');
});

test('compareToLighthouseBudget: a score at the exact floor is ok', () => {
  const result = compareToLighthouseBudget({
    measured: { dashboard: { score: 72 } },
    budget: { dashboard: { score: 72 } },
    thresholdPercent: THRESHOLD,
  });
  assert.equal(result.regressions.length, 0);
  assert.equal(result.ok.length, 1);
});

test('compareToLighthouseBudget: score ignores timing tolerance and regresses below its exact floor', () => {
  const result = compareToLighthouseBudget({
    measured: { dashboard: { score: 71 } },
    budget: { dashboard: { score: 72 } },
    thresholdPercent: THRESHOLD,
  });
  assert.equal(result.regressions.length, 1);
  assert.equal(result.regressions[0].metric, 'score');
});

test('compareToLighthouseBudget accepts only the explicit absolute score variance band', () => {
  const accepted = compareToLighthouseBudget({
    measured: { sales: stableRoute({ score: 69, scoreMin: 68, scoreMax: 71, scoreIqr: 2 }) },
    budget: { sales: { score: 70 } },
    thresholdPercent: THRESHOLD,
    scoreTolerancePoints: 2,
    maxScoreIqrPoints: 4,
    expectedSamplesPerRoute: 5,
  });
  assert.equal(accepted.regressions.length, 0);
  assert.equal(accepted.varianceAccepted.length, 1);
  assert.equal(accepted.varianceAccepted[0].enforcedLimit, 68);

  const regression = compareToLighthouseBudget({
    measured: { sales: stableRoute({ score: 67, scoreMin: 66, scoreMax: 69, scoreIqr: 2 }) },
    budget: { sales: { score: 70 } },
    thresholdPercent: THRESHOLD,
    scoreTolerancePoints: 2,
    maxScoreIqrPoints: 4,
    expectedSamplesPerRoute: 5,
  });
  assert.equal(regression.regressions.length, 1);
});

test('compareToLighthouseBudget rejects missing or unstable score statistics', () => {
  const missing = compareToLighthouseBudget({
    measured: { sales: { score: 70 } },
    budget: { sales: { score: 70 } },
    thresholdPercent: THRESHOLD,
    maxScoreIqrPoints: 4,
    expectedSamplesPerRoute: 5,
  });
  assert.deepEqual(
    missing.missing.map(row => row.metric),
    ['sampleCount', 'scoreIqr']
  );

  const unstable = compareToLighthouseBudget({
    measured: { sales: stableRoute({ score: 70, scoreMin: 62, scoreMax: 75, scoreIqr: 6 }) },
    budget: { sales: { score: 70 } },
    thresholdPercent: THRESHOLD,
    maxScoreIqrPoints: 4,
    expectedSamplesPerRoute: 5,
  });
  assert.equal(unstable.unstable.length, 1);
  assert.equal(unstable.unstable[0].route, 'sales');

  const conclusive = compareToLighthouseBudget({
    measured: {
      products: stableRoute({ score: 72, scoreMin: 71, scoreMax: 81, scoreIqr: 5 }),
    },
    budget: { products: { score: 62 } },
    thresholdPercent: THRESHOLD,
    scoreTolerancePoints: 2,
    maxScoreIqrPoints: 4,
    expectedSamplesPerRoute: 5,
  });
  assert.equal(conclusive.unstable.length, 0);
  assert.equal(conclusive.volatile.length, 1);
});

test('compareToLighthouseBudget: a budgeted route with no measurement is missing', () => {
  const result = compareToLighthouseBudget({
    measured: {},
    budget: { sales: { lcpMs: 2300 } },
    thresholdPercent: THRESHOLD,
  });
  assert.equal(result.missing.length, 1);
  assert.equal(result.missing[0].route, 'sales');
  assert.equal(result.regressions.length, 0);
});

test('compareToLighthouseBudget: a budgeted metric with no measurement is missing', () => {
  const result = compareToLighthouseBudget({
    measured: { sales: { lcpMs: 2000 } }, // ttiMs absent
    budget: { sales: { lcpMs: 2300, ttiMs: 3100 } },
    thresholdPercent: THRESHOLD,
  });
  assert.equal(result.missing.length, 1);
  assert.equal(result.missing[0].metric, 'ttiMs');
  assert.equal(result.ok.length, 1);
});

test('isValidLighthousePolicy bounds sample count and variance allowances', () => {
  const valid = {
    budget: { sales: { score: 70 } },
    thresholdPercent: 30,
    samplesPerRoute: 5,
    scoreTolerancePoints: 2,
    maxScoreIqrPoints: 4,
  };
  assert.equal(isValidLighthousePolicy(valid), true);
  assert.equal(isValidLighthousePolicy({ ...valid, budget: [] }), false);
  assert.equal(isValidLighthousePolicy({ ...valid, thresholdPercent: Infinity }), false);
  assert.equal(isValidLighthousePolicy({ ...valid, samplesPerRoute: 3 }), false);
  assert.equal(isValidLighthousePolicy({ ...valid, samplesPerRoute: 6 }), false);
  assert.equal(isValidLighthousePolicy({ ...valid, scoreTolerancePoints: 6 }), false);
  assert.equal(isValidLighthousePolicy({ ...valid, maxScoreIqrPoints: 11 }), false);
});

test('resolveLighthouseHostProfile distinguishes CI without exposing a hostname', () => {
  const profile = resolveLighthouseHostProfile({
    env: { GITHUB_ACTIONS: 'true', RUNNER_ENVIRONMENT: 'github-hosted' },
  });
  assert.equal(profile.runner, 'github-hosted');
  assert.equal(typeof profile.osRelease, 'string');
  assert.equal(typeof profile.logicalCpus, 'number');
  assert.equal(typeof profile.memoryGiB, 'number');
  assert.equal(Object.hasOwn(profile, 'hostname'), false);
});

test('renderReport prints a PASS table when there are no regressions', () => {
  const report = renderReport(
    compareToLighthouseBudget({
      measured: { login: { lcpMs: 1000 } },
      budget: { login: { lcpMs: 1300 } },
      thresholdPercent: THRESHOLD,
    }),
    REPORT_POLICY
  );
  assert.match(report, /Lighthouse PASS/);
  assert.match(report, /login\.lcpMs/);
});

test('renderReport exposes declared and statistically enforced limits', () => {
  const report = renderReport(
    compareToLighthouseBudget({
      measured: { login: { lcpMs: 5000 } },
      budget: { login: { lcpMs: 1300 } },
      thresholdPercent: THRESHOLD,
    }),
    REPORT_POLICY
  );
  assert.match(report, /5-sample medians/);
  assert.match(report, /score allows 2 points/);
  assert.match(report, /allow 30% variance/);
  assert.match(report, /declared budget \| enforced limit/);
});

test('renderReport makes accepted score variance and unstable evidence visible', () => {
  const report = renderReport(
    compareToLighthouseBudget({
      measured: { sales: stableRoute({ score: 69, scoreMin: 62, scoreMax: 75, scoreIqr: 6 }) },
      budget: { sales: { score: 70 } },
      thresholdPercent: THRESHOLD,
      scoreTolerancePoints: 2,
      maxScoreIqrPoints: 4,
      expectedSamplesPerRoute: 5,
    }),
    REPORT_POLICY
  );
  assert.match(report, /bounded 2-point runner-variance band/);
  assert.match(report, /evidence rejected; max IQR 4 points/);
  assert.match(report, /62–75/);
});

test('renderReport flags conclusive volatility without rejecting it', () => {
  const report = renderReport(
    compareToLighthouseBudget({
      measured: {
        products: stableRoute({ score: 72, scoreMin: 71, scoreMax: 81, scoreIqr: 5 }),
      },
      budget: { products: { score: 62 } },
      thresholdPercent: THRESHOLD,
      scoreTolerancePoints: 2,
      maxScoreIqrPoints: 4,
      expectedSamplesPerRoute: 5,
    }),
    REPORT_POLICY
  );
  assert.match(report, /High-variance but conclusive/);
  assert.match(report, /71–81/);
  assert.match(report, /Lighthouse PASS/);
});

test('runCli self-skips (exit 0) when measurement is infeasible', async () => {
  const code = await runCliSilent({ measure: async () => null });
  assert.equal(code, 0);
});

test('runCli --require-measurement fails when measurement is infeasible', async () => {
  const code = await runCliSilent({
    measure: async () => null,
    requireMeasurement: true,
  });
  assert.equal(code, 1);
});

test('runCli is warn-first by default: over-budget still exits 0', async () => {
  const code = await runCliSilent({
    measure: async () => ({ login: { lcpMs: 99_999 } }),
    strict: false,
  });
  assert.equal(code, 0);
});

test('runCli --strict fails (exit 1) when a metric regresses', async () => {
  const code = await runCliSilent({
    measure: async () => ({ login: { lcpMs: 99_999 } }),
    strict: true,
  });
  assert.equal(code, 1);
});

test('runCli --require-measurement fails when a budgeted route is missing', async () => {
  const code = await runCliSilent({
    measure: async () => ({ login: { lcpMs: 10, ttiMs: 10, cls: 0, score: 100 } }),
    requireMeasurement: true,
  });
  assert.equal(code, 1);
});

test('runCli passes (exit 0) when measurements are within budget', async () => {
  const code = await runCliSilent({
    measure: async () => ({
      login: stableRoute(),
      dashboard: stableRoute(),
      sales: stableRoute(),
      products: stableRoute(),
    }),
    strict: true,
    requireMeasurement: true,
  });
  assert.equal(code, 0);
});

test('runCli requests five samples and rejects an unstable strict proof', async () => {
  let requestedSamples = null;
  const code = await runCliSilent({
    measure: async options => {
      requestedSamples = options.samplesPerRoute;
      return {
        login: stableRoute(),
        dashboard: stableRoute(),
        sales: stableRoute({ score: 69, scoreMin: 60, scoreMax: 76, scoreIqr: 7 }),
        products: stableRoute(),
      };
    },
    strict: true,
    requireMeasurement: true,
  });
  assert.equal(requestedSamples, 5);
  assert.equal(code, 1);
});

test('runCli logs the injected host profile beside the measured distribution', async () => {
  const lines = [];
  const code = await runCli({
    measure: async () => ({
      login: stableRoute(),
      dashboard: stableRoute(),
      sales: stableRoute(),
      products: stableRoute(),
    }),
    strict: true,
    requireMeasurement: true,
    hostProfile: { runner: 'fixture', arch: 'arm64' },
    logger: {
      log(value) {
        lines.push(value);
      },
      warn() {},
      error() {},
    },
  });
  assert.equal(code, 0);
  assert.match(lines[0], /check-lighthouse: host = .*fixture.*arm64/);
  assert.match(lines[1], /check-lighthouse: measured =/);
});
