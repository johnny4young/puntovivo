import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

// Design CSS, loaded via JS imports (not a relative <link>) so Vite bundles
// and hashes them. Order matters: tokens first (defines the CSS vars), then
// the site + AI-section rules that consume them.
import './styles/tokens.css';
import './styles/site.css';
import './styles/ai-section.css';

import './i18n/index.js';
import App from './App.jsx';
import { ThemeProvider } from './theme/ThemeProvider.jsx';

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ThemeProvider>
      {/* #app keeps the content above the body::before dotted-texture layer
          (z-index: 1), mirroring the design's wrapper. */}
      <div id="app">
        <App />
      </div>
    </ThemeProvider>
  </StrictMode>
);
