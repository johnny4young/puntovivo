import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  describeGrowth,
  describeHost,
  judgeAuditChainSamples,
  runGate,
} from './run-audit-chain-profile-gate.mjs';

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

const host = {
  node: 'v26.13.0',
  cpu: 'AMD EPYC 9V74 80-Core Processor',
  cores: 4,
  totalMemoryMiB: 16_000,
  thp: 'madvise',
};
const memory = {
  baseline: { anonMiB: 300, fileMiB: 59, hugeMiB: 4, heapTotalMiB: 194 },
  redact: { anonMiB: 470, fileMiB: 87, hugeMiB: 4, heapTotalMiB: 202 },
};

test('the gate prints the host before sampling', () => {
  const { run } = scripted([{ passed: true, measured: withinBudget }]);
  const lines = [];
  runGate({ run, budget, log: line => lines.push(line), host });
  assert.equal(lines[0], `audit-chain profile host: ${JSON.stringify(host)}`);
});

test('an RSS failure names the host and the component that grew', () => {
  const high = { ...withinBudget, maxRssGrowthMiB: 224.09, memory };
  const { run } = scripted([
    { passed: true, measured: high },
    { passed: true, measured: high },
    { passed: true, measured: high },
  ]);
  const lines = [];
  assert.equal(runGate({ run, budget, log: line => lines.push(line), host }), 1);
  const output = lines.join('\n');
  assert.match(
    output,
    /FAILED over 3 samples on AMD EPYC 9V74 80-Core Processor, 4 cores, 16000 MiB, THP madvise, Node v26\.13\.0/
  );
  assert.match(
    output,
    /sample 3 growth to redaction: anon 170\.0, file 28\.0, huge pages 0\.0, V8 heap 8\.0 MiB/
  );
});

test('growth attribution skips components the platform does not report', () => {
  const macos = {
    baseline: { anonMiB: null, fileMiB: null, hugeMiB: null, heapTotalMiB: 190 },
    redact: { anonMiB: null, fileMiB: null, hugeMiB: null, heapTotalMiB: 196.5 },
  };
  assert.equal(describeGrowth({ memory: macos }), 'V8 heap 6.5 MiB');
  assert.equal(describeGrowth(withinBudget), null);
});

test('the host reads the selected THP mode and only the memory env that is set', () => {
  const described = describeHost({
    readText: path => {
      if (path.endsWith('/enabled')) return 'always [madvise] never\n';
      throw new Error('ENOENT');
    },
    env: { MALLOC_ARENA_MAX: '2', ImageVersion: '20261101.360.1' },
  });
  assert.equal(described.thp, 'madvise');
  assert.equal(described.thpDefrag, null);
  assert.equal(described.image, '20261101.360.1');
  assert.deepEqual(described.memoryEnv, { MALLOC_ARENA_MAX: '2' });
  assert.ok(described.cores >= 1);
});
