import { readdirSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { stderr } from 'node:process';
import { formatGhFailure } from './github-cli-utils.mjs';

const RELEASE_ASSET_EXTENSIONS = new Set(['.AppImage', '.deb', '.dmg', '.exe', '.rpm', '.zip']);

/**
 * @param {string | string[]} inputPaths
 * @param {Set<string>} [allowedExtensions]
 * @returns {string[]}
 */
export function collectReleaseAssetPaths(inputPaths, allowedExtensions = RELEASE_ASSET_EXTENSIONS) {
  /** @type {string[]} */
  const assetPaths = [];
  const pendingPaths = Array.isArray(inputPaths) ? inputPaths : [inputPaths];

  /**
   * @param {string} assetPath
   */
  function getPathStats(assetPath) {
    try {
      return statSync(assetPath);
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
        throw new Error(`Release asset path does not exist: ${assetPath}`);
      }

      const message = error instanceof Error ? error.message : 'Unknown file inspection error.';
      throw new Error(`Failed to inspect release asset path ${assetPath}: ${message}`);
    }
  }

  /**
   * @param {string} currentPath
   */
  function collect(currentPath) {
    const absolutePath = resolve(currentPath);
    const pathStats = getPathStats(absolutePath);

    if (pathStats.isFile()) {
      for (const extension of allowedExtensions) {
        if (absolutePath.endsWith(extension)) {
          assetPaths.push(absolutePath);
          return;
        }
      }

      return;
    }

    const entries = readdirSync(absolutePath, { withFileTypes: true });

    for (const entry of entries) {
      const entryPath = resolve(absolutePath, entry.name);

      if (entry.isDirectory()) {
        collect(entryPath);
        continue;
      }

      if (!entry.isFile()) {
        continue;
      }

      for (const extension of allowedExtensions) {
        if (entry.name.endsWith(extension)) {
          assetPaths.push(entryPath);
          break;
        }
      }
    }
  }

  for (const path of pendingPaths) {
    collect(path);
  }

  return assetPaths.sort((left, right) => left.localeCompare(right));
}

/**
 * @param {string} tag
 * @param {string[]} assetPaths
 * @param {{
 *   spawn?: typeof spawnSync;
 * }} [dependencies]
 */
export function uploadReleaseAssets(tag, assetPaths, dependencies = {}) {
  if (tag.trim().length === 0) {
    throw new Error('Release tag is required for asset upload.');
  }

  if (assetPaths.length === 0) {
    throw new Error('No release assets found to upload.');
  }

  const { spawn = spawnSync } = dependencies;

  for (const assetPath of assetPaths) {
    const result = spawn('gh', ['release', 'upload', tag, assetPath, '--clobber'], {
      encoding: 'utf8',
      stdio: ['inherit', 'inherit', 'pipe'],
    });

    if (result.status !== 0) {
      throw new Error(formatGhFailure(`Failed to upload release asset ${assetPath}`, result));
    }
  }

  return assetPaths.length;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    const tag = process.argv[2] ?? '';
    const assetInputs = process.argv.length > 3 ? process.argv.slice(3) : ['apps/desktop/out/make'];
    const assetPaths = collectReleaseAssetPaths(assetInputs);
    const uploadedCount = uploadReleaseAssets(tag, assetPaths);
    process.stdout.write(`Uploaded ${uploadedCount} release assets for ${tag}.\n`);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown release asset upload error.';
    stderr.write(`${message}\n`);
    process.exitCode = 1;
  }
}
