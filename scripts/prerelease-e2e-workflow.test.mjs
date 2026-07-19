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

test('prerelease command selects exactly the three tagged money flows serially', () => {
  const packageJson = JSON.parse(readRepoFile('package.json'));
  const command = packageJson.scripts['test:e2e:web:prerelease'];
  const businessSpec = readRepoFile('e2e/web/business.spec.ts');

  assert.equal(typeof command, 'string');
  assert.match(command, /--grep @prerelease-money/);
  assert.match(command, /--workers=1/);
  assert.match(command, /--forbid-only/);
  assert.match(businessSpec, /const PRERELEASE_MONEY_TAG = '@prerelease-money';/);
  assert.equal((businessSpec.match(/tag: PRERELEASE_MONEY_TAG/g) ?? []).length, 3);
});

test('prerelease workflow is reusable, manually dispatchable, and retains evidence', () => {
  const workflow = readRepoFile('.github/workflows/prerelease-e2e.yml');
  const job = extractJob(workflow, 'e2e-web');

  assert.match(workflow, /^  workflow_call:$/m);
  assert.match(workflow, /^  workflow_dispatch:$/m);
  assert.ok(job.includes('ref: ${{ inputs.ref }}'));
  assert.match(job, /run: pnpm run test:e2e:web:prerelease/);
  assert.match(job, /PUNTOVIVO_AUDIT_DIR: test-results\/prerelease-evidence/);
  assert.match(job, /if: \$\{\{ always\(\) \}\}/);
});

test('release artifacts wait for the exact-tag prerelease gate without enabling push CI', () => {
  const releaseWorkflow = readRepoFile('.github/workflows/release.yml');
  const ciWorkflow = readRepoFile('.github/workflows/ci.yml');
  const gate = extractJob(releaseWorkflow, 'e2e-web');
  const releaseWeb = extractJob(releaseWorkflow, 'release-web');
  const releaseDesktop = extractJob(releaseWorkflow, 'release-desktop');

  assert.match(gate, /uses: \.\/\.github\/workflows\/prerelease-e2e\.yml/);
  assert.ok(gate.includes('ref: refs/tags/${{ inputs.tag }}'));
  assert.match(releaseWeb, /^    needs: e2e-web$/m);
  assert.match(releaseDesktop, /^    needs: e2e-web$/m);
  assert.match(ciWorkflow, /^              - 'e2e\/web\/business\.spec\.ts'$/m);
  assert.match(ciWorkflow, /^              - '\.github\/workflows\/prerelease-e2e\.yml'$/m);
  assert.doesNotMatch(ciWorkflow, /run: pnpm run test:e2e:web:prerelease/);
  assert.doesNotMatch(ciWorkflow, /uses: \.\/\.github\/workflows\/prerelease-e2e\.yml/);
});
