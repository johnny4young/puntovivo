import { readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { stderr } from 'node:process';

const RELEASE_ASSET_EXTENSIONS = new Set(['.AppImage', '.deb', '.dmg', '.exe', '.rpm', '.zip']);

/**
 * @param {string} rootDir
 * @param {Set<string>} [allowedExtensions]
 * @returns {string[]}
 */
export function collectReleaseAssetPaths(rootDir, allowedExtensions = RELEASE_ASSET_EXTENSIONS) {
  /** @type {string[]} */
  const assetPaths = [];

  /**
   * @param {string} currentDir
   */
  function walk(currentDir) {
    const entries = readdirSync(currentDir, { withFileTypes: true });

    for (const entry of entries) {
      const absolutePath = resolve(currentDir, entry.name);

      if (entry.isDirectory()) {
        walk(absolutePath);
        continue;
      }

      if (!entry.isFile()) {
        continue;
      }

      for (const extension of allowedExtensions) {
        if (entry.name.endsWith(extension)) {
          assetPaths.push(absolutePath);
          break;
        }
      }
    }
  }

  walk(resolve(rootDir));

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
      stdio: 'inherit',
    });

    if (result.status !== 0) {
      throw new Error(`Failed to upload release asset: ${assetPath}`);
    }
  }

  return assetPaths.length;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    const tag = process.argv[2] ?? '';
    const rootDir = process.argv[3] ?? 'apps/desktop/out/make';
    const assetPaths = collectReleaseAssetPaths(rootDir);
    const uploadedCount = uploadReleaseAssets(tag, assetPaths);
    process.stdout.write(`Uploaded ${uploadedCount} release assets for ${tag}.\n`);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown release asset upload error.';
    stderr.write(`${message}\n`);
    process.exitCode = 1;
  }
}
