import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { generateCompanionServiceWorker } from './generate-companion-service-worker.mjs';

async function createBuild() {
  const root = await mkdtemp(join(tmpdir(), 'puntovivo-companion-sw-'));
  await mkdir(join(root, 'assets'));
  await mkdir(join(root, '.vite'));
  await Promise.all([
    writeFile(join(root, 'index.html'), '<html><head></head><body></body></html>'),
    writeFile(join(root, 'manifest.webmanifest'), '{}'),
    writeFile(join(root, 'companion-icon-192.png'), 'icon-192'),
    writeFile(join(root, 'companion-icon-512.png'), 'icon-512'),
    writeFile(join(root, 'assets', 'index-a1.js'), 'console.log(1)'),
    writeFile(join(root, 'assets', 'styles-b2.css'), 'body{}'),
    writeFile(join(root, 'assets', 'companion-c3.js'), 'export {}'),
    writeFile(join(root, 'assets', 'sales-heavy-d4.js'), 'export {}'),
    writeFile(join(root, 'assets', 'inter-latin-ext-400-normal-a.woff2'), 'latin'),
    writeFile(join(root, 'assets', 'inter-greek-400-normal-b.woff2'), 'greek'),
    writeFile(
      join(root, '.vite', 'manifest.json'),
      JSON.stringify({
        'index.html': {
          file: 'assets/index-a1.js',
          isEntry: true,
          css: ['assets/styles-b2.css'],
          assets: [
            'assets/inter-latin-ext-400-normal-a.woff2',
            'assets/inter-greek-400-normal-b.woff2',
          ],
          dynamicImports: [
            'src/features/surfaces/CompanionHome.tsx',
            'src/features/sales/SalesPage.tsx',
          ],
        },
        'src/features/surfaces/CompanionShell.tsx': {
          file: 'assets/companion-c3.js',
          src: 'src/features/surfaces/CompanionShell.tsx',
        },
        'src/features/surfaces/CompanionHome.tsx': {
          file: 'assets/companion-c3.js',
          src: 'src/features/surfaces/CompanionHome.tsx',
          imports: ['index.html'],
        },
        'src/features/sales/SalesPage.tsx': {
          file: 'assets/sales-heavy-d4.js',
          src: 'src/features/sales/SalesPage.tsx',
        },
      })
    ),
  ]);
  return root;
}

test('generates a content-versioned shell allowlist without runtime API caching', async () => {
  const root = await createBuild();
  const generated = await generateCompanionServiceWorker(root);
  const worker = await readFile(generated.outputPath, 'utf8');

  assert.match(generated.cacheName, /^puntovivo-companion-[0-9a-f]{16}$/);
  assert.deepEqual(generated.precachePaths, [
    '/assets/companion-c3.js',
    '/assets/index-a1.js',
    '/assets/inter-latin-ext-400-normal-a.woff2',
    '/assets/styles-b2.css',
    '/c/index.html',
    '/companion-icon-192.png',
    '/companion-icon-512.png',
    '/manifest.webmanifest',
  ]);
  assert.match(await readFile(join(root, 'c', 'index.html'), 'utf8'), /<base href="\/" \/>/);
  assert.match(worker, /caches\.match\('\/c\/index\.html'\)/);
  assert.match(worker, /url\.pathname\.startsWith\('\/api\/'\)/);
  assert.match(worker, /if \(PRECACHE_SET\.has\(url\.pathname\)\)/);
  assert.doesNotMatch(worker, /cache\.put/);
  assert.doesNotMatch(worker, /sales-heavy-d4/);
  assert.doesNotMatch(worker, /inter-greek/);
  assert.ok(generated.precacheBytes < 5 * 1024 * 1024);
});

test('changes the cache identity when a versioned asset changes', async () => {
  const root = await createBuild();
  const first = await generateCompanionServiceWorker(root);
  await writeFile(join(root, 'assets', 'index-a1.js'), 'console.log(2)');
  const second = await generateCompanionServiceWorker(root);
  assert.notEqual(first.cacheName, second.cacheName);
});

test('fails closed when a required shell asset is absent', async () => {
  const empty = await mkdtemp(join(tmpdir(), 'puntovivo-companion-sw-empty-'));
  await assert.rejects(generateCompanionServiceWorker(empty), /Companion PWA asset/);
});

test('fails closed when the selected shell exceeds the mobile precache budget', async () => {
  const root = await createBuild();
  await writeFile(join(root, 'assets', 'index-a1.js'), Buffer.alloc(5 * 1024 * 1024, 1));
  await assert.rejects(generateCompanionServiceWorker(root), /precache exceeds/);
});
