import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  evaluateCuratedNotes,
  isReleasePullRequest,
  releaseTagFromManifest,
  runReleaseNotesGate,
} from './release-notes-gate.mjs';

const REPOSITORY = 'acme/register';
const PUSHED_SHA = 'a'.repeat(40);
const RELEASE_HEAD = 'b'.repeat(40);
const RELEASE_BRANCH = 'release-please--branches--main--components--register';

const env = {
  GITHUB_REPOSITORY: REPOSITORY,
  GITHUB_SHA: PUSHED_SHA,
  GITHUB_REF_NAME: 'main',
  GITHUB_SERVER_URL: 'https://github.com',
  GITHUB_RUN_ID: '42',
};

const releasePullRequest = {
  number: 7,
  headRefName: RELEASE_BRANCH,
  headRefOid: RELEASE_HEAD,
  isCrossRepository: false,
};

const featurePullRequest = {
  number: 5,
  headRefName: 'feature/register-sync',
  headRefOid: 'c'.repeat(40),
  isCrossRepository: false,
};

function curatedNote(tag) {
  const paragraph = 'Operator facing context for this release. '.repeat(10);
  return [
    `# Puntovivo ${tag} — A release people can understand`,
    ...[
      '## Why this release matters',
      '## What changed',
      '## Before you use it',
      '## Downloads',
    ].flatMap(heading => [heading, paragraph]),
  ].join('\n\n');
}

function checkout(notes = {}) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'puntovivo-release-notes-gate-'));
  mkdirSync(path.join(root, 'docs', 'releases'), { recursive: true });
  for (const [tag, content] of Object.entries(notes)) {
    writeFileSync(path.join(root, 'docs', 'releases', `${tag}.md`), content);
  }
  return root;
}

function fakeGh({ head = PUSHED_SHA, pullRequests = [], manifests = {}, fail } = {}) {
  const calls = [];
  const run = (command, args, options) => {
    assert.equal(command, 'gh');
    assert.equal(options.encoding, 'utf8');
    calls.push(args);
    const request = args.join(' ');
    if (fail && request.includes(fail)) {
      return { status: 1, stdout: '', stderr: 'HTTP 502: Bad Gateway' };
    }
    if (request === `api repos/${REPOSITORY}/git/ref/heads/main --jq .object.sha`) {
      return { status: 0, stdout: `${head}\n`, stderr: '' };
    }
    if (request.startsWith(`pr list --repo ${REPOSITORY} --state open --base main `)) {
      return { status: 0, stdout: JSON.stringify(pullRequests), stderr: '' };
    }
    const manifest = request.match(/\/contents\/\.release-please-manifest\.json\?ref=(\w+)$/);
    if (manifest) {
      return { status: 0, stdout: manifests[manifest[1]], stderr: '' };
    }
    if (args[2] === 'POST') {
      return { status: 0, stdout: '{}', stderr: '' };
    }
    throw new Error(`Unexpected gh call: ${request}`);
  };
  return { calls, run };
}

function postedStatuses(calls) {
  return calls
    .filter(args => args[2] === 'POST')
    .map(args => ({
      endpoint: args[3],
      ...Object.fromEntries(
        args
          .filter((_, index) => args[index - 1] === '-f')
          .map(field => [field.slice(0, field.indexOf('=')), field.slice(field.indexOf('=') + 1)])
      ),
    }));
}

test('only release-please branches of this repository into the pushed branch count', () => {
  const pullRequest = (headRefName, isCrossRepository = false) => ({
    headRefName,
    isCrossRepository,
  });

  assert.equal(isReleasePullRequest(pullRequest('release-please--branches--main'), 'main'), true);
  assert.equal(isReleasePullRequest(pullRequest(RELEASE_BRANCH), 'main'), true);
  assert.equal(isReleasePullRequest(pullRequest(RELEASE_BRANCH, true), 'main'), false);
  assert.equal(
    isReleasePullRequest(pullRequest('release-please--branches--main-next'), 'main'),
    false
  );
  assert.equal(
    isReleasePullRequest(
      pullRequest('release-please--branches--develop--components--register'),
      'main'
    ),
    false
  );
  assert.equal(isReleasePullRequest(pullRequest(`docs/${RELEASE_BRANCH}`), 'main'), false);
});

