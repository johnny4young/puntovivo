import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import test from 'node:test';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function readRepoFile(relativePath) {
  return readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

function extractJob(workflow, jobName) {
  const lines = workflow.split('\n');
  const start = lines.findIndex(line => line === `  ${jobName}:`);
  assert.notEqual(start, -1, `Expected workflow job ${jobName}`);

  let end = lines.length;
  for (let index = start + 1; index < lines.length; index += 1) {
    if (/^  [a-zA-Z0-9_-]+:$/.test(lines[index])) {
      end = index;
      break;
    }
  }

  return lines.slice(start, end).join('\n');
}

test('critical command selects the bounded tagged contract serially', () => {
  const packageJson = JSON.parse(readRepoFile('package.json'));
  const contract = JSON.parse(readRepoFile('operator-journeys.json'));
  const command = packageJson.scripts['test:e2e:web:critical'];

  assert.equal(typeof command, 'string');
  assert.match(command, /--grep @critical/);
  assert.match(command, /--workers=1/);
  assert.match(command, /--forbid-only/);
  assert.doesNotMatch(command, /--grep-invert/);
  assert.deepEqual(contract.criticalE2E.requiredAreas, ['sell', 'control', 'close', 'stock']);
  assert.equal(contract.criticalE2E.journeyIds.length, 4);
});

test('web CI runs only the critical subset and retains failure diagnostics', () => {
  const workflow = readRepoFile('.github/workflows/ci.yml');
  const webJob = extractJob(workflow, 'web');

  assert.match(webJob, /run: pnpm run test:e2e:web:critical/);
  assert.doesNotMatch(webJob, /run: pnpm run test:e2e:web\s*$/m);
  assert.match(webJob, /if: \$\{\{ failure\(\) \}\}/);
  assert.match(webJob, /test-results\/playwright-web/);
  assert.match(webJob, /playwright-report\/web/);
});

test('web path filtering includes the executable critical contract', () => {
  const workflow = readRepoFile('.github/workflows/ci.yml');

  assert.match(workflow, /^              - 'e2e\/web\/\*\*'$/m);
  assert.match(workflow, /^              - 'operator-journeys\.json'$/m);
  assert.match(workflow, /^              - 'playwright\.web\.config\.ts'$/m);
  assert.match(workflow, /^              - 'scripts\/check-operator-journeys\*\.mjs'$/m);
});
