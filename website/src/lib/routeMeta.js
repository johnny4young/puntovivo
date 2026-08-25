// A-36 — per-route SEO metadata, now per locale.
//
// The React build prerendered Spanish only, so the English copy existed just as
// a client-side toggle and no crawler ever saw it. Astro emits a real HTML file
// per locale, which means English finally needs its own titles, descriptions,
// canonical URLs and hreflang pairing — that is what this table now carries.
//
// Kept in src/ (not a build script) so the node --test glob covers it: the test
// pins that every built route has an entry in every locale and that titles and
// descriptions stay unique, the regression that silently re-flattens SEO.

import { DEFAULT_LANG, SUPPORTED_LANGS } from '../i18n/config.js';

/** Canonical origin of the deployed site (Cloudflare Pages, custom domain). */
export const SITE_ORIGIN = 'https://puntovivo.app';

/** Every route the site builds, in both locales. */
export const ROUTES = [
  '/',
  '/sobre',
  '/docs',
  '/roadmap',
  '/contacto',
  '/atajos',
  '/migracion',
  '/seguridad',
  '/estado',
  '/releases',
];

/**
 * One entry per route per locale. `title` ≤ ~70 chars, `description` ≤ ~170
 * chars, in that locale's own voice — not a machine translation of the other.
 */
export const ROUTE_META = {
  es: {
    '/': {
      title: 'Puntovivo · POS offline para el comercio colombiano',
      description:
        'Caja, inventario y compras en una app de escritorio que no depende de internet. Cierre ciego, multi-sede, open source. En desarrollo activo.',
    },
    '/sobre': {
      title: 'Sobre Puntovivo · un POS honesto, en construcción',
      description:
        'Qué hace hoy, qué no hace todavía y por qué se construye en abierto. Sin clientes inventados ni promesas fiscales sin sello.',
    },
    '/docs': {
      title: 'Documentación de Puntovivo · guías para dueños y cajeros',
      description:
        'Guías de caja, cierre ciego, inventario y migración. En construcción: el código es la referencia mientras las guías llegan.',
    },
    '/roadmap': {
      title: 'Roadmap público de Puntovivo · evidencia y trabajo real',
      description:
        'Evidencia pendiente antes de un piloto, issues realizables y exploración sin fechas inventadas. Un tablero público, no una promesa de entrega.',
    },
    '/contacto': {
      title: 'Contacto · habla con el proyecto Puntovivo',
      description:
        'Preguntas, demos y propuestas: GitHub Issues, Discussions o correo directo. Respuesta de una persona, no de un bot.',
    },
    '/atajos': {
      title: 'Atajos de teclado de Puntovivo · vende sin soltar el teclado',
      description:
        'F1 cobra, F2 efectivo exacto, Alt+P busca. La chuleta completa de atajos del POS para cajeros que no usan mouse.',
    },
    '/migracion': {
      title: 'Importar un catálogo CSV o Excel a Puntovivo',
      description:
        'Prepara, mapea y revisa un archivo CSV o Excel de hasta 500 filas antes de guardar productos y stock inicial. Plantilla genérica incluida.',
    },
    '/seguridad': {
      title: 'Seguridad de Puntovivo · controles que viven en el código',
      description:
        'Base de datos cifrada, interfaz aislada, auditoría de lo sensible y actualizaciones que no confían de más. Cada afirmación corresponde a código abierto verificable.',
    },
    '/estado': {
      title: 'Estado de Puntovivo · qué está construido y qué falta',
      description:
        'La foto honesta del proyecto: caja, inventario, impuestos y precios ya funcionan; la certificación DIAN, la firma Windows y el piloto observado siguen pendientes.',
    },
    '/releases': {
      title: 'Versiones de Puntovivo · historial de cambios',
      description:
        'Cada versión publicada con sus notas de cambios, directo desde GitHub. El historial completo del POS open source para el comercio de LatAm.',
    },
  },
  en: {
    '/': {
      title: 'Puntovivo · offline-first POS for Colombian retail',
      description:
        'Register, inventory and purchasing in a desktop app that does not depend on the internet. Blind close, multi-site, open source. In active development.',
    },
    '/sobre': {
      title: 'About Puntovivo · an honest POS, still being built',
      description:
        'What it does today, what it does not do yet, and why it is built in the open. No invented customers and no unstamped fiscal promises.',
    },
    '/docs': {
      title: 'Puntovivo documentation · guides for owners and cashiers',
      description:
        'Guides for the register, blind close, inventory and migration. Under construction: the code is the reference while the guides catch up.',
    },
    '/roadmap': {
      title: 'Puntovivo public roadmap · evidence and tracked work',
      description:
        'Evidence required before a pilot, feasible GitHub issues and exploration without invented dates. A public board, not a delivery promise.',
    },
    '/contacto': {
      title: 'Contact · talk to the Puntovivo project',
      description:
        'Questions, demos and proposals: GitHub Issues, Discussions or a direct email. An answer written by a person, not by a bot.',
    },
    '/atajos': {
      title: 'Puntovivo keyboard shortcuts · sell without the mouse',
      description:
        'F1 charges, F2 exact cash, Alt+P searches. The complete POS shortcut cheat sheet for cashiers who never reach for a mouse.',
    },
    '/migracion': {
      title: 'Import a CSV or Excel catalog into Puntovivo',
      description:
        'Prepare, map and review a CSV or Excel file with up to 500 rows before saving products and opening stock. Generic template included.',
    },
    '/seguridad': {
      title: 'Puntovivo security · controls that live in the code',
      description:
        'Encrypted database, sandboxed interface, auditing of sensitive actions and updates that never over-trust. Every claim maps to verifiable open source code.',
    },
    '/estado': {
      title: 'Puntovivo status · what is built and what is missing',
      description:
        'The honest picture: register, inventory, taxes and pricing already work; DIAN certification, Windows signing and an observed pilot remain pending.',
    },
    '/releases': {
      title: 'Puntovivo releases · the change history',
      description:
        'Every published release with its change notes, straight from GitHub. The full history of the open source POS for LatAm retail.',
    },
  },
};

