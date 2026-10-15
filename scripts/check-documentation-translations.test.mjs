import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { checkTranslations, checkDocumentation } from './check-documentation-translations.mjs';

const registry = { pairs: [{ en: 'en.md', es: 'es.md' }], bilingual: [] };
function fixture(t, change = text => text) {
  const root = mkdtempSync(join(tmpdir(), 'puntovivo-doc-pair-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  writeFileSync(
    join(root, 'en.md'),
    '# Guide\n\n[Español](es.md)\n\n## Setup\n\n`PORT`\n\n```sh\npnpm install\n```\n'
  );
  writeFileSync(
    join(root, 'es.md'),
    change('# Guía\n\n[English](en.md)\n\n## Entorno\n\n`PORT`\n\n```sh\npnpm install\n```\n')
  );
  return root;
}
test('accepts translated headings while preserving command and identifier contracts', t => {
  assert.deepEqual(checkTranslations(fixture(t), registry), []);
});
test('catches command, identifier and missing-section drift', t => {
  const errors = checkTranslations(
    fixture(t, text =>
      text
        .replace('pnpm install', 'npm install')
        .replace('`PORT`', '`HOST`')
        .replace('## Entorno\n', '')
    ),
    registry
  );
  for (const kind of ['Code block drift', 'Identifier drift', 'Heading structure drift'])
    assert.ok(errors.some(error => error.startsWith(kind)));
});
test('catches a missing language selector and a broken local destination', t => {
  const errors = checkTranslations(
    fixture(t, text => text.replace('(en.md)', '(missing.md)')),
    registry
  );
  assert.ok(errors.some(error => error.startsWith('Missing reciprocal')));
  assert.ok(errors.some(error => error.startsWith('Broken local link')));
});
test('validates heading fragments and ignores external URLs without network access', t => {
  const root = fixture(
    t,
    text => text + '\n[Missing section](en.md#missing)\n[External](https://example.invalid)\n'
  );
  assert.deepEqual(checkTranslations(root, registry), [
    'Broken heading link: es.md -> en.md#missing',
  ]);
});

test('validates fragments on the current document and refuses repository traversal', t => {
  const root = fixture(t, text => text + '\n[Missing](#missing)\n[Outside](../outside.md)\n');
  const errors = checkTranslations(root, registry);
  assert.ok(errors.some(error => error.startsWith('Broken heading link')));
  assert.ok(errors.some(error => error.startsWith('Link outside repository')));
});

test('catches identifier occurrence drift even when the unique names still match', t => {
  const root = fixture(t, text => text + '\n`PORT`\n');
  assert.ok(checkTranslations(root, registry).some(error => error.startsWith('Identifier drift')));
});

for (const marker of ['   ```', '~~~']) {
  test(`catches command drift inside valid ${JSON.stringify(marker)} fences`, t => {
    const root = fixture(t);
    for (const [file, command] of [
      ['en.md', 'pnpm test'],
      ['es.md', 'curl example.invalid'],
    ])
      writeFileSync(
        join(root, file),
        readFileSync(join(root, file), 'utf8') + `\n${marker}sh\n${command}\n${marker}\n`
      );
    assert.ok(
      checkTranslations(root, registry).some(error => error.startsWith('Code block drift'))
    );
  });
}

test('validates full, collapsed and shortcut reference destinations', t => {
  const root = fixture(
    t,
    text =>
      text +
      '\n[Full][guide]\n[collapsed][]\n[shortcut]\n' +
      '[guide]: missing-full.md\n[collapsed]: <missing-collapsed.md>\n[shortcut]: missing-shortcut.md\n'
  );
  const errors = checkTranslations(root, registry);
  for (const destination of ['missing-full.md', 'missing-collapsed.md', 'missing-shortcut.md'])
    assert.ok(errors.some(error => error === `Broken local link: es.md -> ${destination}`));
});

test('accepts stable explicit HTML anchors alongside translated headings', t => {
  const root = fixture(t, text => text + '\n<a id="recovery"></a>\n[Recover](#recovery)\n');
  assert.deepEqual(checkTranslations(root, registry), []);
});

test('rejects newly tracked current guides while allowing registered bilingual and historical files', t => {
  const root = fixture(t);
  const completeRegistry = { ...registry, bilingual: ['policy.md'], historical: ['release-*.md'] };
  writeFileSync(join(root, 'policy.md'), '# English / Español\n');
  writeFileSync(join(root, 'release-v1.md'), '# Historical release\n');
  writeFileSync(join(root, 'new-guide.md'), '# New maintained guide\n');
  execFileSync('git', ['init', '-q'], { cwd: root });
  execFileSync('git', ['add', '.'], { cwd: root });
  assert.deepEqual(checkDocumentation(root, completeRegistry), [
    'Untranslated current document: new-guide.md',
  ]);
  completeRegistry.bilingual.push('new-guide.md');
  assert.deepEqual(checkDocumentation(root, completeRegistry), []);
});

test('CI schedules the documentation contract for Markdown, registry and checker changes', () => {
  const workflow = readFileSync(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8');
  const job = workflow.split('  documentation:\n')[1]?.split('  release-automation:')[0];
  assert.ok(job);
  assert.ok(
    workflow.includes("'fix/**'"),
    'stacked documentation PRs on fix branches must receive CI'
  );
  for (const path of [
    '**/*.md',
    'docs/translations.json',
    'scripts/check-documentation-translations*.mjs',
  ])
    assert.ok(workflow.includes(`- '${path}'`));
  assert.match(job, /needs\.detect-changes\.outputs\.docs == 'true'/);
  const scripts = JSON.parse(
    readFileSync(new URL('../package.json', import.meta.url), 'utf8')
  ).scripts;
  assert.ok(job.includes('run: pnpm run ci:docs'));
  assert.ok(job.includes("pnpm_config_verify_deps_before_run: 'false'"));
  assert.ok(
    scripts['ci:docs'].includes('node --test scripts/check-documentation-translations.test.mjs')
  );
  assert.ok(
    scripts['ci:docs'].includes('node scripts/check-documentation-translations.mjs --inventory')
  );
  assert.doesNotMatch(job, /pnpm install|test:e2e|dev:desktop/);
});
