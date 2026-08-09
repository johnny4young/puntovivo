import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import test from 'node:test';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function readRepoFile(relativePath) {
  return readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

test('long-shift command stays opt-in, serial, and outside the ordinary suite', () => {
  const packageJson = JSON.parse(readRepoFile('package.json'));
  const soakCommand = packageJson.scripts['test:e2e:web:soak'];
  const ordinaryCommand = packageJson.scripts['test:e2e:web'];

  assert.equal(typeof soakCommand, 'string');
  assert.match(soakCommand, /--grep @long-shift-soak/);
  assert.match(soakCommand, /--workers=1/);
  assert.match(soakCommand, /--forbid-only/);
  assert.match(ordinaryCommand, /--grep-invert @long-shift-soak/);

  const workflow = readRepoFile('.github/workflows/ci.yml');
  assert.doesNotMatch(workflow, /pnpm run test:e2e:web:soak/);
});

test('retained-growth budget has warmup, repeated checkpoints, and bounded signals', () => {
  const { longShiftSoak: budget } = JSON.parse(readRepoFile('perf-budget.json'));

  assert.ok(budget.warmupCycles >= 5);
  assert.ok(budget.cycles >= 30);
  assert.ok(budget.checkpointEvery > 0);
  assert.equal(budget.cycles % budget.checkpointEvery, 0);
  for (const metric of ['usedHeapMb', 'documents', 'nodes', 'jsEventListeners']) {
    assert.equal(typeof budget.maxGrowth[metric], 'number');
    assert.ok(budget.maxGrowth[metric] >= 0);
  }
});

test('web CI pins the pure comparator while the live soak owns browser proof', () => {
  const packageJson = JSON.parse(readRepoFile('package.json'));
  const ciWeb = packageJson.scripts['ci:web'];
  assert.match(ciWeb, /scripts\/long-shift-soak-contract\.test\.mjs/);
  assert.match(ciWeb, /scripts\/long-shift-memory\.test\.mts/);

  const spec = readRepoFile('e2e/web/long-shift-soak.spec.ts');
  assert.equal((spec.match(/tag: '@long-shift-soak'/g) ?? []).length, 1);
  assert.match(spec, /exerciseInvoiceOcrPreviewLifecycle/);
  assert.match(spec, /sampleRendererMemory/);
  assert.match(spec, /restoreTenantSettings/);
});
