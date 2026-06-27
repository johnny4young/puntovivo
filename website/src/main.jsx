import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';

// Design CSS, loaded via JS imports (not a relative <link>) so Vite bundles
// and hashes them. Order matters: tokens first (defines the CSS vars), then
// the site + AI-section rules + the secondary-page rules that consume them.
import './styles/tokens.css';
import './styles/site.css';
import './styles/ai-section.css';
import './styles/pages.css';

import './i18n/index.js';
import App from './App.jsx';
import { ThemeProvider } from './theme/ThemeProvider.jsx';

// Vite's BASE_URL is "/puntovivo/" (the GitHub Pages subpath). react-router's
// basename must not carry a trailing slash, so strip it.
const basename = import.meta.env.BASE_URL.replace(/\/$/, '');

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ThemeProvider>
      {/* #app keeps the content above the body::before dotted-texture layer
          (z-index: 1), mirroring the design's wrapper. */}
      <div id="app">
        <BrowserRouter basename={basename}>
          <App />
        </BrowserRouter>
      </div>
    </ThemeProvider>
  </StrictMode>
);
