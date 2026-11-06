/**
 * Temporary hosted diagnostic: samples the audit-chain profile under runtime
 * and allocator variants on one runner, interleaved so every variant sees the
 * same host. Never judges a budget; it only prints evidence.
 */
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describeGrowth, describeHost } from './run-audit-chain-profile-gate.mjs';

const serverRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ROUNDS = Number(process.env.DIAG_ROUNDS ?? 4);
const VARIANTS = [
  { name: 'default', execArgv: [], env: {} },
  { name: 'settled', execArgv: ['--expose-gc'], env: {} },
  { name: 'settled-growing-50', execArgv: ['--expose-gc', '--heap-growing-percent=50'], env: {} },
  { name: 'settled-growing-100', execArgv: ['--expose-gc', '--heap-growing-percent=100'], env: {} },
];

const vitestCli = resolve(
  dirname(fileURLToPath(import.meta.resolve('vitest/package.json'))),
  'vitest.mjs'
);

function sample(variant) {
  const result = spawnSync(
    process.execPath,
    [
      vitestCli,
      'run',
      'src/__tests__/perf-audit-chain-profile.test.ts',
      '--maxWorkers=1',
      ...variant.execArgv.map(flag => `--execArgv=${flag}`),
    ],
    {
      cwd: serverRoot,
      env: { ...process.env, PUNTOVIVO_AUDIT_CHAIN_PROFILE: '1', ...variant.env },
      encoding: 'utf8',
    }
  );
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
  const match = /audit-chain-profile measured=(\{.*\})/.exec(output);
  return match ? JSON.parse(match[1]) : null;
}

console.log(`diag host ${JSON.stringify(describeHost())}`);
const results = new Map(VARIANTS.map(variant => [variant.name, []]));
for (let round = 1; round <= ROUNDS; round += 1) {
  for (const variant of VARIANTS) {
    const measured = sample(variant);
    if (!measured) {
      console.log(`diag variant=${variant.name} round=${round} NO MEASUREMENT`);
      continue;
    }
    results.get(variant.name).push(measured.maxRssGrowthMiB);
    console.log(
      `diag variant=${variant.name} round=${round} maxRss=${measured.maxRssGrowthMiB} verifyRss=${measured.verifyMaxRssGrowthMiB} verifyMs=${measured.verifyElapsedMs} redactMs=${measured.redactElapsedMs} growth=[${describeGrowth(measured)}] memory=${JSON.stringify(measured.memory)}`
    );
  }
}
for (const [name, values] of results) {
  const sorted = [...values].sort((a, b) => a - b);
  console.log(
    `diag summary variant=${name} n=${values.length} min=${sorted[0]} median=${sorted[Math.floor(sorted.length / 2)]} max=${sorted.at(-1)} values=${values.join(',')}`
  );
}
