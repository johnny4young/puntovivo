import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// `base` controls the prefix every asset URL resolves under, and it differs by
// host: GitHub Pages serves the project site under the repo subpath
// (https://johnny4young.github.io/puntovivo/) while Cloudflare Pages serves at
// the domain root (/). VITE_BASE_PATH lets each deploy pick the right one; it
// defaults to the GitHub Pages subpath so a bare `pnpm run build` stays
// backward-compatible, and the Cloudflare deploy sets VITE_BASE_PATH=/.
//
// SSG note: the build is a two-pass Vite build (client → dist, SSR entry →
// dist/server) followed by scripts/prerender.mjs, which emits a real static
// HTML file per route AND writes dist/404.html (the GitHub Pages fallback for
// any unlisted path). Because prerender owns 404.html now, the old
// spaFallback404 closeBundle plugin was removed — see scripts/prerender.mjs and
// the "build" script in package.json.
export default defineConfig({
  base: process.env.VITE_BASE_PATH || '/puntovivo/',
  plugins: [react()],
  build: {
    outDir: 'dist',
  },
});
