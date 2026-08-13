import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import {
  classifyAuditAdvisories,
  createRuntimeReachabilityIndex,
  extractAuditAdvisories,
  formatRuntimePath,
} from './lib/runtime-dependency-reachability.mjs';

const dependency = (name, version, dependencies = {}, suffix = '') => ({
  from: name,
  version,
  path: `/store/${name.replaceAll('/', '+')}@${version}${suffix}`,
  dependencies,
});

const jsYaml = dependency('js-yaml', '4.3.1');
const provider = dependency('provider-runtime', '2.0.0', { 'js-yaml': jsYaml });
const roots = [
  {
    name: '@puntovivo/desktop',
    version: '1.10.1',
    path: '/workspace/apps/desktop',
    dependencies: {
      'electron-updater': dependency('electron-updater', '6.8.9', {
        'provider-runtime': { ...provider, dependencies: undefined, deduped: true },
      }),
    },
  },
  {
    name: '@puntovivo/server',
    version: '1.10.1',
    path: '/workspace/packages/server',
    dependencies: { 'provider-runtime': provider },
  },
  {
    name: '@puntovivo/web',
    version: '1.10.1',
    path: '/workspace/apps/web',
    dependencies: { react: dependency('react', '19.2.8') },
  },
];

const contract = {
  schemaVersion: 1,
  artifacts: [
    { id: 'desktop', root: '@puntovivo/desktop', delivery: 'electron' },
    { id: 'server', root: '@puntovivo/server', delivery: 'node' },
    { id: 'web', root: '@puntovivo/web', delivery: 'browser' },
  ],
  requiredPaths: [
    {
      artifact: 'desktop',
      chain: ['@puntovivo/desktop', 'electron-updater', 'provider-runtime', 'js-yaml'],
      reason: 'The updater fixture ships this parser path.',
    },
  ],
  forbiddenProductionPackages: [
    {
      artifact: 'desktop',
      package: '@electron-forge/cli',
      reason: 'The Forge fixture must remain development-only.',
    },
  ],
};

const auditReport = findings => ({
  advisories: {
    123: {
      id: 123,
      github_advisory_id: 'GHSA-test-test-test',
      module_name: 'js-yaml',
      severity: 'moderate',
      title: 'Unsafe feed parsing fixture',
      findings,
    },
  },
  metadata: { vulnerabilities: { moderate: findings.length } },
});

test('reconstructs a production path through a deduped node', () => {
  const index = createRuntimeReachabilityIndex({ roots, contract });
  const paths = index.packages.get('js-yaml');
  assert.ok(paths.some(path => path.artifact === 'desktop'));
  assert.match(
    formatRuntimePath(paths.find(path => path.artifact === 'desktop')),
    /desktop: @puntovivo\/desktop@1\.10\.1 > electron-updater@6\.8\.9 > provider-runtime@2\.0\.0 > js-yaml@4\.3\.1/
  );
});

test('classifies only the vulnerable installed version as runtime reachable', () => {
  const index = createRuntimeReachabilityIndex({ roots, contract });
  const [reachable] = classifyAuditAdvisories(
    extractAuditAdvisories(auditReport([{ version: '4.3.1', paths: [] }])),
    index
  );
  assert.equal(reachable.classification, 'runtime-reachable');
  assert.equal(reachable.runtimePaths.length, 2);

  const [safe] = classifyAuditAdvisories(
    extractAuditAdvisories(auditReport([{ version: '4.2.0', paths: [] }])),
    index
  );
  assert.equal(safe.classification, 'not-runtime-reachable');
  assert.equal(safe.runtimePaths.length, 0);
});

test('missing finding versions remain unknown rather than being called development-only', () => {
  const index = createRuntimeReachabilityIndex({ roots, contract });
  const [advisory] = classifyAuditAdvisories(extractAuditAdvisories(auditReport([])), index);
  assert.equal(advisory.classification, 'unknown');
});

test('fails when the packaged updater sentinel path disappears', () => {
  const changedRoots = structuredClone(roots);
  delete changedRoots[0].dependencies['electron-updater'];
  assert.throws(
    () => createRuntimeReachabilityIndex({ roots: changedRoots, contract }),
    /Required runtime path is absent/
  );
});

test('fails when development tooling enters a production artifact', () => {
  const changedRoots = structuredClone(roots);
  changedRoots[0].dependencies['@electron-forge/cli'] = dependency('@electron-forge/cli', '7.11.2');
  assert.throws(
    () => createRuntimeReachabilityIndex({ roots: changedRoots, contract }),
    /Development package @electron-forge\/cli is production-reachable/
  );
});

test('rejects unsupported audit JSON instead of guessing scope', () => {
  assert.throws(() => extractAuditAdvisories({ vulnerabilities: {} }), /unsupported JSON report/);
});

test('rejects advisories without a package identity instead of guessing scope', () => {
  const report = auditReport([{ version: '4.3.1', paths: [] }]);
  delete report.advisories[123].module_name;
  assert.throws(() => extractAuditAdvisories(report), /has no package name/);
});
