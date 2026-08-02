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
    assert.equal(locale.migracion.mapping.length, 5);
    const profiles = locale.migracion.mapping.map(item => item.from).join(' ');
    assert.match(profiles, /Loyverse/i);
    assert.match(profiles, /Alegra/i);
    assert.match(profiles, /Siigo/i);
    assert.match(profiles, /World Office/i);
    assert.match(JSON.stringify(locale.migracion), /confirm|confirma/i);
    assert.match(
      locale.migracion.compatDesc,
      /generic mapper|mapeo genérico/i,
      `${lang} must expose the fail-closed fallback`
    );
  }
});

test('AI privacy and embedding copy exposes the actual provider boundary', () => {
  for (const locale of Object.values(locales)) {
    const faq = locale.aiFaq.items.map(item => item.a).join(' ');
    assert.match(faq, /customer names|nombres de .*clientes/i);
    assert.match(faq, /invoice image|imagen de la factura/i);
    assert.match(faq, /OpenAI.*Ollama/i);
    assert.match(faq, /results only|solo resultados/i);
    assert.match(faq, /estimate|estimaci/i);
    assert.match(faq, /provider invoices and quotas|facturas y cuotas del proveedor/i);
    assert.match(faq, /unknown|desconocid/i);
    assert.doesNotMatch(faq, /#179/);
    assert.doesNotMatch(faq, /hard audit|auditoría estricta|never leaves|nunca sale/i);
    assert.doesNotMatch(
      locale.ai.desc,
      /capabilities share .*usage audit|capacidades comparten .*auditoría de uso/i
    );
    assert.match(locale.ai.cards.semanticDesc, /ordinary text search|búsqueda de texto normal/i);
    assert.doesNotMatch(locale.ai.cards.semanticDesc, /every sync|al sincronizar/i);
  }
});

test('roadmap separates tracked issues from undated exploration', () => {
  for (const locale of Object.values(locales)) {
    const roadmap = locale.roadmap;
    const copy = JSON.stringify(roadmap);
    const trackedIssues = [...roadmap.columns.now.items, ...roadmap.columns.next.items]
      .map(item => item.issue)
      .filter(Boolean);
    assert.deepEqual(trackedIssues, [178]);
    assert.equal(roadmap.columns.next.items.length, 0);
    assert.match(
      roadmap.shipped.map(item => item.t).join(' '),
      /encrypted recovery.*three operating systems|recuperación cifrada.*tres sistemas operativos/i
    );
    assert.match(roadmap.shipped.map(item => item.t).join(' '), /AI usage accounting|uso de IA/i);
    assert.doesNotMatch(copy, /6 weeks|6 semanas|next quarter|próximo trimestre/i);
    assert.match(
      `${roadmap.columns.later.kicker} ${roadmap.columns.later.desc}`,
      /no commitment|sin compromiso/i
    );
  }
});

test('receipt sharing copy preserves the manual WhatsApp handoff boundary', () => {
  for (const locale of Object.values(locales)) {
    const copy = JSON.stringify({ modules: locale.modules, faq: locale.faq });
    assert.match(copy, /WhatsApp/i);
    assert.match(copy, /local PNG|PNG local/i);
    assert.match(copy, /operator.*send manually|operador.*envíe manualmente/i);
    assert.doesNotMatch(copy, /sent automatically|enviado automáticamente|WhatsApp API/i);
  }
});

test('documentation presents shipped webhooks without implying a general public API', () => {
  for (const locale of Object.values(locales)) {
    const integrations = locale.docs.categories.at(-1);
    assert.match(integrations.d, /signatures|firma/i);
    assert.match(
      integrations.d,
      /not a general public REST API|no es una API REST pública general/i
    );
    assert.doesNotMatch(JSON.stringify(locale.docs.popular), /custom roles|roles personalizados/i);
  }
});
