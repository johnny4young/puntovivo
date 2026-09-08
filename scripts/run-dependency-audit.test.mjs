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
import { mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  AUDIT_ATTEMPTS,
  AUDIT_BACKOFF_MS,
  runAuditWithRetries,
} from './run-dependency-audit.mjs';

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

/**
 * Retry contract.
 *
 * The classifier that recognises a transport envelope is covered in
 * runtime-dependency-reachability.test.mjs. What is asserted here is the
 * policy built on top of it, which the classifier tests cannot reach: how
 * many attempts happen, which backoff each retry waits, that a later success
 * is returned rather than discarded, and that exhaustion throws instead of
 * returning a report the gate would read as clean. The audit call and the
 * clock are injected, so none of this touches a registry or real time.
 */

/** The real shape pnpm emits when the advisory endpoint times out. */
const TRANSPORT_FAILURE = { error: { code: 23, message: 'The operation was aborted due to timeout' } };
/** A parseable report with no transport envelope: a real answer. */
const CLEAN_REPORT = { advisories: {}, metadata: {} };

/**
 * Drive `runAuditWithRetries` over a scripted sequence of reports, recording
 * every slept interval so the backoff schedule is observable.
 */
function driveRetries(reports) {
  const slept = [];
  const logged = [];
  let calls = 0;
  const promise = runAuditWithRetries({
    runAudit: () => {
      const report = reports[calls];
      calls += 1;
      return { result: { status: 0, attempt: calls }, report };
    },
    sleep: async ms => {
      slept.push(ms);
    },
    log: line => logged.push(line),
  });
  return { promise, slept, logged, attempts: () => calls };
}

test('a first-attempt success neither retries nor waits', async () => {
  const run = driveRetries([CLEAN_REPORT]);
  const { report } = await run.promise;
  assert.equal(report, CLEAN_REPORT);
  assert.equal(run.attempts(), 1);
  assert.deepEqual(run.slept, [], 'a successful audit must not sleep');
  assert.deepEqual(run.logged, []);
});

test('a transport blip is retried and the later success is returned', async () => {
  const run = driveRetries([TRANSPORT_FAILURE, CLEAN_REPORT]);
  const { report, result } = await run.promise;
  assert.equal(report, CLEAN_REPORT, 'the recovered report must be returned, not the failure');
  assert.equal(result.attempt, 2);
  assert.equal(run.attempts(), 2);
  assert.deepEqual(run.slept, [AUDIT_BACKOFF_MS[0]], 'the first retry waits the first backoff');
  assert.equal(run.logged.length, 1);
  assert.match(run.logged[0], /attempt 1\/3 could not reach the advisory registry/);
});

test('exhausting every attempt fails closed instead of reporting a clean tree', async () => {
  const run = driveRetries(Array.from({ length: AUDIT_ATTEMPTS }, () => TRANSPORT_FAILURE));
  await assert.rejects(run.promise, error => {
    assert.match(error.message, /could not reach the advisory registry after 3 attempts/);
    assert.match(error.message, /error 23: The operation was aborted due to timeout/);
    assert.match(error.message, /The gate stays fail-closed\./);
    return true;
  });
  assert.equal(run.attempts(), AUDIT_ATTEMPTS, 'every configured attempt must be spent');
  assert.deepEqual(
    run.slept,
    AUDIT_BACKOFF_MS,
    'each retry waits its own backoff, and the final attempt is not followed by a wait'
  );
});

test('the backoff schedule covers exactly the retries the attempt count allows', () => {
  // An extra entry would be dead configuration; a missing one would make the
  // last retry wait `undefined` milliseconds, which setTimeout treats as 0.
  assert.equal(AUDIT_BACKOFF_MS.length, AUDIT_ATTEMPTS - 1);
  for (const waitMs of AUDIT_BACKOFF_MS) {
    assert.equal(Number.isInteger(waitMs) && waitMs > 0, true, `backoff ${waitMs} must be a positive integer`);
  }
});
