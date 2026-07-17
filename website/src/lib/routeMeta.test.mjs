// A-36 — pins the per-route SEO contract. The regression this guards:
// a new route ships without meta (throw), or titles/descriptions collapse
// back into one global string (uniqueness), which silently re-flattens SEO.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ROUTE_META,
  SITE_ORIGIN,
  canonicalUrl,
  escapeHtml,
  headTagsFor,
  robotsTxt,
  sitemapXml,
} from './routeMeta.js';

// Mirror of scripts/prerender.mjs ROUTES — keep in lockstep.
const ROUTES = ['/', '/sobre', '/docs', '/roadmap', '/contacto', '/atajos', '/migracion'];

test('every prerendered route has a meta entry', () => {
  for (const route of ROUTES) {
    assert.ok(ROUTE_META[route], `missing ROUTE_META for ${route}`);
  }
});

test('titles and descriptions are unique per route', () => {
  const titles = ROUTES.map(r => ROUTE_META[r].title);
  const descriptions = ROUTES.map(r => ROUTE_META[r].description);
  assert.equal(new Set(titles).size, ROUTES.length, 'duplicate titles');
  assert.equal(new Set(descriptions).size, ROUTES.length, 'duplicate descriptions');
});

test('titles and descriptions stay within SERP-friendly bounds', () => {
  for (const route of ROUTES) {
    const { title, description } = ROUTE_META[route];
    assert.ok(title.length >= 20 && title.length <= 70, `title bounds ${route}`);
    assert.ok(description.length >= 60 && description.length <= 170, `description bounds ${route}`);
  }
});

test('headTagsFor emits title, description, canonical and OG pair', () => {
  const head = headTagsFor('/migracion');
  assert.match(head, /<title>.*Loyverse.*<\/title>/);
  assert.match(head, /name="description"/);
  assert.match(head, new RegExp(`rel="canonical" href="${SITE_ORIGIN}/migracion/"`));
  assert.match(head, /property="og:title"/);
  assert.match(head, /name="twitter:card"/);
});

test('headTagsFor throws on an unknown route instead of shipping bare', () => {
  assert.throws(() => headTagsFor('/nueva-ruta'), /no entry for route/);
});

test('canonical URLs live at the domain root, never under the Vite base path', () => {
  assert.equal(canonicalUrl('/'), `${SITE_ORIGIN}/`);
  assert.equal(canonicalUrl('/docs'), `${SITE_ORIGIN}/docs/`);
  assert.ok(!canonicalUrl('/docs').includes('/puntovivo/'));
});

test('escapeHtml neutralizes attribute breakouts', () => {
  assert.equal(escapeHtml('a"b<c>&'), 'a&quot;b&lt;c&gt;&amp;');
});

test('sitemap covers every route and robots points at it', () => {
  const xml = sitemapXml(ROUTES);
  for (const route of ROUTES) {
    assert.ok(xml.includes(`<loc>${canonicalUrl(route)}</loc>`), `sitemap missing ${route}`);
  }
  assert.match(robotsTxt(), new RegExp(`Sitemap: ${SITE_ORIGIN}/sitemap.xml`));
});
