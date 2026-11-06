/**
 * Run the 50k-catalog sale profile in an isolated Vitest process, so its p95
 * is not measured beside the coverage pool.
 */

import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const serverRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const vitestPackage = fileURLToPath(import.meta.resolve('vitest/package.json'));
const vitestCli = resolve(dirname(vitestPackage), 'vitest.mjs');

const result = spawnSync(
  process.execPath,
  [vitestCli, 'run', 'src/__tests__/perf-sale-catalog-profile.test.ts', '--maxWorkers=1'],
  {
    cwd: serverRoot,
    env: { ...process.env, PUNTOVIVO_SALE_CATALOG_PROFILE: '1' },
    stdio: 'inherit',
  }
);

if (result.error) throw result.error;
if (result.signal) {
  throw new Error(`sale catalog profile gate terminated by signal ${result.signal}`);
}
process.exitCode = result.status ?? 1;
