import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { formatGhFailure } from './github-cli-utils.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TAG_PATTERN = /^v\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
// Spanish is the primary note; the English one mirrors it.
export const RELEASE_NOTE_LANGUAGES = ['es', 'en'];
const NOTE_DIRECTORIES = { es: ['docs', 'es', 'releases'], en: ['docs', 'releases'] };
const REQUIRED_HEADINGS = {
  es: ['## Por qué importa este release', '## Qué cambió', '## Antes de usarlo', '## Descargas'],
  en: ['## Why this release matters', '## What changed', '## Before you use it', '## Downloads'],
};

export function humanReleaseNotesPath(tag, root = repoRoot, language = 'es') {
  if (!TAG_PATTERN.test(tag)) {
    throw new Error(`Invalid release tag: ${tag}`);
  }
  const directory = NOTE_DIRECTORIES[language];
  if (!directory) throw new Error(`Unsupported release note language: ${language}`);
  return path.join(root, ...directory, `${tag}.md`);
}

export function validateHumanReleaseNotes(tag, content, language = 'es') {
  if (!content.startsWith(`# Puntovivo ${tag} `)) {
    throw new Error(`Release notes must start with "# Puntovivo ${tag} — ..."`);
  }
  for (const heading of REQUIRED_HEADINGS[language]) {
    if (!content.includes(heading)) {
      throw new Error(`Release notes are missing required heading: ${heading}`);
    }
  }
  if (content.trim().split(/\s+/).length < 120) {
    throw new Error('Release notes are too short to explain the release in human terms');
  }
}

/** GitHub release body: the Spanish note, then the English mirror folded below it. */
export function composeReleaseBody(spanish, english) {
  return (
    [
      spanish.trim(),
      '---',
      '<details>\n<summary>English</summary>',
      english.trim(),
      '</details>',
    ].join('\n\n') + '\n'
  );
}

export function publishHumanReleaseNotes(tag, { root = repoRoot, run = spawnSync } = {}) {
  const notes = RELEASE_NOTE_LANGUAGES.map(language => {
    const notesPath = humanReleaseNotesPath(tag, root, language);
    if (!existsSync(notesPath)) {
      throw new Error(`Missing curated release notes: ${path.relative(root, notesPath)}`);
    }
    const content = readFileSync(notesPath, 'utf8');
    validateHumanReleaseNotes(tag, content, language);
    return { content, notesPath: path.relative(root, notesPath) };
  });

  const bodyPath = path.join(
    mkdtempSync(path.join(os.tmpdir(), 'puntovivo-release-body-')),
    'body.md'
  );
  writeFileSync(bodyPath, composeReleaseBody(notes[0].content, notes[1].content));
  const result = run('gh', ['release', 'edit', tag, '--notes-file', bodyPath], {
    cwd: root,
    encoding: 'utf8',
  });
  rmSync(path.dirname(bodyPath), { recursive: true, force: true });
  if (result.status !== 0) {
    throw new Error(formatGhFailure(`Could not publish human release notes for ${tag}`, result));
  }
  return { tag, notesPaths: notes.map(note => note.notesPath) };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const tag = process.argv[2];
    if (!tag) throw new Error('Usage: node scripts/publish-human-release-notes.mjs vX.Y.Z');
    const published = publishHumanReleaseNotes(tag);
    process.stdout.write(
      `Published ${published.notesPaths.join(' and ')} to GitHub release ${published.tag}.\n`
    );
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
