/**
 * ENG-133c — unit tests for the pure helpers of the Lighthouse web-vitals gate.
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
  extractMetrics,
  compareToLighthouseBudget,
  renderReport,
  runCli,
} from './check-lighthouse.mjs';

const THRESHOLD = 30;

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
    measured: { dashboard: { score: 72 } }
    budget: { dashboard: { score: 72 } },
    thresholdPercent: THRESHOLD,
  });
  assert.equal(result.regressions.length, 0);
  assert.equal(result.ok.length, 1);
});

test('compareToLighthouseBudget: score ignores timing tolerance and regresses below its exact floor', () => {
  const result = compareToLighthouseBudget({
    measured: { dashboard: { score: 71 } }
    budget: { dashboard: { score: 72 } },
    thresholdPercent: THRESHOLD,
  });
  assert.equal(result.regressions.length, 1);
  assert.equal(result.regressions[0].metric, 'score');
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

test('renderReport prints a PASS table when there are no regressions', () => {
  const report = renderReport(
    compareToLighthouseBudget({
      measured: { login: { lcpMs: 1000 } },
      budget: { login: { lcpMs: 1300 } },
      thresholdPercent: THRESHOLD,
    }),
    THRESHOLD
  );
  assert.match(report, /Lighthouse PASS/);
  assert.match(report, /login\.lcpMs/);
});

test('renderReport explains exact score floors and variance-tolerant metrics', () => {
  const report = renderReport(
    compareToLighthouseBudget({
      measured: { login: { lcpMs: 5000 } },
      budget: { login: { lcpMs: 1300 } },
      thresholdPercent: THRESHOLD,
    }),
    THRESHOLD
  );
  assert.match(report, /score uses its exact floor/);
  assert.match(report, /allow 30% variance/);
});

test('runCli self-skips (exit 0) when measurement is infeasible', async () => {
  const code = await runCli({ measure: async () => null });
  assert.equal(code, 0);
});

test('runCli --require-measurement fails when measurement is infeasible', async () => {
  const code = await runCli({
    measure: async () => null,
    requireMeasurement: true,
  });
  assert.equal(code, 1);
});

test('runCli is warn-first by default: over-budget still exits 0', async () => {
  const code = await runCli({
    measure: async () => ({ login: { lcpMs: 99_999 } }),
    strict: false,
  });
  assert.equal(code, 0);
});

test('runCli --strict fails (exit 1) when a metric regresses', async () => {
  const code = await runCli({
    measure: async () => ({ login: { lcpMs: 99_999 } }),
    strict: true,
  });
  assert.equal(code, 1);
});

test('runCli --require-measurement fails when a budgeted route is missing', async () => {
  const code = await runCli({
    measure: async () => ({ login: { lcpMs: 10, ttiMs: 10, cls: 0, score: 100 } }),
    requireMeasurement: true,
  });
  assert.equal(code, 1);
});

test('runCli passes (exit 0) when measurements are within budget', async () => {
  const code = await runCli({
    measure: async () => ({
      login: { lcpMs: 10, ttiMs: 10, cls: 0, score: 100 },
      dashboard: { lcpMs: 10, ttiMs: 10, cls: 0, score: 100 },
      sales: { lcpMs: 10, ttiMs: 10, cls: 0, score: 100 },
      products: { lcpMs: 10, ttiMs: 10, cls: 0, score: 100 },
    }),
    strict: true,
  });
  assert.equal(code, 0);
});
