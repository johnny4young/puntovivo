import { strict as assert } from 'node:assert';
import { readFile } from 'node:fs/promises';
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
