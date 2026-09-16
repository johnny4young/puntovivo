import { readFileSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { formatGhFailure } from './github-cli-utils.mjs';
import {
  humanReleaseNotesPath,
  validateHumanReleaseNotes,
} from './publish-human-release-notes.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RELEASE_MANIFEST = '.release-please-manifest.json';
// GitHub rejects a commit status whose description is longer than this.
const STATUS_DESCRIPTION_LIMIT = 140;
const STATUS_CONTEXT = 'Curated release notes';

/**
 * release-please opens its pull request from release-please--branches--<target>,
 * adding --components--<name> when the manifest names a component. A fork can
 * name its branch the same way, so only branches of this repository count.
 */
export function isReleasePullRequest({ headRefName, isCrossRepository }, targetBranch) {
  const releaseBranch = `release-please--branches--${targetBranch}`;
  return (
    !isCrossRepository &&
    (headRefName === releaseBranch || headRefName.startsWith(`${releaseBranch}--`))
  );
}

export function releaseTagFromManifest(content) {
  const versions = Object.values(JSON.parse(content));
  if (versions.length !== 1) {
    throw new Error(
      `${RELEASE_MANIFEST} must declare exactly one component, found ${versions.length}`
    );
  }
  return `v${versions[0]}`;
}

/**
 * The status for the curated note of a release, read from a checkout of the
 * branch the release pull request merges into. release-please leaves its pull
 * request untouched when a push adds nothing to the release, so the pull request
 * branch can predate a note merged since; the tag gets the note through the
 * merge, which is why the note is looked up on the target branch.
 */
export function evaluateCuratedNotes(tag, { root = repoRoot, branch = 'main' } = {}) {
  const notesPath = humanReleaseNotesPath(tag, root);
  const note = path.relative(root, notesPath).split(path.sep).join('/');
  let content;
  try {
    content = readFileSync(notesPath, 'utf8');
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
    return { state: 'failure', description: `Add ${note} to ${branch} before merging` };
  }
  try {
    validateHumanReleaseNotes(tag, content);
  } catch (error) {
    return { state: 'failure', description: `${note} on ${branch}: ${error.message}` };
  }
  return { state: 'success', description: `${note} on ${branch} is valid` };
}

function statusDescription(description) {
  return description.length <= STATUS_DESCRIPTION_LIMIT
    ? description
    : `${description.slice(0, STATUS_DESCRIPTION_LIMIT - 1)}…`;
}

function requiredEnv(env, name) {
  const value = env[name];
  if (!value) {
    throw new Error(`${name} is not set; run this from the release-please workflow`);
  }
  return value;
}

/**
 * Post the curated notes status on every open Release Please pull request of
 * the pushed branch. A missing or incomplete note is a failing status, not a
 * failing run: it is the expected state until someone writes the note. Only a
 * status the gate cannot determine fails the run, after it is posted.
 */
export function runReleaseNotesGate({
  env = process.env,
  root = repoRoot,
  run = spawnSync,
  log = message => process.stdout.write(`${message}\n`),
} = {}) {
  const repository = requiredEnv(env, 'GITHUB_REPOSITORY');
  const sha = requiredEnv(env, 'GITHUB_SHA');
  const branch = requiredEnv(env, 'GITHUB_REF_NAME');
  const runUrl = `${requiredEnv(env, 'GITHUB_SERVER_URL')}/${repository}/actions/runs/${requiredEnv(env, 'GITHUB_RUN_ID')}`;

  const gh = (args, context) => {
    const result = run('gh', args, { cwd: root, encoding: 'utf8' });
    if (result.status !== 0) {
      throw new Error(formatGhFailure(context, result));
    }
    return result.stdout;
  };

  // Runs for pushes that land close together can finish in either order. Only
  // the run for the newest commit reports, so an older run cannot overwrite the
  // status with a verdict about a branch that has since changed.
  const head = gh(
    ['api', `repos/${repository}/git/ref/heads/${branch}`, '--jq', '.object.sha'],
    `Could not read the head of ${branch}`
  ).trim();
  if (head !== sha) {
    log(`${branch} moved from ${sha} to ${head}; the run for ${head} reports instead.`);
    return [];
  }

  const pullRequests = JSON.parse(
    gh(
      [
        'pr',
        'list',
        '--repo',
        repository,
        '--state',
        'open',
        '--base',
        branch,
        '--json',
        'number,headRefName,headRefOid,isCrossRepository',
        '--limit',
        '1000',
      ],
      `Could not list the open pull requests into ${branch}`
    )
  ).filter(pullRequest => isReleasePullRequest(pullRequest, branch));
  if (pullRequests.length === 0) {
    log(`No Release Please pull request into ${branch} is open.`);
    return [];
  }

  const reports = [];
  for (const { number, headRefOid } of pullRequests) {
    const manifest = gh(
      [
        'api',
        '-H',
        'Accept: application/vnd.github.raw+json',
        `repos/${repository}/contents/${RELEASE_MANIFEST}?ref=${headRefOid}`,
      ],
      `Could not read ${RELEASE_MANIFEST} from pull request #${number}`
    );
    let verdict;
    try {
      verdict = evaluateCuratedNotes(releaseTagFromManifest(manifest), { root, branch });
    } catch (error) {
      verdict = {
        state: 'error',
        description: `Cannot check the curated note: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
    gh(
      [
        'api',
        '--method',
        'POST',
        `repos/${repository}/statuses/${headRefOid}`,
        '-f',
        `state=${verdict.state}`,
        '-f',
        `context=${STATUS_CONTEXT}`,
        '-f',
        `description=${statusDescription(verdict.description)}`,
        '-f',
        `target_url=${runUrl}`,
      ],
      `Could not post the ${STATUS_CONTEXT} status on pull request #${number}`
    );
    log(`Pull request #${number} (${headRefOid}): ${verdict.state}, ${verdict.description}`);
    reports.push({ number, sha: headRefOid, ...verdict });
  }

  const undetermined = reports.filter(report => report.state === 'error');
  if (undetermined.length > 0) {
    throw new Error(
      undetermined.map(report => `Pull request #${report.number}: ${report.description}`).join('\n')
    );
  }
  return reports;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    runReleaseNotesGate();
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
