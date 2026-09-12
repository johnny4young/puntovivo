import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import path from 'node:path';

import {
  EXACT_VERSION,
  parseWorkspacePackageExtensionSelectors,
} from './lib/workspace-manifest.mjs';

const require = createRequire(import.meta.url);
const workspaceManifest = readFileSync(new URL('../pnpm-workspace.yaml', import.meta.url), 'utf8');
const lockfile = readFileSync(new URL('../pnpm-lock.yaml', import.meta.url), 'utf8');
const dataTableSource = readFileSync(
  new URL('../apps/web/src/components/tables/DataTable.tsx', import.meta.url),
  'utf8'
);
const readJson = url => JSON.parse(readFileSync(url, 'utf8'));

test('dependency policy replaces deprecations instead of suppressing warnings', () => {
  assert.doesNotMatch(workspaceManifest, /^allowedDeprecatedVersions:/m);
  assert.doesNotMatch(lockfile, /^\s+deprecated:/m);
  assert.match(workspaceManifest, /^\s+'app-builder-lib>plist': '3\.1\.1'$/m);
  // The version moves whenever upstream patches xmldom, so assert the
  // invariant instead of the literal: an exact pin must exist, and the
  // same-day-release waiver must name the very version that pin selects.
  // A stale waiver silently drops the age exemption for the pin in force.
  const xmldomPin = workspaceManifest.match(/^\s+'plist>@xmldom\/xmldom': '([\d.]+)'$/m);
  assert.ok(xmldomPin, 'expected an exact plist>@xmldom/xmldom override');
  assert.match(
    workspaceManifest,
    new RegExp(`^\\s+- '@xmldom/xmldom@${xmldomPin[1].replaceAll('.', '\\.')}'$`, 'm')
  );
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

test('both accessibility gates run the same axe rule engine', () => {
  // The web unit suites load axe-core directly; the browser sweep loads it
  // through the axe-core bundled inside @axe-core/playwright. Both gates share
  // one acceptance criterion, so they must resolve the same engine version:
  // a newer root axe-core alone would let a violation caught at unit level go
  // unseen by the sweep that exercises the real DOM. This invariant used to
  // live only as prose in private planning and silently broke when a
  // dependency group bumped root axe-core without its Playwright wrapper.
  // Resolve from the web workspace, because that is the package whose unit
  // suites actually load the engine — the root copy is only the type source
  // for the E2E helper and could diverge from apps/web without being what
  // runs. The wrapper's exports map does not expose ./package.json, so the
  // nested require is anchored at its exported entry instead; resolution then
  // walks up from the wrapper's own directory, exactly as its runtime import
  // would.
  const webRequire = createRequire(new URL('../apps/web/package.json', import.meta.url));
  const webAxe = webRequire('axe-core/package.json');
  const rootAxe = require('axe-core/package.json');
  const wrapperRequire = createRequire(require.resolve('@axe-core/playwright'));
  const wrapperAxe = wrapperRequire('axe-core/package.json');

  assert.equal(
    wrapperAxe.version,
    webAxe.version,
    `@axe-core/playwright bundles axe-core ${wrapperAxe.version} but the web unit suites run ${webAxe.version}; upgrade both together`
  );
  // The root copy supplies the E2E helper's result types; keep it on the same
  // engine so the sweep's types and runtime never split again.
  assert.equal(
    rootAxe.version,
    webAxe.version,
    `root axe-core ${rootAxe.version} diverges from the web workspace ${webAxe.version}`
  );
});

test('Sentry Node receives its undeclared OpenTelemetry peer explicitly', () => {
  const sentryRequire = createRequire(require.resolve('@sentry/node/package.json'));
  const corePackage = sentryRequire('@opentelemetry/core/package.json');

  assert.equal(corePackage.version, '2.10.0');
  assert.match(workspaceManifest, /^\s+'@sentry\/node@10\.71\.0':$/m);
  assert.match(workspaceManifest, /^\s+'@opentelemetry\/core': '2\.10\.0'$/m);
});

// A selector that pins a version stops applying, silently, as soon as that
// package moves: electron-builder 26.16.1 with the old app-builder-lib@26.15.3
// selector dropped the optional electron-builder-squirrel-windows peer meta
// behind a generic peer warning. A versionless selector applies to every
// version and cannot go stale, and a pinned one must name a version the lockfile
// resolves. Lockfile keys are exact, so a range cannot be checked against them
// and is rejected with a message that says so rather than a misleading one.
function assertExtensionSelectorApplies(selector) {
  const [, name, version] = selector.match(/^((?:@[^/@\s]+\/)?[^@\s]+)(?:@(.+))?$/u) ?? [];
  assert.ok(name, `${selector} is not a package selector`);
  if (version === undefined) return;
  assert.match(
    version,
    EXACT_VERSION,
    `${selector} names a version range; pin one exact version or drop the version`
  );
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  assert.match(
    lockfile,
    new RegExp(`^ {2}'?${escaped}'?:$`, 'm'),
    `${selector} is not a resolved package, so its extension no longer applies`
  );
}

test('the packageExtensions reader fails loudly on any spelling it cannot check', () => {
  // A selector the reader skipped would silently stop being checked, so every
  // spelling pnpm accepts must parse and every other shape must throw.
  assert.deepEqual(
    parseWorkspacePackageExtensionSelectors(
      [
        'packageExtensions:',
        "  'a@1.0.0':",
        '    dependencies:',
        '# a column-0 comment inside the block',
        '  "b@2.0.0": # a trailing comment',
        '    dependencies:',
        '  c@3.0.0:  ',
        '    dependencies:',
        'overrides:',
        '  d@4.0.0: 4.0.1',
      ].join('\r\n')
    ),
    ['a@1.0.0', 'b@2.0.0', 'c@3.0.0']
  );
  for (const entry of [
    "  'a@1.0.0': { dependencies: { b: 1.0.0 } }",
    "  'a@1.0.0': inline",
    '   a@1.0.0:',
  ]) {
    assert.throws(
      () => parseWorkspacePackageExtensionSelectors(`packageExtensions:\n${entry}\n`),
      /Unsupported packageExtensions syntax/,
      entry
    );
  }
  assert.throws(
    () => parseWorkspacePackageExtensionSelectors("packageExtensions:\n  'a@1.0.0':\n  a@1.0.0:\n"),
    /Duplicate packageExtensions selector a@1\.0\.0/
  );
});

test('every package extension selector keeps applying to the installed package', () => {
  assert.doesNotThrow(() => assertExtensionSelectorApplies('app-builder-lib'));
  assert.doesNotThrow(() => assertExtensionSelectorApplies('@sentry/node'));
  for (const range of ['app-builder-lib@26.x', 'app-builder-lib@^26.16.1', '@sentry/node@>=10']) {
    assert.throws(() => assertExtensionSelectorApplies(range), /names a version range/, range);
  }
  assert.throws(
    () => assertExtensionSelectorApplies('@puntovivo/never-installed@1.0.0'),
    /is not a resolved package/
  );
  const selectors = parseWorkspacePackageExtensionSelectors(workspaceManifest);
  assert.ok(selectors.length > 0, 'expected packageExtensions selectors');
  for (const selector of selectors) assertExtensionSelectorApplies(selector);
});

test('electron-builder unlocks its signing keychain with the keychain password', () => {
  // electron-builder 26.15.3 through 26.16.0 passed the p12 import password to
  // security set-key-partition-list for the throwaway keychain it creates with a
  // random password. The macOS 26.6 runner image rejects that, which failed the
  // signed mac release job of v1.14.0 and again of v1.14.1. Only a signed release
  // reaches this call, so pin the behavior here, where a bump that regresses it
  // fails CI instead of the next release.
  const macCodeSign = readFileSync(
    path.join(
      path.dirname(require.resolve('app-builder-lib/package.json')),
      'out/codeSign/macCodeSign.js'
    ),
    'utf8'
  );
  const calls = macCodeSign.match(/\[\s*["']set-key-partition-list["'][^\]]*\]/g) ?? [];
  assert.ok(calls.length > 0, 'expected app-builder-lib to call security set-key-partition-list');
  for (const call of calls) {
    assert.match(call, /["']-k["'],\s*keychainPassword,/, call);
  }
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

  assert.equal(packageJson.version, '3.14.10');
  assert.doesNotMatch(workspaceManifest, /^\s+'@tanstack\/react-virtual': '3\.14\.8'$/m);
  assert.match(dataTableSource, /useFlushSync:\s*false/);
});

test('TypeScript 7 compiler stays isolated from the TypeScript 6 tooling API', () => {
  const manifests = [
    new URL('../package.json', import.meta.url),
    new URL('../apps/web/package.json', import.meta.url),
    new URL('../packages/server/package.json', import.meta.url),
    new URL('../apps/desktop/package.json', import.meta.url),
  ].map(readJson);
  for (const manifest of manifests) {
    assert.equal(manifest.devDependencies['@typescript/native'], 'npm:typescript@^7.0.2');
    assert.equal(manifest.devDependencies.typescript, 'npm:@typescript/typescript6@^6.0.2');
  }

  const nativePackagePath = require.resolve('@typescript/native/package.json');
  const nativePackage = readJson(nativePackagePath);
  const compatibilityPackage = require('typescript/package.json');
  const typescriptEslintPackage = require('typescript-eslint/package.json');
  const compiler = path.join(path.dirname(nativePackagePath), nativePackage.bin.tsc);
  const version = spawnSync(process.execPath, [compiler, '--version'], { encoding: 'utf8' });

  assert.equal(nativePackage.name, 'typescript');
  assert.equal(nativePackage.version, '7.0.2');
  assert.equal(version.status, 0, version.stderr);
  assert.match(version.stdout, /^Version 7\.0\.2\s*$/);
  assert.equal(compatibilityPackage.name, '@typescript/typescript6');
  assert.equal(compatibilityPackage.version, '6.0.2');
  assert.equal(typescriptEslintPackage.version, '8.68.0');
  assert.equal(typescriptEslintPackage.peerDependencies.typescript, '>=4.8.4 <6.1.0');
});
