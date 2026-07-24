#!/usr/bin/env node
/**
 * Produce a sanitized, platform-specific evidence manifest for one immutable
 * desktop candidate.
 *
 * The collector deliberately resolves the exact electron-builder filename from
 * version + platform + architecture. It never selects "the newest" file or the
 * first glob match, so stale artifacts in out-builder cannot be attributed to a
 * newer candidate.
 *
 * Usage:
 *   node scripts/collect-desktop-candidate-evidence.mjs \
 *     --candidate-sha <40-hex-sha> \
 *     --structure-smoke passed \
 *     [--out-dir apps/desktop/out-builder] \
 *     [--output <manifest.json>]
 */
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import {
  createReadStream,
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const SCHEMA_VERSION = 1;
const SHA_PATTERN = /^[0-9a-f]{40}$/;

const PLATFORM_CONTRACT = {
  darwin: { artifactOs: 'mac', extension: 'zip', feedName: 'latest-mac.yml' },
  linux: { artifactOs: 'linux', extension: 'AppImage', feedName: 'latest-linux.yml' },
  win32: { artifactOs: 'win', extension: 'exe', feedName: 'latest.yml' },
};

/** @param {string} value */
export function normalizeCandidateSha(value) {
  const normalized = value.trim().toLowerCase();
  if (!SHA_PATTERN.test(normalized)) {
    throw new Error('candidate SHA must be the complete 40-character hexadecimal commit SHA');
  }
  return normalized;
}

/** @param {string} content */
export function parseUpdateFeed(content) {
  const version = /^version:\s*['"]?([^'"\s]+)['"]?\s*$/m.exec(content)?.[1];
  const url = /^\s*-\s+url:\s*['"]?([^'"\s]+)['"]?\s*$/m.exec(content)?.[1];
  const sha512 = /^\s+sha512:\s*['"]?([^'"\s]+)['"]?\s*$/m.exec(content)?.[1];
  const sizeText = /^\s+size:\s*(\d+)\s*$/m.exec(content)?.[1];
  const feedPath = /^path:\s*['"]?([^'"\s]+)['"]?\s*$/m.exec(content)?.[1] ?? null;
  if (!version || !url || !sha512 || !sizeText) {
    throw new Error(
      'update feed must contain root version plus installer url, sha512, and size fields'
    );
  }
  return { version, url, path: feedPath, sha512, size: Number(sizeText) };
}

/** @param {string} value */
function installerBasename(value) {
  if (value.includes('://')) {
    return path.posix.basename(new URL(value).pathname);
  }
  return path.posix.basename(value.replaceAll('\\', '/'));
}

/** @param {string} filePath @param {boolean} includeSha512 */
async function artifactRecord(filePath, includeSha512 = false) {
  const sha256 = createHash('sha256');
  const sha512 = includeSha512 ? createHash('sha512') : null;
  for await (const chunk of createReadStream(filePath)) {
    sha256.update(chunk);
    sha512?.update(chunk);
  }
  return {
    name: path.basename(filePath),
    bytes: statSync(filePath).size,
    sha256: sha256.digest('hex'),
    ...(sha512 ? { sha512: sha512.digest('base64') } : {}),
  };
}

/**
 * @param {{
 *   outDir: string,
 *   candidateSha: string,
 *   headSha: string,
 *   version: string,
 *   platform: NodeJS.Platform|string,
 *   arch: string,
 *   structureSmoke: string,
 *   generatedAt?: Date,
 *   repository?: string|null,
 *   workflowRunId?: string|null,
 *   workflowRunAttempt?: string|null
 * }} input
 */
export async function collectCandidateEvidence(input) {
  const candidateSha = normalizeCandidateSha(input.candidateSha);
  const headSha = normalizeCandidateSha(input.headSha);
  if (candidateSha !== headSha) {
    throw new Error(`candidate SHA ${candidateSha} does not match checked-out HEAD ${headSha}`);
  }
  if (input.structureSmoke !== 'passed') {
    throw new Error('structure smoke must pass before candidate evidence can be collected');
  }

  const contract = PLATFORM_CONTRACT[input.platform];
  if (!contract) {
    throw new Error(`unsupported desktop evidence platform: ${input.platform}`);
  }

  const installerName = `Puntovivo-${input.version}-${contract.artifactOs}-${input.arch}.${contract.extension}`;
  const installerPath = path.join(input.outDir, installerName);
  const feedPath = path.join(input.outDir, contract.feedName);
  if (!existsSync(installerPath)) {
    throw new Error(`expected candidate installer is missing: ${installerName}`);
  }
  if (!existsSync(feedPath)) {
    throw new Error(`expected update feed is missing: ${contract.feedName}`);
  }

  const feed = parseUpdateFeed(readFileSync(feedPath, 'utf8'));
  if (feed.version !== input.version) {
    throw new Error(
      `update feed version ${feed.version} does not match package version ${input.version}`
    );
  }
  for (const [field, value] of [
    ['url', feed.url],
    ['path', feed.path],
  ]) {
    if (value && installerBasename(value) !== installerName) {
      throw new Error(`update feed ${field} does not reference ${installerName}`);
    }
  }

  const installer = await artifactRecord(installerPath, true);
  if (feed.size !== installer.bytes) {
    throw new Error(
      `update feed size ${feed.size} does not match installer size ${installer.bytes}`
    );
  }
  if (feed.sha512 !== installer.sha512) {
    throw new Error('update feed sha512 does not match the candidate installer');
  }

  const blockmapPath = `${installerPath}.blockmap`;
  return {
    schemaVersion: SCHEMA_VERSION,
    candidateSha,
    version: input.version,
    platform: contract.artifactOs,
    architecture: input.arch,
    generatedAt: (input.generatedAt ?? new Date()).toISOString(),
    source: {
      repository: input.repository ?? null,
      workflowRunId: input.workflowRunId ?? null,
      workflowRunAttempt: input.workflowRunAttempt ?? null,
    },
    checks: {
      exactHead: 'passed',
      packagedStructureSmoke: 'passed',
      updateFeedMatchesInstaller: 'passed',
      // This collector verifies artifact integrity only. Distribution trust
      // requires platform trust stores/signing credentials and must never be
      // promoted through an unchecked CLI string.
      distributionTrust: 'not-assessed',
    },
    artifacts: {
      installer,
      blockmap: existsSync(blockmapPath) ? await artifactRecord(blockmapPath) : null,
      updateFeed: {
        ...(await artifactRecord(feedPath)),
        version: feed.version,
        installer: installerName,
        installerSize: feed.size,
        installerSha512: feed.sha512,
      },
    },
  };
}

function parseArgs(argv) {
  const options = {
    outDir: 'apps/desktop/out-builder',
    output: null,
    candidateSha: null,
    structureSmoke: null,
  };
  for (let index = 0; index < argv.length; index += 2) {
    const option = argv[index];
    const value = argv[index + 1];
    if (!option?.startsWith('--') || !value) {
      throw new Error(`unknown or incomplete option: ${option ?? '(missing)'}`);
    }
    if (option === '--candidate-sha') options.candidateSha = value;
    else if (option === '--structure-smoke') options.structureSmoke = value;
    else if (option === '--out-dir') options.outDir = value;
    else if (option === '--output') options.output = value;
    else throw new Error(`unknown option: ${option}`);
  }
  if (!options.candidateSha) throw new Error('--candidate-sha is required');
  if (!options.structureSmoke) throw new Error('--structure-smoke is required');
  return options;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const packageJson = JSON.parse(
    readFileSync(path.join(repoRoot, 'apps/desktop/package.json'), 'utf8')
  );
  const headSha = execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd: repoRoot,
    encoding: 'utf8',
  }).trim();
  const outDir = path.resolve(repoRoot, options.outDir);
  const platformName = PLATFORM_CONTRACT[process.platform]?.artifactOs ?? process.platform;
  const output = path.resolve(
    repoRoot,
    options.output ??
      path.join(
        '.artifacts',
        'desktop-candidate',
        normalizeCandidateSha(options.candidateSha),
        `${platformName}-${process.arch}.json`
      )
  );

  const evidence = await collectCandidateEvidence({
    outDir,
    candidateSha: options.candidateSha,
    headSha,
    version: packageJson.version,
    platform: process.platform,
    arch: process.arch,
    structureSmoke: options.structureSmoke,
    repository: process.env.GITHUB_REPOSITORY ?? null,
    workflowRunId: process.env.GITHUB_RUN_ID ?? null,
    workflowRunAttempt: process.env.GITHUB_RUN_ATTEMPT ?? null,
  });
  mkdirSync(path.dirname(output), { recursive: true });
  writeFileSync(output, `${JSON.stringify(evidence, null, 2)}\n`);
  console.log(
    JSON.stringify({
      outcome: 'passed',
      candidateSha: evidence.candidateSha,
      installer: evidence.artifacts.installer.name,
      evidencePath: path.relative(repoRoot, output),
    })
  );
}

if (path.resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    console.error(`[desktop-candidate-evidence] ${error.message}`);
    process.exit(1);
  });
}
