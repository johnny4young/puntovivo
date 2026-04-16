import { execFileSync } from 'node:child_process';
import { stderr } from 'node:process';

const RELEASE_VERSION_PATTERN =
  /^(?<version>\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?)$/;

/**
 * Normalize a manual release input into a canonical git tag and release metadata.
 * Accepts `1.2.3` or `v1.2.3` and rejects whitespace or malformed versions.
 *
 * @param {string} rawInput
 */
export function prepareReleaseTag(rawInput) {
  const trimmedInput = rawInput.trim();

  if (trimmedInput.length === 0) {
    throw new Error('Release version is required.');
  }

  if (/\s/.test(trimmedInput)) {
    throw new Error('Release version must not contain whitespace.');
  }

  const withoutPrefix = trimmedInput.startsWith('v') ? trimmedInput.slice(1) : trimmedInput;
  const versionMatch = RELEASE_VERSION_PATTERN.exec(withoutPrefix);

  if (!versionMatch?.groups?.version) {
    throw new Error('Release version must look like 1.2.3, 1.2.3-beta.1, or 1.2.3+build.5.');
  }

  const version = versionMatch.groups.version;
  const tag = `v${version}`;
  const prerelease = /-(alpha|beta|rc)(?:[.-]|$)/i.test(version);

  return {
    input: trimmedInput,
    version,
    tag,
    releaseName: `Release ${tag}`,
    prerelease,
  };
}

/**
 * @param {{
 *   targetCommit: string;
 *   localTagCommit: string | null;
 *   remoteTagCommit: string | null;
 * }} state
 */
export function resolveReleaseTagAction(state) {
  const { targetCommit, localTagCommit, remoteTagCommit } = state;

  if (localTagCommit && localTagCommit !== targetCommit) {
    throw new Error(
      `Local tag already points to ${localTagCommit}, but main is at ${targetCommit}.`
    );
  }

  if (remoteTagCommit && remoteTagCommit !== targetCommit) {
    throw new Error(
      `Remote tag already points to ${remoteTagCommit}, but main is at ${targetCommit}.`
    );
  }

  if (remoteTagCommit === targetCommit) {
    return 'reuse';
  }

  if (localTagCommit === targetCommit) {
    return 'push';
  }

  return 'create';
}

/**
 * @param {string[]} args
 */
export function runGit(args) {
  return execFileSync('git', args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

/**
 * @param {string[]} args
 */
export function tryRunGit(args) {
  try {
    return runGit(args);
  } catch {
    return null;
  }
}

/**
 * @param {string} tag
 */
export function getLocalTagCommit(tag) {
  return tryRunGit(['rev-parse', '--verify', `refs/tags/${tag}^{}`]);
}

/**
 * @param {string} tag
 */
export function getRemoteTagCommit(tag) {
  const output = tryRunGit(['ls-remote', '--exit-code', '--tags', 'origin', `refs/tags/${tag}^{}`]);

  if (!output) {
    return null;
  }

  return output.split(/\s+/)[0] ?? null;
}

/**
 * @param {string} rawInput
 * @param {{
 *   getHeadCommit?: () => string;
 *   getLocalTagCommit?: (tag: string) => string | null;
 *   getRemoteTagCommit?: (tag: string) => string | null;
 * }} [dependencies]
 */
export function buildReleasePlan(rawInput, dependencies = {}) {
  const preparedRelease = prepareReleaseTag(rawInput);
  const {
    getHeadCommit = () => runGit(['rev-parse', 'HEAD']),
    getLocalTagCommit: getLocalTagCommitDependency = getLocalTagCommit,
    getRemoteTagCommit: getRemoteTagCommitDependency = getRemoteTagCommit,
  } = dependencies;
  const targetCommit = getHeadCommit();
  const localTagCommit = getLocalTagCommitDependency(preparedRelease.tag);
  const remoteTagCommit = getRemoteTagCommitDependency(preparedRelease.tag);
  const action = resolveReleaseTagAction({
    targetCommit,
    localTagCommit,
    remoteTagCommit,
  });

  return {
    ...preparedRelease,
    targetCommit,
    localTagCommit,
    remoteTagCommit,
    action,
  };
}

/**
 * @param {ReturnType<typeof buildReleasePlan>} releasePlan
 */
function formatGitHubOutput(releasePlan) {
  return [
    `version=${releasePlan.version}`,
    `tag=${releasePlan.tag}`,
    `release_name=${releasePlan.releaseName}`,
    `prerelease=${releasePlan.prerelease}`,
    `target_commit=${releasePlan.targetCommit}`,
    `action=${releasePlan.action}`,
  ].join('\n');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    const releasePlan = buildReleasePlan(process.argv[2] ?? '');
    process.stdout.write(`${formatGitHubOutput(releasePlan)}\n`);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Unknown release tag preparation error.';
    stderr.write(`${message}\n`);
    process.exitCode = 1;
  }
}
