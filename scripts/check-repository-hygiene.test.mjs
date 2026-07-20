import assert from 'node:assert/strict';
import test from 'node:test';

import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { inspectMarkdownLinks, inspectRepositoryFile } from './check-repository-hygiene.mjs';

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
