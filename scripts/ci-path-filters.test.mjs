import { strict as assert } from 'node:assert';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const readRepoFile = relative => readFileSync(path.join(repoRoot, relative), 'utf8');

// Read one list of the detect-changes paths filter. Each entry is a quoted glob
// on its own line; comment lines inside a list are skipped and the list ends at
// the next filter name.
function readPathFilter(workflow, name) {
  const lines = workflow.split(/\r?\n/u);
  const start = lines.indexOf(`            ${name}:`);
  assert.ok(start >= 0, `expected a ${name} paths filter in ci.yml`);
  const globs = [];
  for (const line of lines.slice(start + 1)) {
    if (/^\s*#/u.test(line)) continue;
    const entry = line.match(/^ {14}- '([^']+)'$/u);
    if (!entry) break;
    globs.push(entry[1]);
  }
  assert.ok(globs.length > 0, `expected entries in the ${name} paths filter`);
  return globs;
}

// dorny/paths-filter matches with picomatch. The filters only use * and **, so
// anything else fails here instead of being matched wrongly.
function globToRegExp(glob) {
  assert.match(glob, /^[\w./*@-]+$/u, `unsupported paths filter syntax: ${glob}`);
  const pattern = glob
    .split('**')
    .map(part =>
      part
        .split('*')
        .map(text => text.replace(/[.+?^${}()|[\]\\]/gu, '\\$&'))
        .join('[^/]*')
    )
    .join('.*');
  return new RegExp(`^${pattern}$`, 'u');
}

// A test depends on the files it imports or reads by a literal path, and on
// whatever the local scripts it imports depend on in turn.
function localInputs(entry) {
  const inputs = new Set([entry]);
  const visit = file => {
    const source = readRepoFile(file);
    const directory = path.posix.dirname(file);
    const found = [
      ...[...source.matchAll(/(?:from\s+|import\s*\(\s*)'(\.{1,2}\/[^']+)'/gu)].map(match =>
        path.posix.normalize(path.posix.join(directory, match[1]))
      ),
      ...[...source.matchAll(/new URL\(\s*'(\.{1,2}\/[^']+)',\s*import\.meta\.url\s*\)/gu)].map(
        match => path.posix.normalize(path.posix.join(directory, match[1]))
      ),
      ...[...source.matchAll(/readFileSync\(\s*'([a-z][^']*)'/gu)].map(match => match[1]),
    ];
    for (const input of found) {
      if (inputs.has(input) || !existsSync(path.join(repoRoot, input))) continue;
      inputs.add(input);
      if (input.startsWith('scripts/') && input.endsWith('.mjs')) visit(input);
    }
  };
  visit(entry);
  return [...inputs];
}

test('every script test ci:desktop runs is covered by the desktop paths filter', () => {
  // ci:desktop is the only gate that runs these tests, and the Desktop
  // Workspace job runs it only when the desktop or shared filter matches. A
  // test, or a file it depends on, outside both filters can change without its
  // test ever running in pull request CI.
  const workflow = readRepoFile('.github/workflows/ci.yml');
  const covering = [
    ...readPathFilter(workflow, 'desktop'),
    ...readPathFilter(workflow, 'shared'),
  ].map(globToRegExp);
  const ciDesktop = JSON.parse(readRepoFile('package.json')).scripts['ci:desktop'];
  const tests = ciDesktop.match(/scripts\/[\w.-]+\.test\.mjs/gu) ?? [];
  assert.ok(tests.length > 0, 'expected ci:desktop to run script tests');

  const uncovered = tests
    .flatMap(testFile => localInputs(testFile).map(input => ({ testFile, input })))
    .filter(({ input }) => !covering.some(pattern => pattern.test(input)))
    .map(({ testFile, input }) => (input === testFile ? input : `${input} (read by ${testFile})`));
  assert.deepEqual(
    uncovered,
    [],
    `not covered by the desktop or shared filter:\n${uncovered.join('\n')}`
  );
});

test('the paths filter reader and glob matcher agree with picomatch on the forms in use', () => {
  const workflow = [
    '          filters: |',
    '            shared:',
    "              - 'package.json'",
    '              # a comment inside the list',
    "              - 'config/**'",
    '            desktop:',
    "              - 'scripts/check-electron-memory*.mjs'",
  ].join('\n');
  assert.deepEqual(readPathFilter(workflow, 'shared'), ['package.json', 'config/**']);
  assert.deepEqual(readPathFilter(workflow, 'desktop'), ['scripts/check-electron-memory*.mjs']);

  const star = globToRegExp('scripts/check-electron-memory*.mjs');
  assert.ok(star.test('scripts/check-electron-memory.test.mjs'));
  assert.ok(!star.test('scripts/lib/check-electron-memory.mjs'));
  const globstar = globToRegExp('apps/desktop/**');
  assert.ok(globstar.test('apps/desktop/src/main/index.ts'));
  assert.ok(!globstar.test('apps/web/src/main.tsx'));
  assert.throws(() => globToRegExp('scripts/{a,b}.mjs'), /unsupported paths filter syntax/);
});
