/**
 * unit tests for the advisory disposition policy and the audit's fail-closed
 * decision.
 *
 * Mirrors check-exact-override-policy.test.mjs: reads the real checked-in
 * config, then mutates structuredClone copies to drive each failure mode, and
 * travels in time through an explicit `now`. The decision itself is exercised
 * through the pure decideAuditOutcome seam, so no registry, child process, or
 * installed dependency graph is involved. Runs in ci:shared via node --test.
 *
 * @module scripts/audit-disposition-policy.test
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  MAX_DISPOSITION_DAYS,
  applyAuditDispositions,
  validateAuditDispositions,
} from './lib/audit-disposition-policy.mjs';
import { decideAuditOutcome } from './run-dependency-audit.mjs';

const REAL_POLICY = JSON.parse(
  readFileSync(new URL('../config/audit-dispositions.json', import.meta.url), 'utf8')
);

const NOW = new Date('2026-08-14T12:00:00.000Z');

/** A well-formed disposition group; individual tests break exactly one field. */
function disposition(overrides = {}) {
  return {
    category: 'tooling-unreachable',
    reviewedOn: '2026-08-10',
    reviewBy: '2026-09-01',
    reason: 'The advisory lands on a build-only toolchain package with no patched release.',
    removalCriteria: 'Remove once upstream publishes a patched release the workspace can adopt.',
    reachabilityArgument:
      'The package is absent from the production manifest graph, from the built web bundle, and from the packaged desktop asar file list.',
    advisories: { 'GHSA-aaaa-bbbb-cccc': 'demo-tool' },
    ...overrides,
  };
}

function policyWith(dispositions) {
  return { schemaVersion: 1, owner: 'platform-maintainers', dispositions };
}

const COUNTS = new Map([
  ['web', 211],
  ['server', 226],
  ['desktop', 289],
]);

/**
 * Reachability index shaped exactly like createRuntimeReachabilityIndex's
 * output, so the decision runs through the real classifier rather than a
 * pre-labelled fixture. `productionVersions` seeds the packages map: a
 * package listed here is production-reachable at those versions.
 */
function reachabilityIndex(productionVersions = {}) {
  return {
    artifactPackageCounts: COUNTS,
    packages: new Map(
      Object.entries(productionVersions).map(([name, version]) => [
        name,
        [{ artifact: 'desktop', path: [{ name: '@puntovivo/desktop' }, { name, version }] }],
      ])
    ),
  };
}

/**
 * Raw advisory as extractAuditAdvisories emits it. An empty vulnerableVersions
 * set is what the classifier turns into `unknown`.
 */
function advisory(overrides = {}) {
  return {
    id: 'GHSA-aaaa-bbbb-cccc',
    packageName: 'demo-tool',
    severity: 'high',
    title: 'Demo advisory',
    vulnerableVersions: new Set(['1.0.0']),
    ...overrides,
  };
}

function decide({
  advisories,
  policy = policyWith([]),
  auditStatus = 1,
  productionVersions = {},
}) {
  return decideAuditOutcome({
    advisories,
    reachability: reachabilityIndex(productionVersions),
    dispositions: validateAuditDispositions({ policy, now: NOW }),
    auditStatus,
  });
}

test('the checked-in disposition file is valid and empty in the steady state', () => {
  const result = validateAuditDispositions({ policy: REAL_POLICY, now: NOW });
  assert.equal(result.owner, 'platform-maintainers');
  assert.equal(result.dispositionCount, 0);
  assert.equal(result.nextReviewBy, null);
});

