/**
 * Run the small-fixture tRPC latency profile in an isolated Vitest process.
 *
 * The coverage suite fans out hundreds of functional files across workers.
 * Measuring wall-clock p95 inside that pool records scheduler contention, not
 * the procedure cost. Keep the checked-in budgets strict by giving this suite
 * one worker and an explicit opt-in flag after coverage completes.
 */

import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const serverRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const vitestPackage = fileURLToPath(import.meta.resolve('vitest/package.json'));
const vitestCli = resolve(dirname(vitestPackage), 'vitest.mjs');

const result = spawnSync(
  process.execPath,
  [vitestCli, 'run', 'src/__tests__/perf-trpc-latency.test.ts', '--maxWorkers=1'],
  {
    cwd: serverRoot,
    env: { ...process.env, PUNTOVIVO_TRPC_LATENCY_PROFILE: '1' },
    stdio: 'inherit',
  }
);

if (result.error) throw result.error;
if (result.signal) {
  throw new Error(`tRPC latency gate terminated by signal ${result.signal}`);
}
process.exitCode = result.status ?? 1;
