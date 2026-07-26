// URL helpers for a site that is both localized and deployable under a
// sub-path.
//
// Two prefixes stack and they mean different things:
//   - the LOCALE prefix ("/en") is part of the site's own information
//     architecture and shows up in canonical URLs;
//   - the DEPLOY base ("/puntovivo/" on GitHub Pages, "/" on Cloudflare Pages)
//     is a hosting artifact that must appear in every emitted href but never in
//     a canonical URL.
//
// React Router used to add the base automatically. Astro does not, so every
// internal link goes through here — a bare href="/sobre" would break the
// sub-path deploy exactly like the old bare <a> did.

import { localizedPath } from './routeMeta.js';

/** Join a deploy base with a site-relative path, collapsing double slashes. */
export function joinBase(base, path) {
  const cleanBase = String(base ?? '/').replace(/\/+$/, '');
  const cleanPath = path.startsWith('/') ? path : `/${path}`;
  const joined = `${cleanBase}${cleanPath}`;
  return joined.startsWith('/') ? joined : `/${joined}`;
}

/**
 * Deploy-ready href for a route in a locale.
 * `href('/puntovivo/', 'en', '/sobre')` → `/puntovivo/en/sobre`
 */
export function localizedHref(base, lang, route) {
  return joinBase(base, localizedPath(lang, route));
}

/**
 * Deploy-ready href for a landing-section anchor. The nav and footer point at
 * sections of the landing page, so the link must resolve to the localized
 * landing plus the hash.
 */
export function sectionHref(base, lang, hash) {
  const landing = localizedHref(base, lang, '/').replace(/\/$/, '');
  return `${landing || ''}/${hash}`;
}

/** Deploy-ready href for a file that lives at the site root (favicon, etc.). */
export function assetHref(base, path) {
  return joinBase(base, path);
}
