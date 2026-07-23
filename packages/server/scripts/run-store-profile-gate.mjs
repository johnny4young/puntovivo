/**
 * Run the store-sized wall-clock profile in an isolated Vitest process.
 *
 * The ordinary server coverage suite fans out across many workers. Measuring
 * p95 there records scheduler contention from unrelated tests rather than the
 * SQLite/tRPC read cost. This launcher is shell-free and portable: ci:server
 * invokes it after coverage, with one worker and an explicit opt-in flag that
 * enables the otherwise skipped profile suite.
 */

import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const serverRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const vitestPackage = fileURLToPath(import.meta.resolve('vitest/package.json'));
const vitestCli = resolve(dirname(vitestPackage), 'vitest.mjs');

const result = spawnSync(
  process.execPath,
  [vitestCli, 'run', 'src/__tests__/perf-store-profile.test.ts', '--maxWorkers=1'],
  {
    cwd: serverRoot,
    env: { ...process.env, PUNTOVIVO_STORE_PROFILE: '1' },
    stdio: 'inherit',
  }
);

if (result.error) throw result.error;
if (result.signal) {
  throw new Error(`store profile gate terminated by signal ${result.signal}`);
}
process.exitCode = result.status ?? 1;