test('disposition metadata is mandatory and bounded', () => {
  const cases = [
    [{ category: 'invented' }, /unsupported category invented/],
    [{ reason: 'too short' }, /requires a concrete reason/],
    [{ removalCriteria: 'nope' }, /requires removal criteria/],
    [{ reachabilityArgument: 'unreachable, trust me' }, /requires a reachability argument/],
    [{ advisories: {} }, /requires advisories/],
    [{ advisories: { 'not-an-advisory': 'demo-tool' } }, /must be an advisory id the audit reports/],
    [{ advisories: { unknown: 'demo-tool' } }, /must be an advisory id the audit reports/],
    [{ advisories: { 'GHSA-aaaa-bbbb-cccc': '' } }, /requires the affected package name/],
    [{ reviewedOn: '2026-02-31' }, /reviewedOn is invalid/],
    [{ reviewedOn: 'yesterday' }, /must be an ISO calendar date/],
    [{ reviewedOn: '2026-09-01', reviewBy: '2026-09-10' }, /reviewedOn is in the future/],
    [{ reviewedOn: '2026-08-10', reviewBy: '2026-08-01' }, /reviewBy predates reviewedOn/],
  ];
  for (const [override, expected] of cases) {
    assert.throws(
      () => validateAuditDispositions({ policy: policyWith([disposition(override)]), now: NOW }),
      expected,
      `expected ${JSON.stringify(override)} to be rejected`
    );
  }
});

test('every advisory id shape the audit can emit is disposable', () => {
  // extractAuditAdvisories falls back from github_advisory_id to the first CVE
  // and then to the raw registry id, so a disposition must be expressible for
  // each; otherwise the gate prints an id the operator cannot act on.
  for (const advisoryId of ['GHSA-2v37-7h3g-55p8', 'CVE-2026-12345', '1088948']) {
    const result = validateAuditDispositions({
      policy: policyWith([disposition({ advisories: { [advisoryId]: 'demo-tool' } })]),
      now: NOW,
    });
    assert.equal(result.dispositionCount, 1, `expected ${advisoryId} to be accepted`);
  }
});

test('a disposition cannot stretch its category cadence', () => {
  assert.throws(
    () =>
      validateAuditDispositions({
        policy: policyWith([disposition({ reviewedOn: '2026-08-10', reviewBy: '2026-09-20' })]),
        now: NOW,
      }),
    /exceeds the 30-day tooling-unreachable cadence/
  );
  // awaiting-upstream-fix is deliberately the shorter window.
  assert.throws(
    () =>
      validateAuditDispositions({
        policy: policyWith([
          disposition({
            category: 'awaiting-upstream-fix',
            reviewedOn: '2026-08-10',
            reviewBy: '2026-09-01',
          }),
        ]),
        now: NOW,
      }),
    /exceeds the 14-day awaiting-upstream-fix cadence/
  );
  assert.equal(MAX_DISPOSITION_DAYS['awaiting-upstream-fix'], 14);
});

test('expired dispositions fail closed with their date', () => {
  assert.throws(
    () =>
      validateAuditDispositions({
        policy: policyWith([disposition()]),
        now: new Date('2026-09-02T00:00:00.000Z'),
      }),
    /expired on 2026-09-01; renew the review or remove the advisory/
  );
});

test('the same advisory cannot be disposed twice', () => {
  assert.throws(
    () =>
      validateAuditDispositions({
        policy: policyWith([
          disposition(),
          disposition({ category: 'awaiting-upstream-fix', reviewBy: '2026-08-20' }),
        ]),
        now: NOW,
      }),
    /GHSA-aaaa-bbbb-cccc is registered twice/
  );
});

test('an undisposed advisory still fails the gate', () => {
  const outcome = decide({ advisories: [advisory()] });
  assert.equal(outcome.exitCode, 1);
  assert.match(outcome.err[0], /\[high\] demo-tool GHSA-aaaa-bbbb-cccc/);
  assert.match(outcome.err.join('\n'), /does not authorize an exclusion/);
  assert.match(outcome.err.at(-1), /fail-closed for every undisposed advisory/);
});

