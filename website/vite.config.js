import { copyFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// GitHub Pages SPA fallback: Pages has no server-side rewrite, so a direct hit
// on a deep route (e.g. /puntovivo/sobre) would 404. Copying the built
// index.html to 404.html makes Pages serve the app shell for any unknown path;
// react-router then resolves the route client-side. Runs in closeBundle so it
// fires after the HTML is emitted to outDir.
function spaFallback404() {
  return {
    name: 'spa-fallback-404',
    apply: 'build',
    closeBundle() {
      const dist = resolve(import.meta.dirname, 'dist');
      const index = resolve(dist, 'index.html');
      const notFound = resolve(dist, '404.html');
      if (existsSync(index)) {
        copyFileSync(index, notFound);
      }
    },
  };
}

// GitHub Pages project site: https://johnny4young.github.io/puntovivo/
// `base` must match the repo name so asset URLs resolve under the subpath.
export default defineConfig({
  base: '/puntovivo/',
  plugins: [react(), spaFallback404()],
  build: {
    outDir: 'dist',
  },
});
