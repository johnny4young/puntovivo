import { mkdtemp, mkdir, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanPaths, resolveCleanTargets } from './clean-paths.mjs';

async function exists(path) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

test('cleanPaths removes direct paths and one-segment workspace globs', async () => {
  const root = await mkdtemp(join(tmpdir(), 'puntovivo-clean-paths-'));
  await mkdir(join(root, 'apps', 'web', 'node_modules'), { recursive: true });
  await mkdir(join(root, 'apps', 'desktop', 'node_modules'), { recursive: true });
  await mkdir(join(root, 'packages', 'server', 'node_modules'), { recursive: true });
  await mkdir(join(root, 'apps', 'web', 'dist'), { recursive: true });
  await writeFile(join(root, 'apps', 'web', 'dist', 'index.html'), '<!doctype html>');

  const targets = await cleanPaths(
    ['apps/*/node_modules', 'packages/*/node_modules'],
    root
  );

  assert.equal(targets.length, 3);
  assert.equal(await exists(join(root, 'apps', 'web', 'node_modules')), false);
  assert.equal(await exists(join(root, 'apps', 'desktop', 'node_modules')), false);
  assert.equal(await exists(join(root, 'packages', 'server', 'node_modules')), false);
  assert.equal(await exists(join(root, 'apps', 'web', 'dist', 'index.html')), true);
});

test('resolveCleanTargets refuses unsafe deletes', async () => {
  const root = await mkdtemp(join(tmpdir(), 'puntovivo-clean-paths-'));

  await assert.rejects(() => resolveCleanTargets(['.'], root), /unsafe path/);
  await assert.rejects(() => resolveCleanTargets(['..'], root), /outside/);
  await assert.rejects(
    () => resolveCleanTargets(['apps/*modules'], root),
    /Unsupported clean glob/
  );
});