test('a disposition cannot cover a runtime-reachable advisory', () => {
  // The classifier finds the vulnerable version in the production graph, so
  // the recorded acceptance is refused no matter what the file claims.
  const outcome = decide({
    advisories: [advisory()],
    policy: policyWith([disposition()]),
    productionVersions: { 'demo-tool': '1.0.0' },
  });
  assert.equal(outcome.exitCode, 1);
  assert.match(
    outcome.err.join('\n'),
    /Disposition refused: a disposition cannot cover a runtime-reachable advisory/
  );
  assert.match(outcome.err.join('\n'), /desktop: @puntovivo\/desktop/);
});

test('a disposition cannot cover an advisory of unknown reachability', () => {
  const outcome = decide({
    advisories: [advisory({ vulnerableVersions: new Set() })],
    policy: policyWith([disposition()]),
  });
  assert.equal(outcome.exitCode, 1);
  assert.match(outcome.err.join('\n'), /cannot cover a unknown advisory/);
});

test('a disposition recorded against another package does not apply', () => {
  const outcome = decide({
    advisories: [advisory({ packageName: 'other-package' })],
    policy: policyWith([disposition()]),
  });
  assert.equal(outcome.exitCode, 1);
  assert.match(outcome.err.join('\n'), /records package demo-tool, not other-package/);
});

test('a current disposition over an unreachable advisory passes with its deadline', () => {
  const outcome = decide({ advisories: [advisory()], policy: policyWith([disposition()]) });
  assert.equal(outcome.exitCode, 0);
  assert.equal(outcome.err.length, 0);
  assert.match(outcome.out[0], /GHSA-aaaa-bbbb-cccc: Demo advisory \(accepted until 2026-09-01\)/);
  assert.match(outcome.out.join('\n'), /removal: Remove once upstream publishes/);
  assert.match(outcome.out.at(-1), /1 advisory disposition\(s\) in force/);
});

test('a disposition whose advisory left the report is stale', () => {
  // Upstream shipped the fix and the advisory is gone: the acceptance must not
  // be inherited, whether or not other advisories remain.
  const cleanRun = decide({ advisories: [], policy: policyWith([disposition()]), auditStatus: 0 });
  assert.equal(cleanRun.exitCode, 1);
  assert.match(cleanRun.err.join('\n'), /no longer matches any advisory/);

  const mixedRun = decide({
    advisories: [advisory({ id: 'GHSA-dddd-eeee-ffff', packageName: 'another-tool' })],
    policy: policyWith([disposition()]),
  });
  assert.equal(mixedRun.exitCode, 1);
  assert.match(mixedRun.err.join('\n'), /GHSA-aaaa-bbbb-cccc \(demo-tool\) no longer matches/);
});

test('a clean audit reports reachability counts and exits zero', () => {
  const outcome = decide({ advisories: [], auditStatus: 0 });
  assert.equal(outcome.exitCode, 0);
  assert.equal(outcome.err.length, 0);
  assert.match(outcome.out[0], /No known vulnerabilities found\./);
  assert.match(outcome.out[0], /web=211, server=226, desktop=289/);
});

test('a clean report with a failing audit process still throws', () => {
  assert.throws(
    () => decide({ advisories: [], auditStatus: 1 }),
    /pnpm audit failed without advisories/
  );
});

test('applyAuditDispositions keeps every advisory accounted for', () => {
  const dispositions = validateAuditDispositions({
    policy: policyWith([disposition()]),
    now: NOW,
  });
  const classified = [
    { ...advisory(), classification: 'not-runtime-reachable', runtimePaths: [] },
    {
      ...advisory({ id: 'GHSA-dddd-eeee-ffff', packageName: 'other' }),
      classification: 'not-runtime-reachable',
      runtimePaths: [],
    },
  ];
  const { accepted, blocking, stale } = applyAuditDispositions({ classified, dispositions });
  assert.equal(accepted.length + blocking.length, classified.length);
  assert.equal(accepted[0].advisory.id, 'GHSA-aaaa-bbbb-cccc');
  assert.equal(blocking[0].advisory.id, 'GHSA-dddd-eeee-ffff');
  assert.equal(stale.length, 0);
});
