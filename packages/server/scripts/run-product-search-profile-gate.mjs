/**
 * Run the product-search scale profile in an isolated Vitest process.
 *
 * Search p95 is meaningful only when the 1k/10k/50k catalog owns the host.
 * Keep this launcher shell-free and run it after the other server profiles.
 */

import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const serverRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const vitestPackage = fileURLToPath(import.meta.resolve('vitest/package.json'));
const vitestCli = resolve(dirname(vitestPackage), 'vitest.mjs');

const result = spawnSync(
  process.execPath,
  [vitestCli, 'run', 'src/__tests__/perf-product-search-profile.test.ts', '--maxWorkers=1'],
  {
    cwd: serverRoot,
    env: { ...process.env, PUNTOVIVO_PRODUCT_SEARCH_PROFILE: '1' },
    stdio: 'inherit',
  }
);

if (result.error) throw result.error;
if (result.signal) {
  throw new Error(`product search profile gate terminated by signal ${result.signal}`);
}
process.exitCode = result.status ?? 1;
