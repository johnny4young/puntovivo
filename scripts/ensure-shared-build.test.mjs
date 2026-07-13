import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, it } from 'node:test';
import { buildIsFresh, runtimeSourceFiles } from './ensure-shared-build.mjs';

const tempRoots = [];
const entrypoints = ['index', 'money', 'unit-math', 'units'];

async function createSharedFixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'puntovivo-shared-build-'));
  tempRoots.push(root);
  await mkdir(path.join(root, 'src', 'nested'), { recursive: true });
  await mkdir(path.join(root, 'dist'), { recursive: true });
  await writeFile(path.join(root, 'package.json'), '{}');
  await writeFile(path.join(root, 'tsconfig.json'), '{}');
  await writeFile(path.join(root, 'src', 'money.ts'), 'export const value = 1;');
  await writeFile(path.join(root, 'src', 'money.test.ts'), 'throw new Error();');
  await writeFile(path.join(root, 'src', 'nested', 'units.ts'), 'export const unit = 1;');
  for (const name of entrypoints) {
    await writeFile(path.join(root, 'dist', `${name}.js`), 'export {};');
    await writeFile(path.join(root, 'dist', `${name}.d.ts`), 'export {};');
  }
  return root;
}

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map(root => rm(root, { recursive: true, force: true })));
});

describe('shared build freshness', () => {
  it('discovers runtime TypeScript recursively while excluding tests', async () => {
    const root = await createSharedFixture();
    const files = runtimeSourceFiles(path.join(root, 'src')).map(file => path.relative(root, file));

    assert.deepEqual(files.sort(), ['src/money.ts', 'src/nested/units.ts']);
  });

  it('requires every public runtime and declaration output', async () => {
    const root = await createSharedFixture();
    await rm(path.join(root, 'dist', 'unit-math.d.ts'));

    assert.equal(buildIsFresh(root), false);
  });

  it('invalidates outputs older than package metadata or runtime sources', async () => {
    const root = await createSharedFixture();
    const oldTime = new Date('2026-01-01T00:00:00.000Z');
    const newTime = new Date('2026-01-02T00:00:00.000Z');

    for (const name of entrypoints) {
      await utimes(path.join(root, 'dist', `${name}.js`), oldTime, oldTime);
      await utimes(path.join(root, 'dist', `${name}.d.ts`), oldTime, oldTime);
    }
    await utimes(path.join(root, 'src', 'money.ts'), newTime, newTime);

    assert.equal(buildIsFresh(root), false);
  });

  it('accepts a complete build newer than every runtime input', async () => {
    const root = await createSharedFixture();
    const oldTime = new Date('2026-01-01T00:00:00.000Z');
    const newTime = new Date('2026-01-02T00:00:00.000Z');

    for (const input of [
      path.join(root, 'package.json'),
      path.join(root, 'tsconfig.json'),
      ...runtimeSourceFiles(path.join(root, 'src')),
    ]) {
      await utimes(input, oldTime, oldTime);
    }
    for (const name of entrypoints) {
      await utimes(path.join(root, 'dist', `${name}.js`), newTime, newTime);
      await utimes(path.join(root, 'dist', `${name}.d.ts`), newTime, newTime);
    }

    assert.equal(buildIsFresh(root), true);
  });
});
