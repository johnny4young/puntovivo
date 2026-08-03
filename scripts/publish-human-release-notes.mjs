import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { formatGhFailure } from './github-cli-utils.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TAG_PATTERN = /^v\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
const REQUIRED_HEADINGS = [
  '## Why this release matters',
  '## What changed',
  '## Before you use it',
  '## Downloads',
];

export function humanReleaseNotesPath(tag, root = repoRoot) {
  if (!TAG_PATTERN.test(tag)) {
    throw new Error(`Invalid release tag: ${tag}`);
  }
  return path.join(root, 'docs', 'releases', `${tag}.md`);
}

export function validateHumanReleaseNotes(tag, content) {
  if (!content.startsWith(`# Puntovivo ${tag} `)) {
    throw new Error(`Release notes must start with "# Puntovivo ${tag} — ..."`);
  }
  for (const heading of REQUIRED_HEADINGS) {
    if (!content.includes(heading)) {
      throw new Error(`Release notes are missing required heading: ${heading}`);
    }
  }
  if (content.trim().split(/\s+/).length < 120) {
    throw new Error('Release notes are too short to explain the release in human terms');
  }
}

export function publishHumanReleaseNotes(tag, { root = repoRoot, run = spawnSync } = {}) {
  const notesPath = humanReleaseNotesPath(tag, root);
  if (!existsSync(notesPath)) {
    throw new Error(`Missing curated release notes: ${path.relative(root, notesPath)}`);
  }

  const content = readFileSync(notesPath, 'utf8');
  validateHumanReleaseNotes(tag, content);
  const relativeNotesPath = path.relative(root, notesPath);
  const result = run('gh', ['release', 'edit', tag, '--notes-file', relativeNotesPath], {
    cwd: root,
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    throw new Error(formatGhFailure(`Could not publish human release notes for ${tag}`, result));
  }
  return { tag, notesPath: relativeNotesPath };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const tag = process.argv[2];
    if (!tag) throw new Error('Usage: node scripts/publish-human-release-notes.mjs vX.Y.Z');
    const published = publishHumanReleaseNotes(tag);
    process.stdout.write(`Published ${published.notesPath} to GitHub release ${published.tag}.\n`);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
