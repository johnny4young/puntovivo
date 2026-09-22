import { strict as assert } from 'node:assert';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const readRepoFile = relative => readFileSync(path.join(repoRoot, relative), 'utf8');

// Read every list of the detect-changes paths filter. Each entry is a quoted
// glob on its own line; comment lines inside a list are skipped.
function readPathFilters(workflow) {
  const lines = workflow.split(/\r?\n/u);
  const start = lines.findIndex(line => /^ {10}filters: \|$/u.test(line));
  assert.ok(start >= 0, 'expected the detect-changes paths filter in ci.yml');
  const filters = {};
  let current = null;
  for (const line of lines.slice(start + 1)) {
    const name = line.match(/^ {12}([\w-]+):$/u);
    if (name) {
      current = name[1];
      filters[current] = [];
      continue;
    }
    if (/^\s*#/u.test(line)) continue;
    const entry = line.match(/^ {14}- '([^']+)'$/u);
    if (!entry || !current) break;
    filters[current].push(entry[1]);
  }
  assert.ok(Object.keys(filters).length > 0, 'expected named paths filter lists');
  return filters;
}

// Read which package scripts each job runs and which filter outputs its
// condition requires. A job without a condition runs on every change.
function readJobs(workflow) {
  const lines = workflow.split(/\r?\n/u);
  const start = lines.indexOf('jobs:');
  assert.ok(start >= 0, 'expected a jobs section in ci.yml');
  const jobs = [];
  let job = null;
  for (const line of lines.slice(start + 1)) {
    const header = line.match(/^ {2}([\w-]+):$/u);
    if (header) {
      job = { name: header[1], filters: null, scripts: [] };
      jobs.push(job);
      continue;
    }
    if (!job) continue;
    const condition = line.match(/^ {4}if: (.*)$/u);
    if (condition) {
      job.filters = [
        ...condition[1].matchAll(/needs\.detect-changes\.outputs\.([\w-]+) == 'true'/gu),
      ].map(match => match[1]);
    }
    const run = line.match(/^\s+(?:-\s+)?run: pnpm run ([\w:-]+)\s*$/u);
    if (run) job.scripts.push(run[1]);
  }
  return jobs;
}

// Map each package script a job reaches, directly or through pnpm run, to the
// filters that make some job run it. null means a job runs it on every change.
function scriptFilters(jobs, scripts) {
  const reached = new Map();
  const reach = (name, filters, seen) => {
    if (seen.has(name) || scripts[name] === undefined) return;
    seen.add(name);
    const current = reached.has(name) ? reached.get(name) : new Set();
    if (current !== null && filters !== null) {
      for (const filter of filters) current.add(filter);
      reached.set(name, current);
    } else {
      reached.set(name, null);
    }
    for (const match of scripts[name].matchAll(/pnpm run ([\w:-]+)/gu)) {
      reach(match[1], filters, seen);
    }
  };
  for (const job of jobs) {
    for (const script of job.scripts) reach(script, job.filters, new Set());
  }
  return reached;
}

// The script test files a package script runs, including nested and .mts tests.
function scriptTests(scriptText) {
  return scriptText.match(/scripts\/[\w./-]+\.test\.m[jt]s/gu) ?? [];
}

