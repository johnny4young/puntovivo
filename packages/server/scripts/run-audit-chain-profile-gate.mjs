/**
 * Run the 100k-row audit verification/redaction profile without CI contention.
 *
 * RSS growth is a noisy measurement. Observed on one unchanged tree: 82, 99,
 * 102 and 169 MiB locally, and 204 on a loaded GitHub runner against a 160 MiB
 * ceiling. A single sample therefore cannot tell a real regression from a busy
 * host, and the two have opposite correct responses — re-run versus fix. That
 * ambiguity already produced two false reds.
 *
 * So this gate samples like the Lighthouse one does. A first run that passes
 * costs nothing extra, which is the common case. A run that fails is
 * re-sampled, and the verdict is the MEDIAN of the samples against the budget:
 * a genuine regression fails every sample and still fails the median, while a
 * single loaded run no longer decides the build on its own.
 */
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const serverRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const vitestPackage = fileURLToPath(import.meta.resolve('vitest/package.json'));
const vitestCli = resolve(dirname(vitestPackage), 'vitest.mjs');

/** Samples taken when the first one fails. Odd, so the median is a sample. */
const MAX_SAMPLES = 3;
const MEASURED_PATTERN = /audit-chain-profile measured=(\{.*\})/;

function readRssBudget() {
  const budget = JSON.parse(readFileSync(resolve(serverRoot, '../../perf-budget.json'), 'utf8'));
  return budget.auditChainProfile.maxRssGrowthMiB;
}

function runOnce() {
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
    ok: result.status === 0,
    // Absent when the run failed before reaching the measurement, which is a
    // real failure and must not be re-sampled away.
    rss: match ? JSON.parse(match[1]).maxRssGrowthMiB : null,
  };
}

const median = values => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];

const first = runOnce();
if (first.ok) {
  process.exitCode = 0;
} else if (first.rss === null) {
  console.error('audit-chain profile failed before it measured anything; not re-sampling.');
  process.exitCode = 1;
} else {
  const budgetRss = readRssBudget();
  const samples = [first.rss];
  console.error(
    `audit-chain profile: sample 1/${MAX_SAMPLES} measured ${first.rss} MiB against ${budgetRss}; re-sampling before deciding.`
  );

  let sawNonRssFailure = false;
  for (let attempt = 2; attempt <= MAX_SAMPLES; attempt += 1) {
    const next = runOnce();
    if (next.rss === null) {
      sawNonRssFailure = true;
      break;
    }
    samples.push(next.rss);
    console.error(
      `audit-chain profile: sample ${attempt}/${MAX_SAMPLES} measured ${next.rss} MiB.`
    );
  }

  const medianRss = median(samples);
  if (sawNonRssFailure) {
    console.error('audit-chain profile hit a failure other than the RSS ceiling.');
    process.exitCode = 1;
  } else if (medianRss > budgetRss) {
    console.error(
      `audit-chain profile FAILED: median RSS growth ${medianRss} MiB over ${samples.length} samples exceeds ${budgetRss} MiB. Samples: ${samples.join(', ')}.`
    );
    process.exitCode = 1;
  } else {
    console.error(
      `audit-chain profile passed on re-sampling: median ${medianRss} MiB within ${budgetRss} MiB. Samples: ${samples.join(', ')}. The first sample was host noise, not a regression.`
    );
    process.exitCode = 0;
  }
}