test('the release tag is the single version the manifest declares', () => {
  assert.equal(releaseTagFromManifest('{ ".": "2.0.0" }'), 'v2.0.0');
  assert.throws(() => releaseTagFromManifest('{}'), /exactly one component, found 0/);
  assert.throws(
    () => releaseTagFromManifest('{ ".": "2.0.0", "apps/web": "2.0.0" }'),
    /exactly one component, found 2/
  );
  assert.throws(() => releaseTagFromManifest('not json'), SyntaxError);
});

test('the verdict fails until the branch has a valid curated note for the tag', () => {
  const root = checkout({
    'v2.0.0': curatedNote('v2.0.0'),
    'v2.1.0': '# Puntovivo v2.1.0 — Too short',
  });
  mkdirSync(path.join(root, 'docs', 'releases', 'v2.3.0.md'));

  assert.deepEqual(evaluateCuratedNotes('v2.0.0', { root }), {
    state: 'success',
    description: 'docs/releases/v2.0.0.md on main is valid',
  });
  assert.deepEqual(evaluateCuratedNotes('v2.1.0', { root }), {
    state: 'failure',
    description:
      'docs/releases/v2.1.0.md on main: Release notes are missing required heading: ## Why this release matters',
  });
  assert.deepEqual(evaluateCuratedNotes('v2.2.0', { root }), {
    state: 'failure',
    description: 'Add docs/releases/v2.2.0.md to main before merging',
  });
  // Only a missing note is the expected failure; a note that cannot be read
  // leaves the verdict undetermined.
  assert.throws(() => evaluateCuratedNotes('v2.3.0', { root }), { code: 'EISDIR' });
  assert.throws(() => evaluateCuratedNotes('v2.0.0/../../x', { root }), /Invalid release tag/);
});

test('the gate posts its verdict on the head of the open release pull request', () => {
  const root = checkout({ 'v2.0.0': curatedNote('v2.0.0') });
  const gh = fakeGh({
    pullRequests: [
      featurePullRequest,
      { ...releasePullRequest, number: 6, headRefOid: 'd'.repeat(40), isCrossRepository: true },
      releasePullRequest,
    ],
    manifests: { [RELEASE_HEAD]: '{ ".": "2.0.0" }' },
  });

  const reports = runReleaseNotesGate({ env, root, run: gh.run, log() {} });

  assert.deepEqual(reports, [
    {
      number: 7,
      sha: RELEASE_HEAD,
      state: 'success',
      description: 'docs/releases/v2.0.0.md on main is valid',
    },
  ]);
  assert.deepEqual(postedStatuses(gh.calls), [
    {
      endpoint: `repos/${REPOSITORY}/statuses/${RELEASE_HEAD}`,
      state: 'success',
      // docs/releases/README.md tells maintainers to wait for this status by name.
      context: 'Curated release notes',
      description: 'docs/releases/v2.0.0.md on main is valid',
      target_url: `https://github.com/${REPOSITORY}/actions/runs/42`,
    },
  ]);
});

test('a missing note is a failing status, not a failing run', () => {
  const gh = fakeGh({
    pullRequests: [releasePullRequest],
    manifests: { [RELEASE_HEAD]: '{ ".": "2.0.0" }' },
  });

  const reports = runReleaseNotesGate({ env, root: checkout(), run: gh.run, log() {} });

  assert.deepEqual(
    reports.map(({ state }) => state),
    ['failure']
  );
  assert.deepEqual(
    postedStatuses(gh.calls).map(({ state, description }) => ({ state, description })),
    [{ state: 'failure', description: 'Add docs/releases/v2.0.0.md to main before merging' }]
  );
});