/** Open Graph locale tag per language. */
const OG_LOCALE = { es: 'es_CO', en: 'en_US' };

/** Escape the few characters that would break out of an HTML attribute. */
export function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

/**
 * Site-relative path for a route in a locale. The default language sits at the
 * root (`/sobre`); every other locale is prefixed (`/en/sobre`). This is a
 * canonical path — it never carries the deploy `base` prefix.
 */
export function localizedPath(lang, route) {
  const prefix = lang === DEFAULT_LANG ? '' : `/${lang}`;
  if (route === '/') return prefix === '' ? '/' : `${prefix}/`;
  return `${prefix}${route}`;
}

/**
 * Canonical URL for a route. The deploy `base` path is a hosting artifact
 * (GitHub Pages project prefix) — canonical URLs always live at the domain
 * root, with a trailing slash so they match the emitted directory files.
 */
export function canonicalUrl(lang, route) {
  const path = localizedPath(lang, route);
  return path === '/' ? `${SITE_ORIGIN}/` : `${SITE_ORIGIN}${path.replace(/\/$/, '')}/`;
}

/**
 * The hreflang cluster for one route: every locale plus x-default pointing at
 * the default language. This is what tells search engines the two pages are
 * translations of each other rather than duplicates.
 */
export function alternateLinks(route) {
  const links = SUPPORTED_LANGS.map(lang => ({ hreflang: lang, href: canonicalUrl(lang, route) }));
  links.push({ hreflang: 'x-default', href: canonicalUrl(DEFAULT_LANG, route) });
  return links;
}

/**
 * The <head> block for one route in one locale: title, description, canonical,
 * hreflang alternates, and the Open Graph / Twitter pair — the tags WhatsApp
 * and social scrapers read, which is how this market shares links.
 */
export function headTagsFor(lang, route) {
  const meta = ROUTE_META[lang]?.[route];
  if (!meta) {
    throw new Error(`routeMeta: no entry for route "${route}" in locale "${lang}".`);
  }
  const title = escapeHtml(meta.title);
  const description = escapeHtml(meta.description);
  const canonical = canonicalUrl(lang, route);
  return [
    `<title>${title}</title>`,
    `<meta name="description" content="${description}" />`,
    `<link rel="canonical" href="${canonical}" />`,
    ...alternateLinks(route).map(
      a => `<link rel="alternate" hreflang="${a.hreflang}" href="${a.href}" />`
    ),
    `<meta property="og:type" content="website" />`,
    `<meta property="og:site_name" content="Puntovivo" />`,
    `<meta property="og:title" content="${title}" />`,
    `<meta property="og:description" content="${description}" />`,
    `<meta property="og:url" content="${canonical}" />`,
    `<meta property="og:locale" content="${OG_LOCALE[lang] ?? OG_LOCALE[DEFAULT_LANG]}" />`,
    `<meta property="og:image" content="${SITE_ORIGIN}/og.png" />`,
    `<meta property="og:image:width" content="1200" />`,
    `<meta property="og:image:height" content="630" />`,
    `<meta name="twitter:card" content="summary_large_image" />`,
    `<meta name="twitter:image" content="${SITE_ORIGIN}/og.png" />`,
    `<meta name="twitter:title" content="${title}" />`,
    `<meta name="twitter:description" content="${description}" />`,
  ].join('\n    ');
}

/** sitemap.xml body — every route in every locale, cross-linked by hreflang. */
export function sitemapXml(routes = ROUTES, langs = SUPPORTED_LANGS) {
  const urls = [];
  for (const route of routes) {
    for (const lang of langs) {
      const alternates = alternateLinks(route)
        .map(a => `    <xhtml:link rel="alternate" hreflang="${a.hreflang}" href="${a.href}"/>`)
        .join('\n');
      urls.push(`  <url>\n    <loc>${canonicalUrl(lang, route)}</loc>\n${alternates}\n  </url>`);
    }
  }
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n${urls.join('\n')}\n</urlset>\n`;
}

/** robots.txt body — allow everything, point at the sitemap. */
export function robotsTxt() {
  return `User-agent: *\nAllow: /\n\nSitemap: ${SITE_ORIGIN}/sitemap.xml\n`;
}
