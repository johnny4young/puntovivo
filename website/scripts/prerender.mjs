// Static site generation (SSG) for the Puntovivo marketing site.
//
// Runs as the third build pass (after `vite build` for the client and
// `vite build --ssr` for the server entry). For every public route it calls the
// SSR `render(route)` export, injects the resulting markup into the client
// template's empty <div id="root">, and writes a real static HTML file so
// GitHub Pages serves each deep route with HTTP 200 (the SPA previously fell
// back to 404.html with status 404, which is bad for SEO).
//
// No headless browser: this is plain Node + the Vite SSR bundle, so it runs in
// CI with just node/pnpm.
//
// Scope: Spanish only (the default locale). The English copy is still reachable
// via the client-side ES/EN toggle after hydration. Full bilingual SSG with
// /en/ routes is out of scope for v1.

import { readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
// A-36 — per-route titles/descriptions/OG + sitemap/robots. Lives in src/ so
// the node --test glob pins it (routeMeta.test.mjs).
import { headTagsFor, robotsTxt, sitemapXml } from '../src/lib/routeMeta.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const distDir = resolve(__dirname, '..', 'dist');
const serverDir = join(distDir, 'server');

// Keep this list in lockstep with the <Route> table in src/App.jsx. "/" maps to
// dist/index.html; every other route maps to dist/<route>/index.html so that
// GitHub Pages resolves /puntovivo/sobre/ → dist/sobre/index.html (200).
const ROUTES = ['/', '/sobre', '/docs', '/roadmap', '/contacto', '/atajos', '/migracion'];

// The SSR-default language. The prerendered <html lang> must match the locale
// the SSR tree renders in (i18n falls back to 'es' with no localStorage), so
// the client hydrates without a lang mismatch.
const SSR_LANG = 'es';

const ROOT_RE = /<div id="root">\s*<\/div>/;

function injectAppMarkup(template, markup) {
  if (!ROOT_RE.test(template)) {
    throw new Error(
      'prerender: could not find an empty <div id="root"></div> in dist/index.html — ' +
        'the client build template changed shape; update ROOT_RE in scripts/prerender.mjs.'
    );
  }
  return template.replace(ROOT_RE, `<div id="root">${markup}</div>`);
}

// A-36 — swap the template's single global <title> + meta description for the
// route's own head block. The template ships one of each; both regexes are
// anchored to that shape and fail loudly if the template drifts.
const TITLE_RE = /<title>[\s\S]*?<\/title>/;
const DESC_RE = /<meta\s+name="description"[\s\S]*?\/>/;

function injectHeadTags(html, route) {
  if (!TITLE_RE.test(html) || !DESC_RE.test(html)) {
    throw new Error(
      'prerender: template <title>/<meta name="description"> not found — ' +
        'index.html changed shape; update TITLE_RE/DESC_RE in scripts/prerender.mjs.'
    );
  }
  return html.replace(DESC_RE, '').replace(TITLE_RE, headTagsFor(route));
}

function setHtmlLang(html, lang) {
  // The template already ships lang="es"; this keeps the prerender robust if the
  // template default ever drifts from the SSR locale.
  return html.replace(/<html lang="[^"]*">/, `<html lang="${lang}">`);
}

function outPathFor(route) {
  if (route === '/') return join(distDir, 'index.html');
  // Strip the leading slash so join() does not treat it as an absolute path.
  return join(distDir, route.replace(/^\//, ''), 'index.html');
}

async function main() {
  const templatePath = join(distDir, 'index.html');
  const template = await readFile(templatePath, 'utf8');

  const entryPath = pathToFileURL(join(serverDir, 'entry-server.js')).href;
  const { render } = await import(entryPath);

  let rootHtml = null;

  for (const route of ROUTES) {
    const markup = render(route);
    if (!markup || markup.trim().length === 0) {
      throw new Error(`prerender: SSR render("${route}") returned empty markup.`);
    }

    let html = injectAppMarkup(template, markup);
    html = setHtmlLang(html, SSR_LANG);
    html = injectHeadTags(html, route);

    const outPath = outPathFor(route);
    await mkdir(dirname(outPath), { recursive: true });
    await writeFile(outPath, html, 'utf8');
    console.log(`prerendered ${route} → ${outPath.replace(distDir + '/', 'dist/')}`);

    if (route === '/') rootHtml = html;
  }

  // GitHub Pages serves 404.html for any path with no matching file. Reusing the
  // prerendered landing keeps the SPA fallback working for unlisted routes
  // (App.jsx's "*" route renders the landing client-side after hydration).
  await writeFile(join(distDir, '404.html'), rootHtml, 'utf8');
  console.log('wrote dist/404.html (landing fallback for unlisted paths)');

  // A-36 — crawl surface: sitemap for the prerendered routes + robots that
  // points at it. Canonical URLs live at the domain root (see routeMeta.js).
  await writeFile(join(distDir, 'sitemap.xml'), sitemapXml(ROUTES), 'utf8');
  await writeFile(join(distDir, 'robots.txt'), robotsTxt(), 'utf8');
  console.log('wrote dist/sitemap.xml + dist/robots.txt');

  // The SSR bundle is a build artifact, not something to deploy. Remove it so it
  // never ships to Pages.
  await rm(serverDir, { recursive: true, force: true });
  console.log('cleaned dist/server');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
