import { execFileSync } from 'node:child_process';
import { readFileSync, realpathSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HEADING = /^#{1,6} /;
const VERSION_HEADING = /^## \[/;
const BREAKING_HEADING = /^### .*BREAKING CHANGES/;
const COMMIT_LINK = /\s+\(\[([0-9a-f]{7,40})\]\([^)]*\)\)\s*$/;

/**
 * release-please lists a merged PR twice: once for its own commit and once for
 * the merge commit, whose body GitHub fills with the PR title. Within a
 * release, drops a merge-commit entry whose text a regular commit also has,
 * and drops a subsection left empty. Distinct commits with the same message
 * and breaking-change notes, which repeat their feature on purpose, stay.
 *
 * @param {string} content
 * @param {(sha: string) => boolean} isMerge called only for repeated entries
 */
export function dedupeChangelog(content, isMerge) {
  const lines = content.split('\n').map(text => ({ text, drop: false }));
  let groups = new Map();
  let breaking = false;
  let releases = 0;
  const flush = () => {
    for (const entries of groups.values()) {
      if (entries.length < 2) continue;
      const merges = entries.filter(entry => isMerge(entry.sha));
      if (merges.length === entries.length) continue;
      for (const entry of merges) entry.line.drop = true;
    }
    groups = new Map();
  };

  for (const line of lines) {
    if (HEADING.test(line.text)) {
      if (line.text.startsWith('## ')) flush();
      if (VERSION_HEADING.test(line.text)) releases += 1;
      breaking = BREAKING_HEADING.test(line.text);
      continue;
    }
    const link = COMMIT_LINK.exec(line.text);
    if (breaking || !line.text.startsWith('* ') || !link) continue;
    const change = line.text.slice(0, link.index);
    groups.set(change, [...(groups.get(change) ?? []), { line, sha: link[1] }]);
  }
  flush();

  const kept = [];
  let section = null;
  let removed = 0;
  const closeSection = () => {
    if (section?.removed > 0 && !section.hasContent) kept.splice(section.index);
  };
  for (const line of lines) {
    if (HEADING.test(line.text)) {
      closeSection();
      section = line.text.startsWith('### ')
        ? { index: kept.length, removed: 0, hasContent: false }
        : null;
    } else if (line.drop) {
      removed += 1;
      if (section) section.removed += 1;
      continue;
    } else if (section && line.text.trim()) {
      section.hasContent = true;
    }
    kept.push(line.text);
  }
  closeSection();
  return { content: kept.join('\n'), releases, removed };
}

/** Needs the commits in the local history; an unknown SHA throws. */
export function isMergeCommit(sha, cwd) {
  const parents = execFileSync('git', ['rev-list', '--no-walk', '--parents', `${sha}^{commit}`], {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return parents.trim().split(' ').length > 2;
}

export function dedupeChangelogFile(file, isMerge = sha => isMergeCommit(sha, path.dirname(file))) {
  const result = dedupeChangelog(readFileSync(file, 'utf8'), isMerge);
  if (result.releases === 0) throw new Error(`${file} has no release sections`);
  if (result.removed > 0) writeFileSync(file, result.content);
  return result;
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const file = process.argv[2];
  if (!file) {
    process.stderr.write('Usage: node scripts/dedupe-changelog.mjs CHANGELOG.md\n');
    process.exit(2);
  }
  try {
    const { removed } = dedupeChangelogFile(file);
    process.stdout.write(`Removed ${removed} duplicate entries from ${file}.\n`);
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exit(1);
  }
}
