import { hydrateRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';

// Design CSS, loaded via JS imports (not a relative <link>) so Vite bundles
// and hashes them. Order matters: tokens first (defines the CSS vars), then
// the site + AI-section rules + the secondary-page rules that consume them.
import './styles/tokens.css';
import './styles/site.css';
import './styles/ai-section.css';
import './styles/pages.css';

import './i18n/index.js';
import { AppShell } from './AppShell.jsx';

// Vite's BASE_URL is "/puntovivo/" (the GitHub Pages subpath). react-router's
// basename must not carry a trailing slash, so strip it.
const basename = import.meta.env.BASE_URL.replace(/\/$/, '');

// The markup is now server-rendered (each route is prerendered to a real static
// HTML file by scripts/prerender.mjs), so we HYDRATE rather than create a fresh
// root. The SSR defaults (theme=light, lang=es, fallback version) are chosen to
// match this first client paint exactly; effects then adjust the DOM afterward.
hydrateRoot(
  document.getElementById('root'),
  <AppShell router={app => <BrowserRouter basename={basename}>{app}</BrowserRouter>} />
);