test('the gate posts nothing when the branch moved on or no release pull request is open', () => {
  const root = checkout();
  const superseded = fakeGh({ head: 'e'.repeat(40), pullRequests: [releasePullRequest] });
  const messages = [];

  assert.deepEqual(
    runReleaseNotesGate({ env, root, run: superseded.run, log: message => messages.push(message) }),
    []
  );
  assert.equal(superseded.calls.length, 1, 'a superseded run must stop before it reads anything');
  assert.match(messages[0], /the run for e{40} reports instead/);

  const idle = fakeGh({ pullRequests: [featurePullRequest] });
  assert.deepEqual(runReleaseNotesGate({ env, root, run: idle.run, log() {} }), []);
  assert.deepEqual(postedStatuses(idle.calls), []);
});

test('a manifest the gate cannot interpret posts an error status and fails the run', () => {
  const gh = fakeGh({ pullRequests: [releasePullRequest], manifests: { [RELEASE_HEAD]: '{}' } });

  assert.throws(
    () => runReleaseNotesGate({ env, root: checkout(), run: gh.run, log() {} }),
    /^Error: Pull request #7: Cannot check the curated note: \.release-please-manifest\.json must declare exactly one component, found 0$/
  );
  assert.deepEqual(
    postedStatuses(gh.calls).map(({ state }) => state),
    ['error']
  );
});

test('the gate stops before posting when GitHub or its workflow context is unavailable', () => {
  const root = checkout();
  const gh = fakeGh({
    pullRequests: [releasePullRequest],
    fail: '/contents/.release-please-manifest.json',
  });

  assert.throws(
    () => runReleaseNotesGate({ env, root, run: gh.run, log() {} }),
    /^Error: Could not read \.release-please-manifest\.json from pull request #7: HTTP 502: Bad Gateway$/
  );
  assert.deepEqual(postedStatuses(gh.calls), []);

  const outside = fakeGh();
  assert.throws(
    () => runReleaseNotesGate({ env: { ...env, GITHUB_SHA: '' }, root, run: outside.run }),
    /GITHUB_SHA is not set/
  );
  assert.deepEqual(outside.calls, []);
});

test('a status description longer than GitHub accepts is shortened', () => {
  const gh = fakeGh({
    pullRequests: [releasePullRequest],
    manifests: { [RELEASE_HEAD]: JSON.stringify({ '.': `2.0.0-${'rc.'.repeat(40)}1` }) },
  });

  const [report] = runReleaseNotesGate({ env, root: checkout(), run: gh.run, log() {} });
  const [status] = postedStatuses(gh.calls);

  assert.ok(report.description.length > 140);
  assert.equal(status.description, `${report.description.slice(0, 139)}…`);
});

test('release-please reports the curated notes status after every push with least privilege', () => {
  const workflow = readFileSync(
    new URL('../.github/workflows/release-please.yml', import.meta.url),
    'utf8'
  );
  const lines = workflow.split('\n');
  const start = lines.indexOf('  release-notes-gate:');
  assert.notEqual(start, -1, 'expected a release-notes-gate job');
  const end = lines.findIndex((line, index) => index > start && /^ {2}[\w-]+:$/u.test(line));
  const job = lines.slice(start, end === -1 ? undefined : end).join('\n');

  assert.match(job, /^ {4}needs: release-please$/m);
  // release-please opens and refreshes its pull request on pushes that create
  // no release, and those are the pushes that land a curated note, so a
  // condition on release_created would skip every run that matters.
  assert.doesNotMatch(job, /^ {4}if:/m);
  assert.match(
    job,
    /^ {4}permissions:\n {6}contents: read\n {6}pull-requests: read\n {6}statuses: write\n {4}steps:$/m
  );
  assert.match(job, /^ {10}persist-credentials: false$/m);
  assert.match(job, /^ {10}GH_TOKEN: \$\{\{ github\.token \}\}$/m);
  assert.match(job, /^ {8}run: node scripts\/release-notes-gate\.mjs$/m);
});
