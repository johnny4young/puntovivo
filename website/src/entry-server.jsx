import { renderToString } from 'react-dom/server';
// react-router-dom 7 exports StaticRouter from the package root — the v6-era
// 'react-router-dom/server' subpath was dropped from the v7 exports map.
import { StaticRouter } from 'react-router-dom';

// i18n must be initialised before the tree renders. On the server localStorage
// is unavailable, so readStoredLang() falls back to the 'es' default — the
// prerendered HTML is always Spanish (v1 scope; the client toggle still offers
// EN after hydration). No CSS is imported here: the SSR bundle only produces an
// HTML string; the client bundle owns the hashed stylesheet <link> tags that
// Vite injects into dist/index.html.
import './i18n/index.js';
import { AppShell } from './AppShell.jsx';

// Mirror the client's basename derivation EXACTLY (entry-client.jsx reads the
// same import.meta.env.BASE_URL and strips the trailing slash) so the
// prerendered <Link> hrefs match the host the bundle was built for: "/puntovivo"
// under the GitHub Pages subpath, "" at the Cloudflare Pages root. Vite injects
// BASE_URL into the SSR bundle from the `base` config, so this tracks
// VITE_BASE_PATH automatically and keeps SSR/hydration parity.
const BASENAME = import.meta.env.BASE_URL.replace(/\/$/, '');

/**
 * Render a single route to its HTML string. Called once per route by
 * scripts/prerender.mjs. `route` is the app-relative path (e.g. "/sobre").
 *
 * Hydration-parity note: on the client BrowserRouter reads the FULL
 * window.location.pathname ("/puntovivo/sobre") and strips the basename
 * internally. StaticRouter does the same stripping, so its `location` must
 * likewise be the full basename-prefixed path — passing the bare "/sobre"
 * here would fail to match the basename and route to "*". We therefore join
 * BASENAME + route to reproduce the exact client location.
 */
export function render(route) {
  const normalized = route === '/' ? '' : route;
  const location = `${BASENAME}${normalized}`;
  return renderToString(
    <AppShell
      router={app => (
        <StaticRouter location={location} basename={BASENAME}>
          {app}
        </StaticRouter>
      )}
    />
  );
}
