import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  humanReleaseNotesPath,
  publishHumanReleaseNotes,
  validateHumanReleaseNotes,
} from './publish-human-release-notes.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const validNotes = `# Puntovivo v2.0.0 — A release people can understand

## Why this release matters
${'Everyday operator context. '.repeat(20)}

## What changed
${'Visible outcome and practical detail. '.repeat(20)}

## Before you use it
${'Honest limitation and migration note. '.repeat(20)}

## Downloads
${'Platform and release link. '.repeat(20)}
`;

test('release note paths accept version tags and reject path traversal', () => {
  assert.equal(
    humanReleaseNotesPath('v1.9.0', '/repo'),
    path.join('/repo', 'docs', 'releases', 'v1.9.0.md')
  );
  assert.throws(() => humanReleaseNotesPath('../../release', '/repo'), /Invalid release tag/);
});

test('human notes require the reader-facing structure and enough context', () => {
  assert.doesNotThrow(() => validateHumanReleaseNotes('v2.0.0', validNotes));
  assert.throws(
    () => validateHumanReleaseNotes('v2.0.0', '# Puntovivo v2.0.0 — Short'),
    /missing required heading/
  );
});

test('every tracked stable release has a valid human-first note', () => {
  const tags = readdirSync(path.join(repoRoot, 'docs', 'releases'))
    .filter(file => /^v\d+\.\d+\.\d+\.md$/.test(file))
    .map(file => path.basename(file, '.md'))
    .sort();

  assert.ok(tags.length > 0, 'expected at least one curated release note');
  for (const tag of tags) {
    const content = readFileSync(humanReleaseNotesPath(tag, repoRoot), 'utf8');
    assert.doesNotThrow(() => validateHumanReleaseNotes(tag, content));
  }
});

test('the version the release manifest declares already has its curated note', () => {
  // A release-please pull request bumps this manifest to the version it will
  // tag. Failing here while the note is missing is the only thing that stops
  // that pull request from merging first and leaving the release with the
  // generated changelog, as happened for v1.11.0 through v1.14.1 and v1.14.3:
  // the publishing job checks out the tag, so it cannot be fixed afterwards
  // without editing the published release by hand.
  const manifest = JSON.parse(
    readFileSync(path.join(repoRoot, '.release-please-manifest.json'), 'utf8')
  );
  const versions = Object.values(manifest);
  assert.equal(versions.length, 1, 'expected exactly one component in the release manifest');

  const tag = `v${versions[0]}`;
  const notesPath = humanReleaseNotesPath(tag, repoRoot);
  let content;
  try {
    content = readFileSync(notesPath, 'utf8');
  } catch {
    assert.fail(
      `${path.relative(repoRoot, notesPath)} is missing; add the curated note before merging the release pull request (docs/releases/README.md)`
    );
  }
  validateHumanReleaseNotes(tag, content);
});

test('publisher validates the tracked note and edits the matching release', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'puntovivo-release-notes-'));
  const notesDir = path.join(root, 'docs', 'releases');
  mkdirSync(notesDir, { recursive: true });
  writeFileSync(path.join(notesDir, 'v2.0.0.md'), validNotes);
  const calls = [];
  const result = publishHumanReleaseNotes('v2.0.0', {
    root,
    run(command, args, options) {
      calls.push({ command, args, options });
      return { status: 0, stdout: '', stderr: '' };
    },
  });

  assert.deepEqual(result, {
    tag: 'v2.0.0',
    notesPath: path.join('docs', 'releases', 'v2.0.0.md'),
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].command, 'gh');
  assert.deepEqual(calls[0].args, [
    'release',
    'edit',
    'v2.0.0',
    '--notes-file',
    path.join('docs', 'releases', 'v2.0.0.md'),
  ]);
  assert.equal(calls[0].options.cwd, root);
});

test('release workflow publishes curated notes from the exact created tag', async () => {
  const workflow = await import('node:fs').then(({ readFileSync }) =>
    readFileSync(new URL('../.github/workflows/release-please.yml', import.meta.url), 'utf8')
  );
  assert.match(workflow, /curate-release-notes:/);
  assert.match(workflow, /actions\/checkout@v7/);
  assert.match(workflow, /ref: \$\{\{ needs\.release-please\.outputs\.tag_name \}\}/);
  assert.match(workflow, /publish-human-release-notes\.mjs/);
  assert.match(workflow, /GH_TOKEN: \$\{\{ github\.token \}\}/);
});
