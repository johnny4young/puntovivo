#!/usr/bin/env node
/**
 * Rewrite an electron-updater feed (latest*.yml) so its binary references point
 * at the GitHub Release download URLs instead of bare filenames.
 *
 * Why: the auto-update FEED lives on GitHub Pages (github.io) but the installers
 * (146-177 MB) cannot — Pages caps files at 100 MB — so they stay on GitHub
 * Releases. electron-builder writes the feed with relative filenames
 * (`url: Puntovivo-1.2.0-mac-arm64.zip`), which the generic provider would
 * resolve against the Pages base URL and 404. Rewriting `url:` / `path:` to the
 * absolute Release URL makes electron-updater's generic provider download the
 * binary straight from Releases (newUrlFromBase returns an absolute URL as-is),
 * while the small .yml feed is served from Pages.
 *
 * Usage:
 *   node scripts/rewrite-update-feed.mjs <dir> <tag> [repoSlug]
 *   # e.g. node scripts/rewrite-update-feed.mjs apps/desktop/out-builder v1.2.0
 *
 * @module scripts/rewrite-update-feed
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';

const DEFAULT_REPO_SLUG = 'johnny4young/puntovivo';

/**
 * Rewrite the bare-filename `url:` / `path:` values in a feed to absolute
 * Release URLs. Lines whose value already contains a scheme (`://`) or is not an
 * installer (.zip / .exe / .AppImage) are left untouched, so the transform is
 * idempotent and ignores sha512 / size / version / releaseDate.
 *
 * @param {string} content - the latest*.yml text
 * @param {string} baseUrl - e.g. https://github.com/owner/repo/releases/download/v1.2.0
 * @returns {string}
 */
export function rewriteFeed(content, baseUrl) {
  return content.replace(/^(\s*(?:- )?(?:url|path):\s*)(\S+)\s*$/gm, (line, prefix, value) => {
    if (value.includes('://')) {
      return line; // already an absolute URL
    }
    if (!/\.(zip|exe|AppImage)$/.test(value)) {
      return line; // not an installer reference
    }
    return `${prefix}${baseUrl}/${value}`;
  });
}

/** @param {string} repoSlug @param {string} tag */
export function releaseDownloadBase(repoSlug, tag) {
  return `https://github.com/${repoSlug}/releases/download/${tag}`;
}

function main() {
  const [dir, tag, repoSlug = DEFAULT_REPO_SLUG] = process.argv.slice(2);
  if (!dir || !tag) {
    console.error('usage: node scripts/rewrite-update-feed.mjs <dir> <tag> [repoSlug]');
    process.exit(1);
  }

  const baseUrl = releaseDownloadBase(repoSlug, tag);
  const feeds = readdirSync(dir).filter(name => /^latest.*\.yml$/.test(name));
  if (feeds.length === 0) {
    console.error(`no latest*.yml feed found in ${dir}`);
    process.exit(1);
  }

  for (const feed of feeds) {
    const feedPath = join(dir, feed);
    const before = readFileSync(feedPath, 'utf8');
    const after = rewriteFeed(before, baseUrl);
    writeFileSync(feedPath, after);
    console.log(`rewrote ${feed} -> ${baseUrl}/...`);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
