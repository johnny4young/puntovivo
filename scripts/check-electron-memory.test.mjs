#!/usr/bin/env node
/**
 * unit tests for the Electron memory gate's PURE logic.
 *
 * Exercises the helpers in isolation with fixture `getAppMetrics` data — no
 * Electron launch — mirroring `scripts/check-bundle-size.test.mjs`. The
 * launch path (`launchAndMeasure`) is integration-only and proven by the
 * `ci:desktop` runner, not here.
 *
 * @module scripts/check-electron-memory.test
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  summarizeProcesses,
  compareToMemoryBudget,
  renderReport,
  parseMetricsLine,
  resolveMemoryGateMode,
  runCli,
} from './check-electron-memory.mjs';

test('summarizeProcesses maps Browser -> main, Tab -> renderer, ignores the rest', () => {
  const metrics = [
    { type: 'Browser', workingSetKb: 102400 }, // 100 MB main
    { type: 'Tab', workingSetKb: 204800 }, // 200 MB renderer
    { type: 'GPU', workingSetKb: 51200 }, // ignored
    { type: 'Utility', workingSetKb: 40960 }, // ignored
  ];
  assert.deepEqual(summarizeProcesses(metrics), { main: 100, renderer: 200 });
});

test('summarizeProcesses sums multiple renderer (Tab) processes', () => {
  const metrics = [
    { type: 'Browser', workingSetKb: 81920 }, // 80 MB
    { type: 'Tab', workingSetKb: 102400 }, // 100 MB
    { type: 'Tab', workingSetKb: 51200 }, // 50 MB
  ];
  assert.deepEqual(summarizeProcesses(metrics), { main: 80, renderer: 150 });
});

test('compareToMemoryBudget: a value within budget+threshold lands in ok', () => {
  const result = compareToMemoryBudget({
    measured: { main: 110, renderer: 240 },
    budget: { main: 100, renderer: 250 },
    thresholdPercent: 25, // ceilings: 125 / 312.5
  });
  assert.equal(result.regressions.length, 0);
  assert.equal(result.ok.length, 2);
});

test('compareToMemoryBudget: a value past the ceiling is a regression', () => {
  const result = compareToMemoryBudget({
    measured: { main: 200, renderer: 240 },
    budget: { main: 100, renderer: 250 },
    thresholdPercent: 25, // main ceiling 125 -> 200 regresses
  });
  assert.equal(result.regressions.length, 1);
  assert.equal(result.regressions[0].name, 'main');
});

test('compareToMemoryBudget: a budget key with no measurement is missing', () => {
  const result = compareToMemoryBudget({
    measured: { main: 90 },
    budget: { main: 100, renderer: 250 },
    thresholdPercent: 25,
  });
  assert.deepEqual(
    result.missing.map(m => m.name),
    ['renderer']
  );
});

test('renderReport prints a PASS table when there are no regressions', () => {
  const report = renderReport(
    {
      regressions: [],
      ok: [{ name: 'main', budget: 100, actual: 90, deltaPercent: -10 }],
      missing: [],
    },
    25
  );
  assert.match(report, /Electron memory PASS/);
  assert.match(report, /main/);
});

test('parseMetricsLine extracts the metrics array', () => {
  const stdout =
    'some boot log\nPUNTOVIVO_MEMORY_METRICS=[{"type":"Browser","workingSetKb":102400}]\nbye';
  assert.deepEqual(parseMetricsLine(stdout), [{ type: 'Browser', workingSetKb: 102400 }]);
});

test('parseMetricsLine returns null for a missing or malformed line', () => {
  assert.equal(parseMetricsLine('no metrics here'), null);
  assert.equal(parseMetricsLine('PUNTOVIVO_MEMORY_METRICS={not json'), null);
  assert.equal(parseMetricsLine(''), null);
});

test('resolveMemoryGateMode reads strict and require-measurement flags from argv/env', () => {
  assert.deepEqual(resolveMemoryGateMode({ argv: ['--strict'], env: {} }), {
    enforce: true,
    requireMeasurement: false,
  });
  assert.deepEqual(resolveMemoryGateMode({ argv: ['--require-measurement'], env: {} }), {
    enforce: false,
    requireMeasurement: true,
  });
  assert.deepEqual(
    resolveMemoryGateMode({
      argv: [],
      env: { PUNTOVIVO_MEMORY_STRICT: '1', PUNTOVIVO_MEMORY_REQUIRE_MEASUREMENT: '1' },
    }),
    {
      enforce: true,
      requireMeasurement: true,
    }
  );
});

test('runCli self-skips (exit 0) when Electron cannot be measured', () => {
  const code = runCli({ measure: () => null });
  assert.equal(code, 0);
});

test('runCli --require-measurement fails (exit 1) when Electron cannot be measured', () => {
  const code = runCli({ measure: () => null, requireMeasurement: true });
  assert.equal(code, 1);
});

test('runCli is warn-first by default: over-ceiling still exits 0', () => {
  const code = runCli({ measure: () => ({ main: 9999, renderer: 9999 }), strict: false });
  assert.equal(code, 0);
});

test('runCli --strict fails (exit 1) when a process overshoots', () => {
  const code = runCli({ measure: () => ({ main: 9999, renderer: 9999 }), strict: true });
  assert.equal(code, 1);
});

test('runCli --require-measurement fails (exit 1) when a budgeted process is missing', () => {
  const code = runCli({ measure: () => ({ main: 10 }), requireMeasurement: true });
  assert.equal(code, 1);
});

test('runCli passes (exit 0) when the measurement is within budget', () => {
  const code = runCli({
    measure: () => ({ main: 10, renderer: 10 }),
    strict: true,
    requireMeasurement: true,
  });
  assert.equal(code, 0);
});
