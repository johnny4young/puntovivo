import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { canonicalCombo, SITE_SHORTCUTS } from './shortcutClaims.js';

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
    // Nothing is pinned to an issue right now. A pinned number is a claim
    // that goes stale silently — #178 sat under "Proof needed" for weeks
    // after it was closed — so an entry here must be re-checked by hand.
    assert.deepEqual(trackedIssues, []);
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

test('every published shortcut is one the product actually binds', () => {
  const registry = readFileSync(path.join(repoRoot, 'apps/web/src/lib/shortcuts.ts'), 'utf8');
  // The registry entries are plain object literals: `id: '…'` followed by
  // `keys: ['…']`. Parsing that pair is enough to compare claims.
  const shipped = new Map();
  const entry = /id:\s*'([^']+)',\s*\n\s*keys:\s*\[([^\]]*)\]/g;
  let match = entry.exec(registry);
  while (match) {
    const combos = match[2]
      .split(',')
      .map(part => part.trim().replace(/^'|'$/g, ''))
      .filter(Boolean);
    shipped.set(match[1], combos);
    match = entry.exec(registry);
  }
  assert.ok(shipped.size >= 10, `expected a populated registry, parsed ${shipped.size}`);

  for (const claim of SITE_SHORTCUTS) {
    const combos = shipped.get(claim.id);
    assert.ok(combos, `site publishes ${claim.id}, which the product does not bind`);
    assert.ok(
      combos.includes(canonicalCombo(claim.keys)),
      `site publishes ${canonicalCombo(claim.keys)} for ${claim.id}; product binds ${combos.join(', ')}`
    );
  }

  // Every published action label must resolve in both locales.
  for (const locale of Object.values(locales)) {
    for (const claim of SITE_SHORTCUTS) {
      assert.ok(
        locale.atajos.actions[claim.actionId],
        `missing atajos.actions.${claim.actionId} label`
      );
    }
  }
});

test('the macOS requirement matches the artifact that actually ships', () => {
  const builder = readFileSync(path.join(repoRoot, 'apps/desktop/electron-builder.yml'), 'utf8');
  const minimum = /minimumSystemVersion:\s*'?([0-9.]+)'?/.exec(builder);
  assert.ok(minimum, 'electron-builder no longer declares a macOS floor');
  const [major] = minimum[1].split('.');

  for (const locale of Object.values(locales)) {
    const copy = JSON.stringify(locale);
    // Never promise a floor below the one the artifact enforces.
    assert.doesNotMatch(copy, /macOS 1[0-4]\+/);
    assert.ok(
      copy.includes(`macOS ${major}`),
      `site should name the shipped macOS floor (${major})`
    );
    // The only mac artifact is Apple Silicon; saying so keeps an Intel
    // owner from downloading something that cannot run.
    assert.match(copy, /Apple Silicon/);
  }
});

test('no page advertises a key combination the product does not bind', () => {
  const surfaces = ['pages-content/Landing.astro', 'components/AISection.astro']
    .map(file => readFileSync(path.join(here, '..', file), 'utf8'))
    .join('\n');
  // The hero used to promise Alt+K for the palette (it is Mod+K), Alt+C for
  // charging (it focuses the quantity field), plus Alt+N and Alt+M, which do
  // not exist at all. Any Alt/⌥ badge on these surfaces must name a real one.
  const advertised = [...surfaces.matchAll(/pv-key[^>]*>(?:Alt|⌥)<\/span>\s*<span class="pv-key"[^>]*>([A-Z0-9?])</g)].map(
    m => `Alt+${m[1]}`
  );
  const shipped = new Set(SITE_SHORTCUTS.map(claim => canonicalCombo(claim.keys)));
  for (const combo of advertised) {
    assert.ok(shipped.has(combo), `hero advertises ${combo}, which the product does not bind`);
  }
});

test('the site links no channel the project does not run', () => {
  const sources = ['pages-content/Contacto.astro', 'lib/routeMeta.js']
    .map(file => readFileSync(path.join(here, '..', file), 'utf8'))
    .join('\n');
  // GitHub Discussions is disabled on the repository, so every link to it
  // was a 404 wearing a contact channel's clothes. Match the URL shape, not
  // the word, so a comment explaining the removal is allowed to say so.
  assert.doesNotMatch(sources, /\/discussions/i);
  // The visible copy must not offer the channel either.
  assert.doesNotMatch(JSON.stringify(locales), /discussions/i);
});
