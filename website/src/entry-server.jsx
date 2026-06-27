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

// Mirror the client's basename ("/puntovivo") so router-generated <Link> hrefs
// in the prerendered HTML already carry the GitHub Pages subpath.
const BASENAME = '/puntovivo';

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
