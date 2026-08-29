/** Run the 100k-row audit verification/redaction profile without CI contention. */
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const serverRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const vitestPackage = fileURLToPath(import.meta.resolve('vitest/package.json'));
const vitestCli = resolve(dirname(vitestPackage), 'vitest.mjs');

const result = spawnSync(
  process.execPath,
  [vitestCli, 'run', 'src/__tests__/perf-audit-chain-profile.test.ts', '--maxWorkers=1'],
  {
    cwd: serverRoot,
    env: { ...process.env, PUNTOVIVO_AUDIT_CHAIN_PROFILE: '1' },
    stdio: 'inherit',
  }
);

if (result.error) throw result.error;
if (result.signal) throw new Error(`audit-chain profile gate terminated by ${result.signal}`);
process.exitCode = result.status ?? 1;
