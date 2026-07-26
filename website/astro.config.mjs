import { defineConfig } from 'astro/config';

// `base` controls the prefix every internal URL resolves under, and it differs
// by host: GitHub Pages served the project site under the repo subpath
// (https://johnny4young.github.io/puntovivo/) while Cloudflare Pages serves at
// the domain root (/). SITE_BASE_PATH lets each deploy pick the right one; the
// legacy VITE_BASE_PATH name is still honoured so an older deploy invocation
// keeps working, and the default stays the GitHub Pages subpath so a bare
// `pnpm run build` behaves exactly as it did before the Astro migration.
const base = process.env.SITE_BASE_PATH || process.env.VITE_BASE_PATH || '/puntovivo/';

// Astro emits a static HTML file per route with no client framework. The only
// JavaScript that ships is the handful of progressive-enhancement scripts under
// src/scripts (theme, language preference, release lookup, carousel, lead form,
// shortcut filters) — there is no hydration bundle, so the markup below is what
// a visitor with JS disabled still gets.
export default defineConfig({
  // Canonical origin for <link rel="canonical">, hreflang and the sitemap. This
  // is independent of `base`: canonical URLs always live at the domain root.
  site: 'https://puntovivo.app',
  base,
  // dist/sobre/index.html — the shape Cloudflare Pages and GitHub Pages both
  // resolve for a trailing-slash deep link.
  build: { format: 'directory' },
  trailingSlash: 'ignore',
  devToolbar: { enabled: false },
});
