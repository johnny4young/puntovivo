// Allow everything, point at the sitemap.
import { robotsTxt } from '../lib/routeMeta.js';

export function GET() {
  return new Response(robotsTxt(), {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
}
