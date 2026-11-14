import { readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const HEADING = /^#{1,6} /;
const VERSION_HEADING = /^## \[/;
const BREAKING_HEADING = /^### .*BREAKING CHANGES/;
const COMMIT_LINK = /\s+\(\[[0-9a-f]{7,40}\]\([^)]*\)\)\s*$/;

/**
 * release-please lists a merged PR twice: once for its own commit and once for
 * the merge commit, whose body GitHub fills with the PR title. Keeps the first
 * entry of each change within a release, and drops a subsection left empty.
 * Breaking-change notes repeat their feature on purpose and are left alone.
 */
export function dedupeChangelog(content) {
  const kept = [];
  let seen = new Set();
  let section = null;
  let releases = 0;
  let removed = 0;
  const closeSection = () => {
    if (section?.removed > 0 && !section.hasContent) kept.splice(section.index);
  };
  for (const line of content.split('\n')) {
    if (HEADING.test(line)) {
      closeSection();
      section = line.startsWith('### ')
        ? {
            index: kept.length,
            removed: 0,
            hasContent: false,
            breaking: BREAKING_HEADING.test(line),
          }
        : null;
      if (line.startsWith('## ')) seen = new Set();
      if (VERSION_HEADING.test(line)) releases += 1;
      kept.push(line);
      continue;
    }
    if (!section?.breaking && line.startsWith('* ') && COMMIT_LINK.test(line)) {
      const change = line.replace(COMMIT_LINK, '');
      if (seen.has(change)) {
        removed += 1;
        if (section) section.removed += 1;
        continue;
      }
      seen.add(change);
    }
    if (section && line.trim()) section.hasContent = true;
    kept.push(line);
  }
  closeSection();
  return { content: kept.join('\n'), releases, removed };
}

export function dedupeChangelogFile(file) {
  const result = dedupeChangelog(readFileSync(file, 'utf8'));
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
