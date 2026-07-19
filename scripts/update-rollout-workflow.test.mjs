import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function readRepoFile(relativePath) {
  return readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

test('release workflow starts desktop updates at a bounded ten-percent rollout', () => {
  const workflow = readRepoFile('.github/workflows/release.yml');

  assert.match(workflow, /rollout_percentage:[\s\S]*default: '10'/);
  assert.ok(workflow.includes('RELEASE_TAG: ${{ inputs.tag }}'));
  assert.ok(workflow.includes('--rollout "$ROLLOUT_PERCENTAGE" --mode normal'));
  assert.match(workflow, /gh release upload "\$RELEASE_TAG" "\$file" --clobber/);
  assert.match(workflow, /-name 'latest\*\.yml' -o -name 'update-policy\.json'/);
  assert.doesNotMatch(workflow, /zip .*\$\{\{ inputs\.tag \}\}/);
  assert.doesNotMatch(workflow, /gh release upload "\$\{\{ inputs\.tag \}\}"/);
  assert.doesNotMatch(workflow, /upload-release-assets\.mjs "\$\{\{ inputs\.tag \}\}"/);
});

test('manual rollout workflow uses archived feeds and forces rollback to one exact fleet-wide target', () => {
  const workflow = readRepoFile('.github/workflows/update-rollout.yml');

  assert.match(workflow, /^  workflow_dispatch:$/m);
  assert.ok(workflow.includes('TARGET_TAG: ${{ inputs.target_tag }}'));
  assert.ok(workflow.includes('versionFromTag(process.env.TARGET_TAG)'));
  assert.ok(workflow.includes('gh release download "$TARGET_TAG"'));
  assert.match(workflow, /mode=rollback\s+percentage=100/);
  assert.ok(workflow.includes('--rollout "$percentage" --mode "$mode"'));
  assert.doesNotMatch(workflow, /run:[\s\S]*gh release download "\$\{\{ inputs\.target_tag \}\}"/);
  assert.match(workflow, /Only releases created after ENG-137a are rollback-ready/);
  assert.match(workflow, /^  group: pages$/m);
  assert.match(workflow, /^  cancel-in-progress: false$/m);
});