// dorny/paths-filter matches with picomatch (dot: true). The filters use * and
// ** as a whole path segment; a globstar matches zero or more segments. Any
// other syntax fails here instead of being matched differently from CI.
function globToRegExp(glob) {
  assert.match(glob, /^[\w./*@-]+$/u, `unsupported paths filter syntax: ${glob}`);
  const segments = glob.split('/');
  let pattern = '';
  segments.forEach((segment, index) => {
    const first = index === 0;
    const last = index === segments.length - 1;
    if (segment === '**') {
      if (first && last) pattern += '.*';
      else if (first) pattern += '(?:[^/]+/)*';
      else if (last) pattern += '(?:/.*)?';
      else pattern += '(?:/[^/]+)*';
      return;
    }
    assert.ok(!segment.includes('**'), `unsupported paths filter syntax: ${glob}`);
    const separator = first || (index === 1 && segments[0] === '**') ? '' : '/';
    pattern +=
      separator +
      segment
        .split('*')
        .map(text => text.replace(/[.+?^${}()|[\]\\]/gu, '\\$&'))
        .join('[^/]*');
  });
  return new RegExp(`^${pattern}$`, 'u');
}

// The repository files a source names statically: relative imports, including
// side-effect imports, relative new URL(..., import.meta.url) reads, and
// readFile or readFileSync calls with a literal repository path. Paths built
// at runtime, through variables, template literals or path.join, are not
// followed, so a dependency added that way needs its own filter entry.
function referencedPaths(source, file) {
  const directory = path.posix.dirname(file);
  const relative = specifier => path.posix.normalize(path.posix.join(directory, specifier));
  return [
    ...[
      ...source.matchAll(/(?:\bfrom\s+|\bimport\s+|\bimport\s*\(\s*)(['"])(\.{1,2}\/[^'"]+)\1/gu),
    ].map(match => relative(match[2])),
    ...[
      ...source.matchAll(/new URL\(\s*(['"])(\.{1,2}\/[^'"]+)\1,\s*import\.meta\.url\s*\)/gu),
    ].map(match => relative(match[2])),
    ...[...source.matchAll(/\b(?:readFileSync|readFile)\(\s*(['"])([a-z][^'"]*)\1/gu)]
      .map(match => match[2])
      .filter(input => !input.startsWith('node_modules/')),
  ];
}

// A test depends on the files it references and, through the local scripts it
// imports, on whatever those reference in turn.
function localInputs(entry) {
  const inputs = new Set([entry]);
  const visit = file => {
    for (const input of referencedPaths(readRepoFile(file), file)) {
      if (inputs.has(input) || !existsSync(path.join(repoRoot, input))) continue;
      inputs.add(input);
      if (input.startsWith('scripts/') && /\.m?[jt]s$/u.test(input)) visit(input);
    }
  };
  visit(entry);
  return [...inputs];
}

test('every script test a CI gate runs is covered by the filters of a job that runs it', () => {
  // A job runs its gate only when its own paths filter or the shared filter
  // matches. A test, or a file it depends on, outside every filter of every job
  // that runs its gate can change without its test ever running in pull
  // request CI.
  const workflow = readRepoFile('.github/workflows/ci.yml');
  const filters = readPathFilters(workflow);
  const scripts = JSON.parse(readRepoFile('package.json')).scripts;
  const reached = scriptFilters(readJobs(workflow), scripts);
  assert.ok(reached.has('ci:shared'), 'expected ci:shared to be reached from a CI job');

  const uncovered = [];
  let checkedTests = 0;
  for (const [script, filterNames] of reached) {
    if (filterNames === null) continue;
    const covering = [...filterNames].flatMap(name => filters[name] ?? []).map(globToRegExp);
    for (const testFile of scriptTests(scripts[script])) {
      checkedTests += 1;
      for (const input of localInputs(testFile)) {
        if (covering.some(pattern => pattern.test(input))) continue;
        const reader = input === testFile ? '' : ` (read by ${testFile})`;
        uncovered.push(`${script} [${[...filterNames].join(', ')}]: ${input}${reader}`);
      }
    }
  }
  assert.ok(checkedTests > 0, 'expected CI gates to run script tests');
  assert.deepEqual(
    uncovered,
    [],
    `not covered by a filter of any job that runs the gate:\n${uncovered.join('\n')}`
  );
});

test('release automation executes the distribution trust and packaged binary contracts', () => {
  const workflow = readRepoFile('.github/workflows/ci.yml');
  const scripts = JSON.parse(readRepoFile('package.json')).scripts;
  const jobs = readJobs(workflow).filter(job => job.name === 'release-automation');
  assert.equal(jobs.length, 1, 'expected the path-gated release automation job');
  const reached = scriptFilters(jobs, scripts);
  const registered = new Set([...reached.keys()].flatMap(name => scriptTests(scripts[name])));

  // The general filter guard can only inspect tests that are already registered.
  // Keep these release-safety contracts from silently becoming orphaned again.
  for (const contract of [
    'scripts/distribution-trust.test.mjs',
    'scripts/packaged-binary.test.mjs',
  ]) {
    assert.ok(registered.has(contract), `release automation does not execute ${contract}`);
  }
});

test('the filters, jobs, globs and references are read the way CI resolves them', () => {
  const workflow = [
    '          filters: |',
    '            shared:',
    "              - 'package.json'",
    '              # a comment inside the list',
    "              - 'config/**'",
    '            web:',
    "              - 'apps/web/**'",
    'jobs:',
    '  web:',
    "    if: ${{ needs.detect-changes.outputs.web == 'true' || needs.detect-changes.outputs.shared == 'true' }}",
    '    steps:',
    '      - run: pnpm run ci:web',
    '  audit:',
    '    steps:',
    '      - name: Audit',
    '        run: pnpm run ci:audit',
  ].join('\n');
  assert.deepEqual(readPathFilters(workflow), {
    shared: ['package.json', 'config/**'],
    web: ['apps/web/**'],
  });
  const reached = scriptFilters(readJobs(workflow), {
    'ci:web': 'pnpm run ci:shared && vitest',
    'ci:shared': 'node --test scripts/a.test.mjs',
    'ci:audit': 'node scripts/audit.mjs',
  });
  assert.deepEqual([...reached.get('ci:shared')], ['web', 'shared']);
  assert.equal(reached.get('ci:audit'), null);

  // Expected results match picomatch with dot: true for each form.
  const cases = [
    ['scripts/check-electron-memory*.mjs', 'scripts/check-electron-memory.test.mjs', true],
    ['scripts/check-electron-memory*.mjs', 'scripts/lib/check-electron-memory.mjs', false],
    ['apps/desktop/**', 'apps/desktop/src/main/index.ts', true],
    ['apps/desktop/**', 'apps/desktop', true],
    ['apps/desktop/**', 'apps/web/src/main.tsx', false],
    ['scripts/**/journey*.mjs', 'scripts/journey.test.mjs', true],
    ['scripts/**/journey*.mjs', 'scripts/lib/deep/journey.mjs', true],
    ['**/fixtures.ts', 'fixtures.ts', true],
    ['**/fixtures.ts', 'e2e/electron/fixtures.ts', true],
    ['e2e/**/fixtures.ts', 'e2e/fixtures.ts', true],
    ['config/**', 'config/.hidden.json', true],
  ];
  for (const [glob, file, expected] of cases) {
    assert.equal(globToRegExp(glob).test(file), expected, `${glob} against ${file}`);
  }
  assert.throws(() => globToRegExp('scripts/{a,b}.mjs'), /unsupported paths filter syntax/);
  assert.throws(() => globToRegExp('scripts/a**.mjs'), /unsupported paths filter syntax/);

  // The paths below do not exist, so this file's own fixture never reads as a
  // dependency of the guard when the guard checks itself.
  const source = [
    "import './example-setup.mjs';",
    'import { a } from "./lib/example-a.mjs";',
    "export { b } from '../lib/example-b.mjs';",
    "const c = await import('./example-c.mjs');",
    "const d = readFileSync(new URL('../example-budget.json', import.meta.url));",
    "const e = await readFile('e2e/example/fixtures.ts', 'utf8');",
    "const f = readFileSync('node_modules/x/package.json');",
    'const g = await import(`./${name}.mjs`);',
  ].join('\n');
  assert.deepEqual(referencedPaths(source, 'scripts/example.test.mjs'), [
    'scripts/example-setup.mjs',
    'scripts/lib/example-a.mjs',
    'lib/example-b.mjs',
    'scripts/example-c.mjs',
    'example-budget.json',
    'e2e/example/fixtures.ts',
  ]);
  assert.deepEqual(
    scriptTests('node --test scripts/a.test.mjs scripts/lib/b.test.mjs scripts/c.test.mts'),
    ['scripts/a.test.mjs', 'scripts/lib/b.test.mjs', 'scripts/c.test.mts']
  );
});
