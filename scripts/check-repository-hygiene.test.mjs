import assert from 'node:assert/strict';
import test from 'node:test';

import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { inspectMarkdownLinks, inspectRepositoryFile } from './check-repository-hygiene.mjs';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

test('rejects internal ticket identifiers without flagging public issue links', () => {
  const internalId = `${['E', 'NG'].join('')}-123`;
  assert.deepEqual(inspectRepositoryFile('src/example.ts', `// ${internalId}`), [
    'internal ticket identifier is present',
  ]);
  assert.deepEqual(
    inspectRepositoryFile('CHANGELOG.md', 'Fixed in https://github.com/example/repo/issues/123'),
    []
  );
  const alternateInternalId = `${['W', 'C'].join('')}-42`;
  assert.deepEqual(inspectRepositoryFile('src/example.ts', alternateInternalId), [
    'internal ticket identifier is present',
  ]);
  const domainInternalId = `${['C', 'ASH'].join('')}-01`;
  assert.deepEqual(inspectRepositoryFile('e2e/example.spec.ts', domainInternalId), [
    'internal ticket identifier is present',
  ]);
});

test('rejects private planning and agent paths', () => {
  assert.deepEqual(inspectRepositoryFile('docs/planning/EXECUTION.md', '# Plan'), [
    'private planning or agent path is tracked',
  ]);
  assert.deepEqual(inspectRepositoryFile('.agents/skills/example.md', '# Skill'), [
    'private planning or agent path is tracked',
  ]);
});

test('allows durable public status and architecture documents', () => {
  assert.deepEqual(inspectRepositoryFile('docs/PROJECT-STATUS.md', '# Status'), []);
  assert.deepEqual(
    inspectRepositoryFile('docs/architecture/0001-local-store-authority.md', '# ADR'),
    []
  );
});

test('rejects dead relative Markdown links and allows anchors and URLs', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'puntovivo-hygiene-'));
  mkdirSync(join(cwd, 'docs'));
  writeFileSync(join(cwd, 'README.md'), '# Existing\n');
  assert.deepEqual(
    inspectMarkdownLinks(
      cwd,
      'docs/INDEX.md',
      '[ok](../README.md) [anchor](#section) [web](https://example.com) [bad](./gone.md)'
    ),
    ['dead Markdown link: ./gone.md']
  );
});

test('detect-changes fetches the push base before running paths-filter', () => {
  const workflow = readFileSync(join(REPO_ROOT, '.github', 'workflows', 'ci.yml'), 'utf8');
  const jobStart = workflow.indexOf('  detect-changes:\n');
  assert.notEqual(jobStart, -1, 'detect-changes job must exist');

  const remainder = workflow.slice(jobStart + 2);
  const nextJob = remainder.search(/\n  [a-z][a-z0-9-]*:\n/u);
  const detectChanges = nextJob === -1 ? remainder : remainder.slice(0, nextJob);
  const checkout = detectChanges.match(
    /- name: Checkout repository\n\s+uses: actions\/checkout@v7\n(?<withBlock>\s+with:\n(?:\s{10,}.+\n)*)/u
  );

  assert.ok(checkout, 'detect-changes checkout must declare explicit inputs');
  assert.match(
    checkout.groups?.withBlock ?? '',
    /^\s+fetch-depth:\s*0\s*$/mu,
    'detect-changes must fetch full history so github.event.before resolves without fatal output'
  );
});
