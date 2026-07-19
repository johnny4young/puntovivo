// A-36 — per-route SEO metadata for the prerender pass.
//
// The template ships ONE global <title> + description, and the prerender used
// to copy them verbatim onto all 7 routes — so /migracion competed for the
// same query as the landing and sharing any deep link on WhatsApp showed the
// generic card. This table is the single source the prerender injects from.
//
// Kept in src/ (not scripts/) so the node --test glob covers it: the test
// pins that every prerendered route has an entry and that titles and
// descriptions stay unique — the regression that silently re-flattens SEO.

/** Canonical origin of the deployed site (Cloudflare Pages, custom domain). */
export const SITE_ORIGIN = 'https://puntovivo.app';

/**
 * One entry per prerendered route. `title` ≤ ~60 chars, `description`
 * ≤ ~160 chars, both in the SSR locale (Spanish — the prerender is ES-only
 * by design; see scripts/prerender.mjs SSR_LANG).
 */
export const ROUTE_META = {
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
    title: 'Roadmap público de Puntovivo · qué llega y cuándo',
    description:
      'Lo que está en desarrollo, lo que sigue y lo que vendrá después, en abierto. Sin fechas infladas: prioridades reales del proyecto.',
  },
  '/contacto': {
    title: 'Contacto · habla con el equipo de Puntovivo',
    description:
      'Preguntas, demos y propuestas: GitHub Issues, Discussions o correo directo. Respuesta de una persona, no de un bot.',
  },
  '/atajos': {
    title: 'Atajos de teclado de Puntovivo · vende sin soltar el teclado',
    description:
      'F1 cobra, F2 efectivo exacto, Alt+P busca. La chuleta completa de atajos del POS para cajeros que no usan mouse.',
  },
  '/migracion': {
    title: 'Migrar a Puntovivo desde Loyverse, Alegra o Siigo',
    description:
      'Cómo pasar tu catálogo y stock por CSV/Excel en menos de 90 minutos, sede por sede, sin parar de vender. Plantilla incluida.',
  },
};

/** Escape the few characters that would break out of an HTML attribute. */
export function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

/**
 * Canonical URL for a route on the deployed site. The Vite `base` path is a
 * hosting artifact (GitHub Pages project prefix) — canonical URLs always live
 * at the domain root.
 */
export function canonicalUrl(route) {
  return route === '/' ? `${SITE_ORIGIN}/` : `${SITE_ORIGIN}${route}/`;
}

/**
 * The <head> block the prerender injects for one route: title, description,
 * canonical, and the Open Graph / Twitter pair — the tags WhatsApp and social
 * scrapers read, which is how this market shares links.
 */
export function headTagsFor(route) {
  const meta = ROUTE_META[route];
  if (!meta) {
    throw new Error(`routeMeta: no entry for route "${route}" — add it to ROUTE_META.`);
  }
  const title = escapeHtml(meta.title);
  const description = escapeHtml(meta.description);
  const canonical = canonicalUrl(route);
  return [
    `<title>${title}</title>`,
    `<meta name="description" content="${description}" />`,
    `<link rel="canonical" href="${canonical}" />`,
    `<meta property="og:type" content="website" />`,
    `<meta property="og:site_name" content="Puntovivo" />`,
    `<meta property="og:title" content="${title}" />`,
    `<meta property="og:description" content="${description}" />`,
    `<meta property="og:url" content="${canonical}" />`,
    `<meta property="og:locale" content="es_CO" />`,
    `<meta name="twitter:card" content="summary" />`,
    `<meta name="twitter:title" content="${title}" />`,
    `<meta name="twitter:description" content="${description}" />`,
  ].join('\n    ');
}

/** sitemap.xml body for the prerendered routes. */
export function sitemapXml(routes) {
  const urls = routes.map(route => `  <url><loc>${canonicalUrl(route)}</loc></url>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
}

/** robots.txt body — allow everything, point at the sitemap. */
export function robotsTxt() {
  return `User-agent: *\nAllow: /\n\nSitemap: ${SITE_ORIGIN}/sitemap.xml\n`;
}
