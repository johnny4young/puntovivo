import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { dedupeChangelog, dedupeChangelogFile, isMergeCommit } from './dedupe-changelog.mjs';

const link = sha => `([${sha}](https://github.com/acme/register/commit/${sha}))`;
const merges = new Set(['aaaaaaa', 'bbbbbbb', 'ccccccc', 'ddddddd', 'eeeeeee']);
const isMerge = sha => merges.has(sha);

const changelog = [
  '# Changelog',
  '',
  '## Unreleased',
  '',
  '- Hand-written note',
  '- Hand-written note',
  '',
  '## [1.2.0](https://github.com/acme/register/compare/v1.1.0...v1.2.0) (2026-11-13)',
  '',
  '### Features',
  '',
  `* **desktop:** cap the worker heap ${link('aaaaaaa')}`,
  `* **desktop:** cap the worker heap ${link('1111111')}`,
  `* **sales:** show site stock ${link('2222222')}`,
  `* **server:** end realtime streams ${link('3333333')}`,
  `* **server:** end realtime streams ${link('4444444')}`,
  '',
  '### Bug Fixes',
  '',
  `* **sales:** show site stock ${link('bbbbbbb')}`,
  '',
  '## [1.1.0](https://github.com/acme/register/compare/v1.0.0...v1.1.0) (2026-11-01)',
  '',
  `* **sales:** show site stock ${link('ccccccc')}`,
  '',
].join('\n');

test('drops a merge-commit repeat and keeps the commit that made the change', () => {
  const result = dedupeChangelog(changelog, isMerge);
  assert.equal(result.removed, 2);
  assert.equal(result.releases, 2);
  assert.match(result.content, /1111111/);
  assert.match(result.content, /2222222/);
  assert.doesNotMatch(result.content, /aaaaaaa/);
  assert.doesNotMatch(result.content, /bbbbbbb/);
});

test('keeps distinct commits that share a message', () => {
  const { content } = dedupeChangelog(changelog, isMerge);
  assert.match(content, /3333333/);
  assert.match(content, /4444444/);
});

test('keeps repeated merge commits when no regular commit has their text', () => {
  const release = [
    '## [1.3.0](https://github.com/acme/register/compare/v1.2.0...v1.3.0) (2026-11-20)',
    '',
    `* **deps:** bump the website ${link('ddddddd')}`,
    `* **deps:** bump the website ${link('eeeeeee')}`,
    '',
  ].join('\n');
  assert.equal(dedupeChangelog(release, isMerge).removed, 0);
});

test('drops a subsection that only held repeats', () => {
  const { content } = dedupeChangelog(changelog, isMerge);
  assert.doesNotMatch(content, /### Bug Fixes/);
  assert.match(content, /4444444\)\)\n\n## \[1\.1\.0\]/);
});

test('keeps the breaking-change note of a breaking PR', () => {
  const merge = `* **sync:** drop the v1 protocol ${link('ccccccc')}`;
  const change = `* **sync:** drop the v1 protocol ${link('5555555')}`;
  const release = [
    '## [2.0.0](https://github.com/acme/register/compare/v1.2.0...v2.0.0) (2026-11-20)',
    '',
    '### ⚠ BREAKING CHANGES',
    '',
    merge,
    '',
    '### Features',
    '',
    merge,
    change,
    '',
  ].join('\n');
  const { content, removed } = dedupeChangelog(release, isMerge);
  assert.equal(removed, 1);
  assert.match(
    content,
    /### ⚠ BREAKING CHANGES\n\n\* \*\*sync:\*\* drop the v1 protocol \(\[ccccccc\]/
  );
  assert.match(content, /### Features\n\n\* \*\*sync:\*\* drop the v1 protocol \(\[5555555\]/);
});

test('keeps other releases and hand-written bullets, and asks only about repeats', () => {
  const asked = [];
  const { content } = dedupeChangelog(changelog, sha => {
    asked.push(sha);
    return isMerge(sha);
  });
  assert.match(content, /ccccccc/);
  assert.equal(content.match(/- Hand-written note/g).length, 2);
  assert.deepEqual(asked.sort(), [
    '1111111',
    '2222222',
    '3333333',
    '4444444',
    'aaaaaaa',
    'bbbbbbb',
  ]);
});

test('is idempotent', () => {
  const once = dedupeChangelog(changelog, isMerge).content;
  const twice = dedupeChangelog(once, isMerge);
  assert.equal(twice.removed, 0);
  assert.equal(twice.content, once);
});

test('fails on a file without release sections instead of writing it', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'changelog-'));
  const file = path.join(dir, 'CHANGELOG.md');
  writeFileSync(file, '');
  assert.throws(() => dedupeChangelogFile(file, isMerge), /no release sections/);
  assert.equal(readFileSync(file, 'utf8'), '');
});

test('rewrites the file only when something was removed', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'changelog-'));
  const file = path.join(dir, 'CHANGELOG.md');
  writeFileSync(file, changelog);
  assert.equal(dedupeChangelogFile(file, isMerge).removed, 2);
  assert.equal(dedupeChangelogFile(file, isMerge).removed, 0);
});

test('reads merge commits from git and fails on a commit it does not have', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'changelog-git-'));
  const git = (...args) =>
    execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], {
      cwd: dir,
      encoding: 'utf8',
      env: { ...process.env, GIT_CONFIG_GLOBAL: os.devnull, GIT_CONFIG_NOSYSTEM: '1' },
    }).trim();
  git('init', '-q', '-b', 'main');
  git('commit', '-q', '--allow-empty', '-m', 'base');
  git('checkout', '-q', '-b', 'topic');
  git('commit', '-q', '--allow-empty', '-m', 'change');
  const change = git('rev-parse', '--short', 'HEAD');
  git('checkout', '-q', 'main');
  git('merge', '-q', '--no-ff', '-m', 'merge', 'topic');
  const merge = git('rev-parse', '--short', 'HEAD');

  assert.equal(isMergeCommit(merge, dir), true);
  assert.equal(isMergeCommit(change, dir), false);
  assert.throws(() => isMergeCommit('0000000', dir));

  const file = path.join(dir, 'CHANGELOG.md');
  writeFileSync(
    file,
    [
      '## [1.0.0](https://github.com/acme/register/compare/v0.9.0...v1.0.0) (2026-11-20)',
      '',
      `* **core:** change ${link(merge)}`,
      `* **core:** change ${link(change)}`,
      '',
    ].join('\n')
  );
  assert.equal(dedupeChangelogFile(file).removed, 1);
  assert.doesNotMatch(readFileSync(file, 'utf8'), new RegExp(merge));
});

test('release-please dedupes the Release PR branch it opened or updated', () => {
  const workflow = readFileSync(
    new URL('../.github/workflows/release-please.yml', import.meta.url),
    'utf8'
  );
  const lines = workflow.split('\n');
  const start = lines.indexOf('  dedupe-changelog:');
  assert.notEqual(start, -1, 'expected a dedupe-changelog job');
  const end = lines.findIndex((line, index) => index > start && /^ {2}[\w-]+:$/u.test(line));
  const job = lines.slice(start, end === -1 ? undefined : end).join('\n');

  assert.match(job, /^ {4}if: \$\{\{ needs\.release-please\.outputs\.pr_branch != '' \}\}$/m);
  assert.match(job, /^ {10}ref: \$\{\{ needs\.release-please\.outputs\.pr_branch \}\}$/m);
  assert.match(job, /^ {10}fetch-depth: 0$/m);
  assert.match(job, /node scripts\/dedupe-changelog\.mjs CHANGELOG\.md/);
  assert.match(job, /a newer run owns the branch/);
});
