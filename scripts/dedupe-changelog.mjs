import { readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const VERSION_HEADING = /^## \[/;
const COMMIT_LINK = /\s+\(\[[0-9a-f]{7,40}\]\([^)]*\)\)\s*$/;

/**
 * release-please lists a merged PR twice: once for its own commit and once for
 * the merge commit, whose body GitHub fills with the PR title. Keeps the first
 * entry of each change within a release.
 */
export function dedupeChangelog(content) {
  const lines = content.split('\n');
  let seen = new Set();
  let releases = 0;
  let removed = 0;
  const kept = lines.filter(line => {
    if (VERSION_HEADING.test(line)) {
      seen = new Set();
      releases += 1;
      return true;
    }
    if (!line.startsWith('* ') || !COMMIT_LINK.test(line)) return true;
    const change = line.replace(COMMIT_LINK, '');
    if (seen.has(change)) {
      removed += 1;
      return false;
    }
    seen.add(change);
    return true;
  });
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
