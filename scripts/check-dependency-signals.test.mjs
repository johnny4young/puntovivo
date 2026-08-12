import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import path from 'node:path';

const require = createRequire(import.meta.url);
const workspaceManifest = readFileSync(new URL('../pnpm-workspace.yaml', import.meta.url), 'utf8');
const lockfile = readFileSync(new URL('../pnpm-lock.yaml', import.meta.url), 'utf8');
const dataTableSource = readFileSync(
  new URL('../apps/web/src/components/tables/DataTable.tsx', import.meta.url),
  'utf8'
);

test('dependency policy replaces deprecations instead of suppressing warnings', () => {
  assert.doesNotMatch(workspaceManifest, /^allowedDeprecatedVersions:/m);
  assert.doesNotMatch(lockfile, /^\s+deprecated:/m);
});

test('global-agent receives the maintained boolean compatibility contract', () => {
  const packageJsonPath = require.resolve('boolean/package.json');
  const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8'));
  const { boolean, isBooleanable } = require('boolean');

  assert.equal(packageJson.version, '3.2.1-puntovivo.0');
  assert.match(workspaceManifest, /^\s+boolean: 'file:packages\/boolean-compat'$/m);
  assert.equal(boolean('false'), false);
  assert.equal(boolean('yes'), true);
  assert.equal(isBooleanable('off'), true);
  assert.equal(isBooleanable('maybe'), false);
});

test('deprecated lodash.isequal consumers receive a maintained equivalent call shape', () => {
  const isEqual = require('lodash.isequal');
  assert.equal(typeof isEqual, 'function');
  assert.equal(isEqual({ files: ['update.zip'] }, { files: ['update.zip'] }), true);
  assert.equal(isEqual(['sku', 'price'], ['sku', 'stock']), false);
});

test('drizzle legacy loader alias receives the audited esbuild floor', () => {
  const loaderRequire = createRequire(require.resolve('@esbuild-kit/esm-loader/package.json'));
  const esbuildPackage = loaderRequire('esbuild/package.json');

  assert.equal(esbuildPackage.version, '0.28.1');
  assert.doesNotMatch(lockfile, /^\s{2}esbuild@0\.27\.\d+:$/m);
});

test('Sentry Node receives its undeclared OpenTelemetry peer explicitly', () => {
  const sentryRequire = createRequire(require.resolve('@sentry/node/package.json'));
  const corePackage = sentryRequire('@opentelemetry/core/package.json');

  assert.equal(corePackage.version, '2.9.0');
  assert.match(workspaceManifest, /^\s+'@sentry\/node@10\.66\.0':$/m);
  assert.match(workspaceManifest, /^\s+'@opentelemetry\/core': '2\.9\.0'$/m);
});

test('native install uses the bundled Node-API SQLite contract', () => {
  const packageJsonPath = require.resolve('better-sqlite3/package.json');
  const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8'));
  const packageDir = path.dirname(packageJsonPath);

  assert.equal(packageJson.name, 'better-sqlite3-multiple-ciphers');
  assert.equal(packageJson.version, '13.0.3');
  assert.equal(packageJson.gypfile, false);
  assert.equal(packageJson.dependencies['node-addon-api'], '^8.0.0');
  assert.equal(packageJson.dependencies['prebuild-install'], undefined);
  assert.doesNotMatch(workspaceManifest, /^\s+prebuild-install:/m);
  assert.match(workspaceManifest, /^\s+better-sqlite3-multiple-ciphers: false$/m);
  for (const target of [
    'darwin-arm64',
    'darwin-x64',
    'linux-arm64',
    'linux-x64',
    'linuxmusl-arm64',
    'linuxmusl-x64',
    'win32-arm64',
    'win32-x64',
  ]) {
    assert.ok(readFileSync(path.join(packageDir, 'prebuilds', `${target}.node`)).byteLength > 0);
  }
});

test('React 19 virtualizer batches lifecycle updates without flushSync', () => {
  const packageJson = require('@tanstack/react-virtual/package.json');

  assert.equal(packageJson.version, '3.14.9');
  assert.doesNotMatch(workspaceManifest, /^\s+'@tanstack\/react-virtual': '3\.14\.8'$/m);
  assert.match(dataTableSource, /useFlushSync:\s*false/);
});
