import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../../..');
const locales = Object.fromEntries(
  ['en', 'es'].map(lang => [
    lang,
    JSON.parse(readFileSync(path.join(here, '..', 'i18n', `${lang}.json`), 'utf8')),
  ])
);

test('migration copy uses the same batch limit as the shipped import contract', () => {
  const schema = readFileSync(
    path.join(repoRoot, 'packages/server/src/trpc/schemas/launchMigration.ts'),
    'utf8'
  );
  const match = schema.match(/launchProductImportRowsSchema[\s\S]*?\.max\((\d+),/);
  assert.ok(match, 'could not read the product import row limit');
  const limit = match[1];

  for (const [lang, locale] of Object.entries(locales)) {
    const copy = JSON.stringify(locale.migracion);
    assert.match(locale.migracion.badgeTime, new RegExp(limit), `${lang} hides the real limit`);
    assert.match(copy, new RegExp(`up to ${limit}|hasta ${limit}`, 'i'));
    assert.doesNotMatch(
      copy,
      /30 (?:to|a) 90|no downtime|sin downtime|50[.,]000 lines|50[.,]000 líneas/i
    );
    assert.equal(locale.migracion.mapping.length, 1);
  }
});

test('AI privacy and embedding copy exposes the actual provider boundary', () => {
  for (const locale of Object.values(locales)) {
    const faq = locale.aiFaq.items.map(item => item.a).join(' ');
    assert.match(faq, /customer names|nombres de .*clientes/i);
    assert.match(faq, /invoice image|imagen de la factura/i);
    assert.match(faq, /OpenAI.*Ollama/i);
    assert.match(faq, /#176/);
    assert.match(faq, /#179/);
    assert.doesNotMatch(faq, /hard audit|auditoría estricta|never leaves|nunca sale/i);
    assert.doesNotMatch(
      locale.ai.desc,
      /capabilities share .*usage audit|capacidades comparten .*auditoría de uso/i
    );
  }
});

test('roadmap separates tracked issues from undated exploration', () => {
  for (const locale of Object.values(locales)) {
    const roadmap = locale.roadmap;
    const copy = JSON.stringify(roadmap);
    const trackedIssues = [...roadmap.columns.now.items, ...roadmap.columns.next.items]
      .map(item => item.issue)
      .filter(Boolean);
    assert.deepEqual(trackedIssues, [177, 178, 173, 174, 175, 176, 179]);
    assert.doesNotMatch(copy, /6 weeks|6 semanas|next quarter|próximo trimestre/i);
    assert.match(
      `${roadmap.columns.later.kicker} ${roadmap.columns.later.desc}`,
      /no commitment|sin compromiso/i
    );
  }
});

test('documentation does not present future integrations as shipped guides', () => {
  for (const locale of Object.values(locales)) {
    const integrations = locale.docs.categories.at(-1);
    assert.match(integrations.d, /#175/);
    assert.match(integrations.d, /not shipped|todavía no se distribuyen/i);
    assert.doesNotMatch(JSON.stringify(locale.docs.popular), /custom roles|roles personalizados/i);
  }
});
