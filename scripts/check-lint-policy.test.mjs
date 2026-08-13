import { strict as assert } from 'node:assert';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const root = new URL('../', import.meta.url);
const rootPackage = JSON.parse(readFileSync(new URL('package.json', root), 'utf8'));
const oxlintConfig = JSON.parse(readFileSync(new URL('.oxlintrc.json', root), 'utf8'));
const parity = JSON.parse(readFileSync(new URL('config/oxlint-parity.json', root), 'utf8'));
const webEslint = readFileSync(new URL('apps/web/eslint.config.js', root), 'utf8');
const oxlintConfigPath = fileURLToPath(new URL('.oxlintrc.json', root));
const oxlintPackagePath = require.resolve('oxlint/package.json');
const oxlintBin = join(dirname(oxlintPackagePath), 'bin', 'oxlint');

const assertRejectedFixture = (directoryUrl, source, diagnostic) => {
  const fixtureDir = mkdtempSync(join(fileURLToPath(directoryUrl), '.oxlint-policy-'));
  const fixturePath = join(fixtureDir, 'fixture.ts');
  writeFileSync(fixturePath, source);

  try {
    const result = spawnSync(
      process.execPath,
      [oxlintBin, '--config', oxlintConfigPath, fixturePath],
      { encoding: 'utf8' }
    );
    assert.equal(result.status, 1);
    assert.match(`${result.stdout}\n${result.stderr}`, diagnostic);
  } finally {
    rmSync(fixtureDir, { recursive: true, force: true });
  }
};

const workspaces = {
  web: {
    fast: 'pnpm run lint:fast:web',
    authoritative: 'pnpm --filter @puntovivo/web run lint',
    command: 'oxlint apps/web/src',
  },
  server: {
    fast: 'pnpm run lint:fast:server',
    authoritative: 'pnpm --filter @puntovivo/server run lint',
    command: 'oxlint packages/server/src',
  },
  desktop: {
    fast: 'pnpm run lint:fast:desktop',
    authoritative: 'pnpm --filter @puntovivo/desktop run lint',
    command: 'oxlint apps/desktop/src',
  },
};

test('Oxlint fails fast before authoritative ESLint in every workspace gate', () => {
  assert.equal(rootPackage.devDependencies.oxlint, '^1.78.0');
  assert.equal(rootPackage.devDependencies['eslint-plugin-oxlint'], undefined);

  for (const [workspace, contract] of Object.entries(workspaces)) {
    assert.equal(rootPackage.scripts[`lint:fast:${workspace}`], contract.command);
    const ci = rootPackage.scripts[`ci:${workspace}`];
    assert.ok(ci.includes(contract.fast));
    assert.ok(ci.includes(contract.authoritative));
    assert.ok(ci.indexOf(contract.fast) < ci.indexOf(contract.authoritative));
  }
});

test('Oxlint covers the explicit safe subset without claiming type-aware parity', () => {
  assert.equal(parity.authority, 'eslint');
  assert.equal(parity.fastGate, 'oxlint');
  assert.equal(parity.typeAware, false);
  assert.deepEqual(parity.compiler, {
    package: '@typescript/native',
    version: '7.0.2',
  });
  assert.deepEqual(parity.toolingApi, {
    package: 'typescript',
    source: '@typescript/typescript6',
    version: '6.0.2',
  });
  assert.equal(oxlintConfig.options.typeAware, undefined);
  assert.equal(oxlintConfig.options.typeCheck, undefined);
  assert.deepEqual(oxlintConfig.plugins, ['typescript', 'react']);
  assert.equal(oxlintConfig.categories.correctness, 'error');
  assert.equal(oxlintConfig.rules['typescript/no-explicit-any'], 'error');
  assert.equal(oxlintConfig.rules['react/rules-of-hooks'], 'error');
  assert.equal(oxlintConfig.options.denyWarnings, true);

  const serverOverride = oxlintConfig.overrides.find(({ files }) =>
    files.includes('packages/server/src/**/*.ts')
  );
  const desktopOverride = oxlintConfig.overrides.find(({ files }) =>
    files.includes('apps/desktop/src/main/**/*.ts')
  );
  assert.equal(serverOverride.rules['no-console'], 'error');
  assert.deepEqual(serverOverride.rules['no-unused-vars'], [
    'error',
    { argsIgnorePattern: '^_|^err' },
  ]);
  assert.equal(desktopOverride.rules['no-console'], 'error');

  assertRejectedFixture(
    new URL('packages/server/src/', root),
    'console.log("unsafe");\n',
    /eslint\(no-console\)/
  );
  assertRejectedFixture(
    new URL('apps/desktop/src/main/', root),
    'console.log("unsafe");\n',
    /eslint\(no-console\)/
  );
});

test('ESLint-only custom and React Compiler policies remain explicitly recorded', () => {
  assert.match(webEslint, /'no-restricted-syntax'/);
  assert.match(webEslint, /\.\.\.reactHooks\.configs\.recommended\.rules/);
  assert.ok(
    parity.eslintOnlyContracts.some(({ capability }) => capability === 'custom-ast-selectors')
  );
  assert.ok(
    parity.eslintOnlyContracts.some(({ capability }) => capability === 'react-compiler-policy')
  );
  assert.ok(
    parity.eslintOnlyContracts.some(
      ({ capability }) => capability === 'typescript-7-programmatic-api'
    )
  );
});

test('the committed Oxlint configuration rejects an explicit any fixture', () => {
  const fixtureDir = mkdtempSync(join(tmpdir(), 'puntovivo-oxlint-policy-'));
  const fixturePath = join(fixtureDir, 'fixture.ts');
  writeFileSync(fixturePath, 'export const unsafe: any = 1;\n');

  try {
    const result = spawnSync(
      process.execPath,
      [oxlintBin, '--config', oxlintConfigPath, fixturePath],
      { encoding: 'utf8' }
    );
    assert.equal(result.status, 1);
    assert.match(`${result.stdout}\n${result.stderr}`, /typescript\(no-explicit-any\)/);
  } finally {
    rmSync(fixtureDir, { recursive: true, force: true });
  }
});
