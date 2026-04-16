import { spawnSync } from 'node:child_process';
import { stderr } from 'node:process';

/**
 * @param {string} tag
 * @param {string} releaseName
 * @param {boolean} prerelease
 * @param {{
 *   spawn?: typeof spawnSync;
 * }} [dependencies]
 */
export function ensureGitHubRelease(tag, releaseName, prerelease, dependencies = {}) {
  if (tag.trim().length === 0) {
    throw new Error('Release tag is required.');
  }

  if (releaseName.trim().length === 0) {
    throw new Error('Release name is required.');
  }

  const { spawn = spawnSync } = dependencies;
  const viewResult = spawn('gh', ['release', 'view', tag, '--json', 'isDraft'], {
    encoding: 'utf8',
  });

  if (viewResult.status === 0) {
    return { action: 'reuse' };
  }

  const createArgs = ['release', 'create', tag, '--draft', '--title', releaseName];
  if (prerelease) {
    createArgs.push('--prerelease');
  }

  const createResult = spawn('gh', createArgs, {
    stdio: 'inherit',
  });

  if (createResult.status !== 0) {
    throw new Error(`Failed to create GitHub release for ${tag}.`);
  }

  return { action: 'create' };
}

/**
 * @param {string} tag
 * @param {{
 *   spawn?: typeof spawnSync;
 * }} [dependencies]
 */
export function publishGitHubRelease(tag, dependencies = {}) {
  if (tag.trim().length === 0) {
    throw new Error('Release tag is required.');
  }

  const { spawn = spawnSync } = dependencies;
  const viewResult = spawn('gh', ['release', 'view', tag, '--json', 'isDraft'], {
    encoding: 'utf8',
  });

  if (viewResult.status !== 0) {
    throw new Error(`GitHub release ${tag} does not exist.`);
  }

  const parsedResult = JSON.parse(String(viewResult.stdout));
  if (parsedResult.isDraft === false) {
    return { action: 'reuse' };
  }

  const editResult = spawn('gh', ['release', 'edit', tag, '--draft=false'], {
    stdio: 'inherit',
  });

  if (editResult.status !== 0) {
    throw new Error(`Failed to publish GitHub release for ${tag}.`);
  }

  return { action: 'publish' };
}

/**
 * @param {string} value
 */
function parsePrereleaseValue(value) {
  if (value === 'true') {
    return true;
  }

  if (value === 'false') {
    return false;
  }

  throw new Error('Prerelease flag must be "true" or "false".');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    const mode = process.argv[2] ?? '';

    if (mode === 'ensure') {
      const tag = process.argv[3] ?? '';
      const releaseName = process.argv[4] ?? '';
      const prerelease = parsePrereleaseValue(process.argv[5] ?? 'false');
      const result = ensureGitHubRelease(tag, releaseName, prerelease);
      process.stdout.write(`action=${result.action}\n`);
    } else if (mode === 'publish') {
      const tag = process.argv[3] ?? '';
      const result = publishGitHubRelease(tag);
      process.stdout.write(`action=${result.action}\n`);
    } else {
      throw new Error('Mode must be "ensure" or "publish".');
    }
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Unknown GitHub release automation error.';
    stderr.write(`${message}\n`);
    process.exitCode = 1;
  }
}
