/**
 * Run the 100k-row audit verification/redaction profile without CI contention.
 *
 * RSS growth is a noisy measurement. Observed on one unchanged tree: 82, 99,
 * 102 and 169 MiB locally, and 204 on a loaded GitHub runner against a 160 MiB
 * ceiling. A single sample therefore cannot tell a real regression from a busy
 * host, and the two have opposite correct responses — re-run versus fix. That
 * ambiguity already produced two false reds.
 *
 * So this gate, not the test, judges every budget: a sample over any of them
 * is re-sampled and each metric's MEDIAN decides. A failing test is never
 * re-sampled, because it is a correctness failure.
 */
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const serverRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Samples taken when the first one fails. Odd, so the median is a sample. */
export const MAX_SAMPLES = 3;
const MEASURED_PATTERN = /audit-chain-profile measured=(\{.*\})/;

function readBudget() {
  const budget = JSON.parse(readFileSync(resolve(serverRoot, '../../perf-budget.json'), 'utf8'));
  return budget.auditChainProfile;
}

const median = values => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];

/**
 * Judge measured samples against `auditChainProfile`. Elapsed ceilings carry
 * the declared host-variance allowance; the RSS ceiling is exact.
 */
export function judgeAuditChainSamples(samples, budget) {
  const allowance = 1 + budget.thresholdPercent / 100;
  const limits = [
    { metric: 'verifyElapsedMs', ceiling: budget.verifyElapsedMs * allowance, unit: 'ms' },
    { metric: 'redactElapsedMs', ceiling: budget.redactElapsedMs * allowance, unit: 'ms' },
    { metric: 'maxRssGrowthMiB', ceiling: budget.maxRssGrowthMiB, unit: 'MiB' },
  ];
  const overBudget = [];
  for (const { metric, ceiling, unit } of limits) {
    const values = samples.map(sample => sample[metric]);
    const value = median(values);
    if (!Number.isFinite(value) || value > ceiling) {
      overBudget.push(
        `${metric} median ${value} ${unit} exceeds ${Number(ceiling.toFixed(2))} ${unit} (samples: ${values.join(', ')})`
      );
    }
  }
  return { ok: overBudget.length === 0, overBudget };
}

function runOnce() {
  const vitestPackage = fileURLToPath(import.meta.resolve('vitest/package.json'));
  const vitestCli = resolve(dirname(vitestPackage), 'vitest.mjs');
  const result = spawnSync(
    process.execPath,
    [vitestCli, 'run', 'src/__tests__/perf-audit-chain-profile.test.ts', '--maxWorkers=1'],
    {
      cwd: serverRoot,
      env: { ...process.env, PUNTOVIVO_AUDIT_CHAIN_PROFILE: '1' },
      encoding: 'utf8',
    }
  );
  if (result.error) throw result.error;
  if (result.signal) throw new Error(`audit-chain profile gate terminated by ${result.signal}`);

  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
  process.stdout.write(output);
  const match = MEASURED_PATTERN.exec(output);
  return {
    passed: result.status === 0,
    measured: match ? JSON.parse(match[1]) : null,
  };
}

/** Returns the process exit code. */
export function runGate({ run = runOnce, budget = readBudget(), log = console.error } = {}) {
  const samples = [];
  for (let attempt = 1; attempt <= MAX_SAMPLES; attempt += 1) {
    const sample = run();
    if (!sample.passed || !sample.measured) {
      log(
        `audit-chain profile FAILED on sample ${attempt}: the test failed or measured nothing. Not re-sampling a correctness failure.`
      );
      return 1;
    }
    samples.push(sample.measured);
    const verdict = judgeAuditChainSamples(samples, budget);
    if (attempt === 1 && verdict.ok) return 0;
    if (attempt === MAX_SAMPLES) {
      if (verdict.ok) {
        log(
          `audit-chain profile passed on re-sampling: every median is within budget over ${samples.length} samples. The first sample was host noise, not a regression.`
        );
        return 0;
      }
      log(`audit-chain profile FAILED over ${samples.length} samples:`);
      for (const line of verdict.overBudget) log(`  ${line}`);
      return 1;
    }
    if (attempt === 1) {
      log(
        `audit-chain profile: sample 1/${MAX_SAMPLES} over budget (${verdict.overBudget.join('; ')}); re-sampling before deciding.`
      );
    }
  }
  return 1;
}

const isDirectInvocation =
  process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirectInvocation) {
  process.exitCode = runGate();
}
