import { spawnSync } from 'node:child_process';
import { stderr } from 'node:process';

/**
 * @param {{ stdout?: string | Buffer | null; stderr?: string | Buffer | null }} result
 */
function getGhOutputText(result) {
  return [result.stdout, result.stderr]
    .map(value => String(value ?? '').trim())
    .filter(Boolean)
    .join('\n');
}

/**
 * `gh release view` does not expose a stable machine-readable not-found code,
 * so we intentionally match the known 404/release-missing responses and treat
 * everything else as an operational failure that should stop the workflow.
 *
 * @param {{ status?: number | null; stdout?: string | Buffer | null; stderr?: string | Buffer | null }} result
 */
function isMissingReleaseLookup(result) {
  if (result.status === 0) {
    return false;
  }

  const outputText = getGhOutputText(result);
  return /release\b.*\bnot found\b/i.test(outputText) || /\b404\b/.test(outputText);
}

/**
 * @param {string} context
 * @param {{ stdout?: string | Buffer | null; stderr?: string | Buffer | null }} result
 */
function formatGhFailure(context, result) {
  const outputText = getGhOutputText(result);

  if (outputText.length === 0) {
    return `${context}.`;
  }

  return `${context}: ${outputText}`;
}

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

  if (!isMissingReleaseLookup(viewResult)) {
    throw new Error(formatGhFailure(`Failed to inspect GitHub release ${tag}`, viewResult));
  }

  const createArgs = ['release', 'create', tag, '--draft', '--title', releaseName];
  if (prerelease) {
    createArgs.push('--prerelease');
  }

  const createResult = spawn('gh', createArgs, {
    stdio: 'inherit',
  });

  if (createResult.status !== 0) {
    throw new Error(formatGhFailure(`Failed to create GitHub release for ${tag}`, createResult));
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
    if (isMissingReleaseLookup(viewResult)) {
      throw new Error(`GitHub release ${tag} does not exist.`);
    }

    throw new Error(formatGhFailure(`Failed to inspect GitHub release ${tag}`, viewResult));
  }

  const parsedResult = JSON.parse(String(viewResult.stdout));
  if (parsedResult.isDraft === false) {
    return { action: 'reuse' };
  }

  const editResult = spawn('gh', ['release', 'edit', tag, '--draft=false'], {
    stdio: 'inherit',
  });

  if (editResult.status !== 0) {
    throw new Error(formatGhFailure(`Failed to publish GitHub release for ${tag}`, editResult));
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
