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
const ROLLOUT_PERCENTAGES = new Set([10, 50, 100]);
const UPDATE_POLICY_SCHEMA_VERSION = 1;

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

/**
 * Attach electron-updater's built-in staged-rollout percentage to a feed.
 * Replaces an existing value so the same archived feed can be promoted from
 * 10 -> 50 -> 100 without rebuilding or mutating any installer.
 *
 * @param {string} content
 * @param {number} percentage
 * @returns {string}
 */
export function applyStagingPercentage(content, percentage) {
  if (!ROLLOUT_PERCENTAGES.has(percentage)) {
    throw new Error(`rollout percentage must be one of 10, 50, or 100; received ${percentage}`);
  }

  const withoutExisting = content.replace(/^stagingPercentage:[^\r\n]*(?:\r?\n|$)/gm, '');
  if (!/^version:\s*\S+/m.test(withoutExisting)) {
    throw new Error('update feed is missing a root version field');
  }

  return withoutExisting.replace(
    /^(version:[^\r\n]*?)[^\S\r\n]*$/m,
    `$1\nstagingPercentage: ${percentage}`
  );
}

/** @param {string} tag */
export function versionFromTag(tag) {
  const version = tag.trim().replace(/^v/, '');
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) {
    throw new Error(`release tag must contain a semantic version; received ${tag}`);
  }
  return version;
}

/**
 * Build the fixed-origin policy consumed by the Electron main process. The
 * policy never contains credentials or tenant identifiers.
 *
 * @param {{tag: string, percentage: number, mode: 'normal'|'rollback', now?: Date}} input
 */
export function buildUpdatePolicy({ tag, percentage, mode, now = new Date() }) {
  if (mode !== 'normal' && mode !== 'rollback') {
    throw new Error(`update mode must be normal or rollback; received ${mode}`);
  }
  if (!ROLLOUT_PERCENTAGES.has(percentage)) {
    throw new Error(`rollout percentage must be one of 10, 50, or 100; received ${percentage}`);
  }
  if (mode === 'rollback' && percentage !== 100) {
    throw new Error('rollback feeds must target 100 percent of eligible installs');
  }

  return {
    schemaVersion: UPDATE_POLICY_SCHEMA_VERSION,
    mode,
    targetVersion: versionFromTag(tag),
    rolloutPercentage: percentage,
    publishedAt: now.toISOString(),
  };
}

/** @param {string} repoSlug @param {string} tag */
export function releaseDownloadBase(repoSlug, tag) {
  if (!/^[0-9A-Za-z][0-9A-Za-z_.-]*\/[0-9A-Za-z][0-9A-Za-z_.-]*$/.test(repoSlug)) {
    throw new Error(`repository slug must use owner/repo form; received ${repoSlug}`);
  }
  const normalizedTag = tag.trim();
  versionFromTag(normalizedTag);
  return `https://github.com/${repoSlug}/releases/download/${normalizedTag}`;
}

function main() {
  const [dir, tag, ...rest] = process.argv.slice(2);
  if (!dir || !tag) {
    console.error(
      'usage: node scripts/rewrite-update-feed.mjs <dir> <tag> [repoSlug] [--rollout 10|50|100] [--mode normal|rollback]'
    );
    process.exit(1);
  }

  let repoSlug = DEFAULT_REPO_SLUG;
  let rolloutPercentage = 100;
  let mode = 'normal';
  let index = 0;
  if (rest[0] && !rest[0].startsWith('--')) {
    repoSlug = rest[0];
    index = 1;
  }
  while (index < rest.length) {
    const option = rest[index];
    const value = rest[index + 1];
    if (option === '--rollout' && value) {
      rolloutPercentage = Number(value);
      index += 2;
      continue;
    }
    if (option === '--mode' && value) {
      mode = value;
      index += 2;
      continue;
    }
    throw new Error(`unknown or incomplete option: ${option ?? '(missing)'}`);
  }

  // Validate every operator-controlled value before mutating any appcast. A
  // malformed tag or mode must leave the archived feed byte-for-byte intact.
  const policy = buildUpdatePolicy({
    tag,
    percentage: rolloutPercentage,
    mode,
  });
  const baseUrl = releaseDownloadBase(repoSlug, tag);
  const feeds = readdirSync(dir).filter(name => /^latest.*\.yml$/.test(name));
  if (feeds.length === 0) {
    console.error(`no latest*.yml feed found in ${dir}`);
    process.exit(1);
  }

  for (const feed of feeds) {
    const feedPath = join(dir, feed);
    const before = readFileSync(feedPath, 'utf8');
    const after = applyStagingPercentage(rewriteFeed(before, baseUrl), rolloutPercentage);
    writeFileSync(feedPath, after);
    console.log(`rewrote ${feed} -> ${baseUrl}/... (${rolloutPercentage}%)`);
  }

  writeFileSync(join(dir, 'update-policy.json'), `${JSON.stringify(policy, null, 2)}\n`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
