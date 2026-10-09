import { strict as assert } from 'node:assert';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';
import * as prettier from 'prettier';
import { test } from 'node:test';

const rootPackage = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
const serverPackage = JSON.parse(
  await readFile(new URL('../packages/server/package.json', import.meta.url), 'utf8')
);
const desktopPackage = JSON.parse(
  await readFile(new URL('../apps/desktop/package.json', import.meta.url), 'utf8')
);

test('server CI enforces the source-only Prettier contract', () => {
  assert.equal(serverPackage.scripts.format, 'prettier --check "src/**/*.ts"');
  assert.equal(serverPackage.scripts['format:fix'], 'prettier --write "src/**/*.ts"');
  assert.match(rootPackage.scripts['ci:server'], /@puntovivo\/server run format/u);
  assert.doesNotMatch(serverPackage.scripts.format, /migrations\/meta|pnpm-lock/u);
});

test('desktop CI enforces the source-only Prettier contract', () => {
  assert.equal(desktopPackage.scripts.format, 'prettier --check "src/**/*.{ts,tsx,js,jsx,json}"');
  assert.equal(
    desktopPackage.scripts['format:fix'],
    'prettier --write "src/**/*.{ts,tsx,js,jsx,json}"'
  );
  assert.match(rootPackage.scripts['ci:desktop'], /@puntovivo\/desktop run format/u);
  assert.doesNotMatch(desktopPackage.scripts.format, /pnpm-lock/u);
});

test('Git checkouts preserve the LF formatting contract even with autocrlf enabled', async () => {
  const attributes = await readFile(new URL('../.gitattributes', import.meta.url), 'utf8');
  const config = JSON.parse(await readFile(new URL('../.prettierrc', import.meta.url), 'utf8'));
  assert.equal(config.endOfLine, 'lf');
  const root = await mkdtemp(join(tmpdir(), 'puntovivo-format-checkout-'));
  const source = 'export const value = 1;\n';
  const binary = Buffer.from([0, 13, 10, 255, 1]);
  const git = (...args) => {
    const result = spawnSync(
      'git',
      [
        '-c',
        'core.autocrlf=true',
        '-c',
        'core.safecrlf=false',
        '-c',
        'core.attributesFile=' + join(root, 'no-global-attributes'),
        ...args,
      ],
      { cwd: root, encoding: 'utf8' }
    );
    assert.equal(result.status, 0, result.stderr);
  };
  try {
    git('init', '--initial-branch=main');
    await writeFile(join(root, 'sample.ts'), source);
    await writeFile(join(root, 'sample.bin'), binary);
    git('add', 'sample.ts', 'sample.bin');
    await mkdir(join(root, 'before'));
    git('checkout-index', '--all', '--prefix=' + join(root, 'before') + sep);
    const before = await readFile(join(root, 'before', 'sample.ts'), 'utf8');
    assert.match(before, /\r\n/u);
    assert.equal(await prettier.check(before, { ...config, parser: 'typescript' }), false);
    assert.deepEqual(await readFile(join(root, 'before', 'sample.bin')), binary);

    await writeFile(join(root, '.gitattributes'), attributes);
    git('add', '.gitattributes');
    await mkdir(join(root, 'after'));
    git('checkout-index', '--all', '--prefix=' + join(root, 'after') + sep);
    const after = await readFile(join(root, 'after', 'sample.ts'), 'utf8');
    assert.equal(after, source);
    assert.equal(await prettier.check(after, { ...config, parser: 'typescript' }), true);
    assert.deepEqual(await readFile(join(root, 'after', 'sample.bin')), binary);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
