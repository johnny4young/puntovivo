// Crawl surface: every route in every locale, cross-linked by hreflang.
// Canonical URLs live at the domain root — see src/lib/routeMeta.js.
import { sitemapXml } from '../lib/routeMeta.js';

export function GET() {
  return new Response(sitemapXml(), {
    headers: { 'Content-Type': 'application/xml; charset=utf-8' },
  });
}
