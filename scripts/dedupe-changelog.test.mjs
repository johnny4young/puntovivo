import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { dedupeChangelog, dedupeChangelogFile } from './dedupe-changelog.mjs';

const link = sha => `([${sha}](https://github.com/acme/register/commit/${sha}))`;

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
  `* **desktop:** cap the worker heap ${link('92f0e1c')}`,
  `* **desktop:** cap the worker heap ${link('525a546')}`,
  `* **sales:** show site stock ${link('1111111')}`,
  '',
  '### Bug Fixes',
  '',
  `* **desktop:** cap the worker heap ${link('2222222')}`,
  '',
  '## [1.1.0](https://github.com/acme/register/compare/v1.0.0...v1.1.0) (2026-11-01)',
  '',
  `* **sales:** show site stock ${link('3333333')}`,
  '',
].join('\n');

test('drops repeated changes within a release and keeps the first', () => {
  const result = dedupeChangelog(changelog);
  assert.equal(result.removed, 2);
  assert.equal(result.releases, 2);
  assert.match(result.content, /92f0e1c/);
  assert.doesNotMatch(result.content, /525a546/);
  assert.doesNotMatch(result.content, /2222222/);
});

test('keeps the same change in another release and hand-written bullets', () => {
  const { content } = dedupeChangelog(changelog);
  assert.match(content, /3333333/);
  assert.equal(content.match(/- Hand-written note/g).length, 2);
});

test('is idempotent', () => {
  const once = dedupeChangelog(changelog).content;
  const twice = dedupeChangelog(once);
  assert.equal(twice.removed, 0);
  assert.equal(twice.content, once);
});

test('fails on a file without release sections instead of writing it', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'changelog-'));
  const file = path.join(dir, 'CHANGELOG.md');
  writeFileSync(file, '');
  assert.throws(() => dedupeChangelogFile(file), /no release sections/);
  assert.equal(readFileSync(file, 'utf8'), '');
});

test('rewrites the file only when something was removed', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'changelog-'));
  const file = path.join(dir, 'CHANGELOG.md');
  writeFileSync(file, changelog);
  assert.equal(dedupeChangelogFile(file).removed, 2);
  assert.equal(dedupeChangelogFile(file).removed, 0);
});
