// A-36 — pins the per-route SEO contract. The regressions this guards:
// a new route ships without meta (throw), titles/descriptions collapse back
// into one global string (uniqueness), or a locale loses its hreflang pairing
// so the two translations start competing as duplicates.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ROUTES,
  ROUTE_META,
  SITE_ORIGIN,
  alternateLinks,
  canonicalUrl,
  escapeHtml,
  headTagsFor,
  localizedPath,
  robotsTxt,
  sitemapXml,
} from './routeMeta.js';
import { DEFAULT_LANG, SUPPORTED_LANGS } from '../i18n/config.js';

test('every built route has a meta entry in every locale', () => {
  for (const lang of SUPPORTED_LANGS) {
    for (const route of ROUTES) {
      assert.ok(ROUTE_META[lang]?.[route], `missing ROUTE_META[${lang}] for ${route}`);
    }
  }
});

test('titles and descriptions are unique per route within a locale', () => {
  for (const lang of SUPPORTED_LANGS) {
    const titles = ROUTES.map(r => ROUTE_META[lang][r].title);
    const descriptions = ROUTES.map(r => ROUTE_META[lang][r].description);
    assert.equal(new Set(titles).size, ROUTES.length, `duplicate titles in ${lang}`);
    assert.equal(new Set(descriptions).size, ROUTES.length, `duplicate descriptions in ${lang}`);
  }
});

test('each locale has its own copy, not a mirror of the default', () => {
  for (const lang of SUPPORTED_LANGS.filter(l => l !== DEFAULT_LANG)) {
    for (const route of ROUTES) {
      assert.notEqual(
        ROUTE_META[lang][route].title,
        ROUTE_META[DEFAULT_LANG][route].title,
        `${lang} reuses the ${DEFAULT_LANG} title for ${route}`
      );
    }
  }
});

test('titles and descriptions stay within SERP-friendly bounds', () => {
  for (const lang of SUPPORTED_LANGS) {
    for (const route of ROUTES) {
      const { title, description } = ROUTE_META[lang][route];
      assert.ok(title.length >= 20 && title.length <= 70, `title bounds ${lang} ${route}`);
      assert.ok(
        description.length >= 60 && description.length <= 170,
        `description bounds ${lang} ${route}`
      );
    }
  }
});

test('the default locale lives at the root and others are prefixed', () => {
  assert.equal(localizedPath('es', '/'), '/');
  assert.equal(localizedPath('es', '/docs'), '/docs');
  assert.equal(localizedPath('en', '/'), '/en/');
  assert.equal(localizedPath('en', '/docs'), '/en/docs');
});

test('headTagsFor emits title, description, canonical and OG pair', () => {
  const head = headTagsFor('es', '/migracion');
  assert.match(head, /<title>.*CSV.*Excel.*<\/title>/);
  assert.match(head, /name="description"/);
  assert.match(head, new RegExp(`rel="canonical" href="${SITE_ORIGIN}/migracion/"`));
  assert.match(head, /property="og:title"/);
  assert.match(head, /name="twitter:card"/);
  assert.match(head, /property="og:locale" content="es_CO"/);
});

test('headTagsFor localizes canonical and og:locale for the other language', () => {
  const head = headTagsFor('en', '/migracion');
  assert.match(head, new RegExp(`rel="canonical" href="${SITE_ORIGIN}/en/migracion/"`));
  assert.match(head, /property="og:locale" content="en_US"/);
});

test('every page cross-links its translations with hreflang', () => {
  for (const lang of SUPPORTED_LANGS) {
    const head = headTagsFor(lang, '/docs');
    for (const other of SUPPORTED_LANGS) {
      assert.match(
        head,
        new RegExp(`hreflang="${other}" href="${canonicalUrl(other, '/docs')}"`),
        `${lang} page is missing the ${other} alternate`
      );
    }
    assert.match(head, /hreflang="x-default"/);
  }
});

test('x-default points at the default language', () => {
  const xDefault = alternateLinks('/sobre').find(a => a.hreflang === 'x-default');
  assert.equal(xDefault.href, canonicalUrl(DEFAULT_LANG, '/sobre'));
});

test('headTagsFor throws on an unknown route instead of shipping bare', () => {
  assert.throws(() => headTagsFor('es', '/nueva-ruta'), /no entry for route/);
});

test('headTagsFor throws on an unknown locale instead of falling back silently', () => {
  assert.throws(() => headTagsFor('pt', '/docs'), /no entry for route/);
});

test('canonical URLs live at the domain root, never under the deploy base path', () => {
  assert.equal(canonicalUrl('es', '/'), `${SITE_ORIGIN}/`);
  assert.equal(canonicalUrl('es', '/docs'), `${SITE_ORIGIN}/docs/`);
  assert.equal(canonicalUrl('en', '/'), `${SITE_ORIGIN}/en/`);
  assert.equal(canonicalUrl('en', '/docs'), `${SITE_ORIGIN}/en/docs/`);
  assert.ok(!canonicalUrl('es', '/docs').includes('/puntovivo/'));
});

test('escapeHtml neutralizes attribute breakouts', () => {
  assert.equal(escapeHtml('a"b<c>&'), 'a&quot;b&lt;c&gt;&amp;');
});

test('sitemap covers every route in every locale and robots points at it', () => {
  const xml = sitemapXml();
  for (const lang of SUPPORTED_LANGS) {
    for (const route of ROUTES) {
      assert.ok(
        xml.includes(`<loc>${canonicalUrl(lang, route)}</loc>`),
        `sitemap missing ${lang} ${route}`
      );
    }
  }
  assert.match(robotsTxt(), new RegExp(`Sitemap: ${SITE_ORIGIN}/sitemap.xml`));
});
