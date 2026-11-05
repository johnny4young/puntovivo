import assert from 'node:assert/strict';
import { test } from 'node:test';

import { judgeAuditChainSamples, runGate } from './run-audit-chain-profile-gate.mjs';

const budget = {
  thresholdPercent: 35,
  verifyElapsedMs: 1200,
  redactElapsedMs: 3500,
  maxRssGrowthMiB: 160,
};
const withinBudget = { verifyElapsedMs: 680, redactElapsedMs: 1340, maxRssGrowthMiB: 43 };

function scripted(samples) {
  const runs = [...samples];
  const calls = { count: 0 };
  const run = () => {
    calls.count += 1;
    return runs.shift();
  };
  return { run, calls };
}

const silent = () => {};

test('one sample within every budget passes without re-sampling', () => {
  const { run, calls } = scripted([{ passed: true, measured: withinBudget }]);
  assert.equal(runGate({ run, budget, log: silent }), 0);
  assert.equal(calls.count, 1);
});

test('elapsed time over budget fails even when RSS is within budget', () => {
  const slow = { verifyElapsedMs: 2939.84, redactElapsedMs: 5749.2, maxRssGrowthMiB: 43 };
  const { run, calls } = scripted([
    { passed: true, measured: slow },
    { passed: true, measured: slow },
    { passed: true, measured: slow },
  ]);
  const lines = [];
  assert.equal(runGate({ run, budget, log: line => lines.push(line) }), 1);
  assert.equal(calls.count, 3);
  assert.match(lines.join('\n'), /verifyElapsedMs median 2939.84 ms exceeds 1620 ms/);
  assert.match(lines.join('\n'), /redactElapsedMs median 5749.2 ms exceeds 4725 ms/);
});

test('a noisy first sample passes when every median is within budget', () => {
  const { run, calls } = scripted([
    { passed: true, measured: { ...withinBudget, maxRssGrowthMiB: 204 } },
    { passed: true, measured: withinBudget },
    { passed: true, measured: { ...withinBudget, verifyElapsedMs: 1700 } },
  ]);
  assert.equal(runGate({ run, budget, log: silent }), 0);
  assert.equal(calls.count, 3);
});

test('a failing test run is never re-sampled, even with a measurement', () => {
  const { run, calls } = scripted([{ passed: false, measured: withinBudget }]);
  assert.equal(runGate({ run, budget, log: silent }), 1);
  assert.equal(calls.count, 1);
});

test('a re-sample that fails its assertions fails the gate', () => {
  const { run } = scripted([
    { passed: true, measured: { ...withinBudget, maxRssGrowthMiB: 204 } },
    { passed: false, measured: null },
  ]);
  assert.equal(runGate({ run, budget, log: silent }), 1);
});

test('the RSS ceiling is exact and elapsed ceilings carry the allowance', () => {
  assert.equal(
    judgeAuditChainSamples([{ ...withinBudget, verifyElapsedMs: 1620 }], budget).ok,
    true
  );
  assert.equal(
    judgeAuditChainSamples([{ ...withinBudget, maxRssGrowthMiB: 160.01 }], budget).ok,
    false
  );
  assert.equal(
    judgeAuditChainSamples([{ ...withinBudget, redactElapsedMs: undefined }], budget).ok,
    false
  );
});
