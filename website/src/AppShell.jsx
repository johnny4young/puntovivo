import { StrictMode, useEffect } from 'react';

import { ThemeProvider } from './theme/ThemeProvider.jsx';
import { restoreStoredLanguage } from './i18n/index.js';
import App from './App.jsx';

// Shared provider tree for both the client (entry-client.jsx) and the SSR
// prerender (entry-server.jsx). The ONLY difference between the two is the
// router: the client uses <BrowserRouter>, the server uses <StaticRouter>.
// Keeping the rest of the tree identical here is what makes hydration clean —
// the server-rendered markup and the client's first paint must match exactly
// (SSR defaults: theme = light, lang = 'es', version = fallback).
//
// The #app wrapper keeps content above the body::before dotted-texture layer
// (z-index: 1), mirroring the design's wrapper.
export function AppShell({ router }) {
  // Adopt the user's stored language AFTER hydration. Doing this in an effect
  // (never during render/SSR) guarantees the first client paint is Spanish,
  // matching the prerendered HTML; react-i18next then re-renders into the
  // stored language on the next tick. Theme is reconciled the same way inside
  // ThemeProvider.
  useEffect(() => {
    restoreStoredLanguage();
  }, []);

  return (
    <StrictMode>
      <ThemeProvider>
        <div id="app">{router(<App />)}</div>
      </ThemeProvider>
    </StrictMode>
  );
}
