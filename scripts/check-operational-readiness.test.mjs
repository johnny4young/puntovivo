import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';

import { OPERATIONAL_READINESS_SERVICES } from '../packages/shared/src/operational-readiness.ts';
import { checkOperationalReadiness } from './check-operational-readiness.mjs';

const repositoryRoot = resolve(import.meta.dirname, '..');

async function copyContractFixture(root) {
  const anchors = OPERATIONAL_READINESS_SERVICES.map(
    service => `<a id="${service.runbookId}"></a>`
  ).join('\n');
  await mkdir(join(root, 'docs'), { recursive: true });
  await writeFile(join(root, 'docs/OPERATIONS-RUNBOOKS.md'), anchors);

  for (const service of OPERATIONAL_READINESS_SERVICES) {
    for (const drill of service.drills) {
      const target = join(root, drill.file);
      await mkdir(dirname(target), { recursive: true });
      const previous = await readFile(target, 'utf8').catch(() => '');
      await writeFile(target, `${previous}\ntest(${JSON.stringify(drill.testTitle)}, () => {});\n`);
    }
  }
}

test('accepts the repository readiness contract', async () => {
  const result = await checkOperationalReadiness(repositoryRoot);
  assert.deepEqual(result.errors, []);
  assert.equal(result.serviceCount, 6);
});

test('reports a missing runbook and drifted drill title', async () => {
  const root = await mkdtemp(join(tmpdir(), 'puntovivo-readiness-'));
  try {
    await copyContractFixture(root);
    const sync = OPERATIONAL_READINESS_SERVICES[0];
    await writeFile(join(root, 'docs/OPERATIONS-RUNBOOKS.md'), '');
    await writeFile(join(root, sync.drills[0].file), 'renamed test');

    const result = await checkOperationalReadiness(root);
    assert.ok(result.errors.some(error => error.includes('runbook anchor')));
    assert.ok(result.errors.some(error => error.includes('drill title')));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('rejects drill titles that appear only in comments or longer test names', async () => {
  const sync = OPERATIONAL_READINESS_SERVICES[0];
  for (const evidence of [
    `// test(${JSON.stringify(sync.drills[0].testTitle)}, () => {});\n`,
    `test('${sync.drills[0].testTitle} with extra context', () => {})\n`,
  ]) {
    const root = await mkdtemp(join(tmpdir(), 'puntovivo-readiness-exact-'));
    try {
      await copyContractFixture(root);
      await writeFile(join(root, sync.drills[0].file), evidence);
      const result = await checkOperationalReadiness(root);
      assert.ok(result.errors.some(error => error.includes('drill title is missing')));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }
});
