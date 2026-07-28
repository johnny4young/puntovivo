import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { test } from 'node:test';

const require = createRequire(import.meta.url);
const workspaceManifest = readFileSync(new URL('../pnpm-workspace.yaml', import.meta.url), 'utf8');
const lockfile = readFileSync(new URL('../pnpm-lock.yaml', import.meta.url), 'utf8');

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

test('native install resolves the maintained prebuild-install fork', () => {
  const packageJsonPath = require.resolve('prebuild-install/package.json');
  const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8'));
  const downloadSource = readFileSync(require.resolve('prebuild-install/download.js'), 'utf8');

  assert.equal(packageJson.version, '7.1.4-puntovivo.0');
  assert.equal(packageJson.private, true);
  assert.match(downloadSource, /fs\.constants\.R_OK \| fs\.constants\.W_OK/);
  assert.doesNotMatch(downloadSource, /fs\.R_OK \| fs\.W_OK/);
});

test('maintained prebuild proxy path is deprecation-free under Node 24', () => {
  const proxyPath = require.resolve('prebuild-install/proxy.js');
  const script = [
    "const assert = require('node:assert/strict');",
    `const applyProxy = require(${JSON.stringify(proxyPath)});`,
    'const cases = [',
    "  ['http://user:pass@127.0.0.1:8080', '127.0.0.1', 'user:pass'],",
    "  ['http://user@127.0.0.1:8080', '127.0.0.1', 'user'],",
    "  ['http://[::1]:8080', '::1', null],",
    "  ['http://u%40:p%3A@[::1]:8080', '::1', 'u@:p:'],",
    "  ['http://127.0.0.1:8080/path@route', '127.0.0.1', null]",
    '];',
    'for (const [proxy, host, proxyAuth] of cases) {',
    "  const request = applyProxy({ url: 'https://example.test/archive.tar.gz' },",
    '    { proxy, log: { http() {} } });',
    "  assert.ok(request.agent, 'proxy agent was not created');",
    '  assert.equal(request.agent.proxyOptions.host, host);',
    '  assert.equal(request.agent.proxyOptions.port, 8080);',
    '  assert.equal(request.agent.proxyOptions.proxyAuth, proxyAuth);',
    '}',
  ].join('\n');
  const result = spawnSync(process.execPath, ['--throw-deprecation', '-e', script], {
    encoding: 'utf8',
  });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.equal(result.stderr, '');
});
