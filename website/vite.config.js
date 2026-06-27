import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// GitHub Pages project site: https://johnny4young.github.io/puntovivo/
// `base` must match the repo name so asset URLs resolve under the subpath.
//
// SSG note: the build is a two-pass Vite build (client → dist, SSR entry →
// dist/server) followed by scripts/prerender.mjs, which emits a real static
// HTML file per route AND writes dist/404.html (the GitHub Pages fallback for
// any unlisted path). Because prerender owns 404.html now, the old
// spaFallback404 closeBundle plugin was removed — see scripts/prerender.mjs and
// the "build" script in package.json.
export default defineConfig({
  base: '/puntovivo/',
  plugins: [react()],
  build: {
    outDir: 'dist',
  },
});
