/**
 * Invocation contract for the dependency audit runner.
 *
 * The runner exports a pure decision (covered by
 * audit-disposition-policy.test.mjs) behind a direct-invocation guard. The
 * guard is security-relevant in a way the decision is not: if it mistakes a
 * real invocation for an import, the whole audit silently does nothing and
 * reports success. This suite pins that it does not, including through a
 * symlinked path, where a naive path comparison fails open.
 *
 * @module scripts/run-dependency-audit.test
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractRunnerAuditAdvisories } from './run-dependency-audit.mjs';

const RUNNER = fileURLToPath(new URL('./run-dependency-audit.mjs', import.meta.url));

/**
 * Run the audit entry point with the pnpm preflight deliberately unsatisfied.
 * A runner that executed prints the preflight refusal and exits 1; a runner
 * that skipped itself prints nothing and exits 0, which is the failure this
 * suite exists to catch.
 */
function runWithoutPnpmEnv(scriptPath) {
  const env = { ...process.env };
  delete env.npm_execpath;
  return spawnSync(process.execPath, [scriptPath], { encoding: 'utf8', env });
}

test('the runner executes when invoked directly', () => {
  const result = runWithoutPnpmEnv(RUNNER);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Run the dependency audit through pnpm/);
});

test('the runner still executes when reached through a symlink', () => {
  // import.meta.url is realpath-resolved while argv[1] is not, so comparing
  // them raw makes this invocation look like an import and skips the audit.
  const dir = mkdtempSync(join(tmpdir(), 'puntovivo-audit-guard-'));
  const link = join(dir, 'audit-link.mjs');
  try {
    symlinkSync(RUNNER, link);
    const result = runWithoutPnpmEnv(link);
    assert.equal(result.status, 1, 'a symlinked invocation must not silently skip the audit');
    assert.match(result.stderr, /Run the dependency audit through pnpm/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('importing the runner does not execute the audit', async () => {
  const module = await import('./run-dependency-audit.mjs');
  assert.equal(typeof module.decideAuditOutcome, 'function');
});

test('known pnpm timeout envelopes remain failed evidence with bounded diagnostics', () => {
  for (const code of [23, '23']) {
    assert.throws(
      () =>
        extractRunnerAuditAdvisories({
          error: { code, message: 'The operation was aborted due to timeout' },
        }),
      { message: 'pnpm audit failed (code 23): The operation was aborted due to timeout' }
    );
  }
});

test('unknown or sensitive error envelopes cannot be treated as clean or echoed', () => {
  for (const error of [
    null,
    'failure',
    { code: 999, message: 'secret' },
    { code: 23, message: '\u001b[31msecret'.repeat(10_000) },
  ]) {
    assert.throws(() => extractRunnerAuditAdvisories({ error, advisories: {} }), {
      message: 'pnpm audit returned an unsupported error report',
    });
  }
});

test('ordinary advisory reports retain their original extraction contract', () => {
  assert.deepEqual(extractRunnerAuditAdvisories({ advisories: {}, metadata: {} }), []);
  assert.throws(() => extractRunnerAuditAdvisories({}), /unsupported JSON report/);
});

test('CLI exits nonzero on a known timeout before requesting the dependency graph', () => {
  const dir = mkdtempSync(join(tmpdir(), 'puntovivo-audit-timeout-'));
  const pnpmEntry = join(dir, 'pnpm.cjs');
  try {
    writeFileSync(
      pnpmEntry,
      `
      if (process.argv[2] !== 'audit') throw new Error('Unexpected dependency graph request');
      console.log(JSON.stringify({ error: { code: 23, message: 'The operation was aborted due to timeout' } }));
      process.exitCode = 1;
    `
    );
    const result = spawnSync(process.execPath, [RUNNER], {
      encoding: 'utf8',
      env: { ...process.env, npm_execpath: pnpmEntry },
    });
    assert.equal(result.status, 1);
    assert.equal(result.stdout, '');
    assert.equal(
      result.stderr.trim(),
      'pnpm audit failed (code 23): The operation was aborted due to timeout'
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
