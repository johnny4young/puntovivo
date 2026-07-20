#!/usr/bin/env node
/**
 * pure tests for the Lighthouse CI gate runner.
 *
 * The live browser/server path is covered by `ci:web`; these tests pin the
 * portable runner's argument/env handling and readiness helper without starting
 * Vite, Fastify, or Lighthouse.
 *
 * @module scripts/run-lighthouse-gate.test
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildCheckArgs,
  buildEnsureBrowserArgs,
  buildGateEnv,
  buildPreviewArgs,
  buildSeedArgs,
  buildServerArgs,
  DEFAULT_API_HOST,
  DEFAULT_API_PORT,
  DEFAULT_CDP_PORT,
  DEFAULT_WEB_HOST,
  DEFAULT_WEB_PORT,
  resolveRunLighthouseGateOptions,
  waitForUrl,
} from './run-lighthouse-gate.mjs';

test('resolveRunLighthouseGateOptions uses safe defaults and passes check flags through', () => {
  const options = resolveRunLighthouseGateOptions({
    argv: ['--strict', '--require-measurement'],
    env: {},
  });
  assert.equal(options.webHost, DEFAULT_WEB_HOST);
  assert.equal(options.webPort, DEFAULT_WEB_PORT);
  assert.equal(options.apiHost, DEFAULT_API_HOST);
  assert.equal(options.apiPort, DEFAULT_API_PORT);
  assert.equal(options.cdpPort, DEFAULT_CDP_PORT);
  assert.equal(options.previewUrl, `http://${DEFAULT_WEB_HOST}:${DEFAULT_WEB_PORT}`);
  assert.equal(options.apiUrl, `http://${DEFAULT_API_HOST}:${DEFAULT_API_PORT}`);
  assert.deepEqual(options.passThroughArgs, ['--strict', '--require-measurement']);
});

test('resolveRunLighthouseGateOptions accepts runner flags without forwarding them', () => {
  const options = resolveRunLighthouseGateOptions({
    argv: [
      '--web-host=0.0.0.0',
      '--web-port',
      '4321',
      '--api-host=127.0.0.1',
      '--api-port',
      '9999',
      '--cdp-port=9444',
      '--ready-timeout-ms',
      '1234',
      '--skip-seed',
      '--skip-server',
      '--skip-preview',
      '--strict',
    ],
    env: {},
  });
  assert.equal(options.webHost, '0.0.0.0');
  assert.equal(options.webPort, 4321);
  assert.equal(options.apiHost, '127.0.0.1');
  assert.equal(options.apiPort, 9999);
  assert.equal(options.cdpPort, 9444);
  assert.equal(options.readyTimeoutMs, 1234);
  assert.equal(options.skipSeed, true);
  assert.equal(options.skipServer, true);
  assert.equal(options.skipPreview, true);
  assert.deepEqual(options.passThroughArgs, ['--strict']);
});

test('resolveRunLighthouseGateOptions lets base URL select a skip-preview target', () => {
  const options = resolveRunLighthouseGateOptions({
    argv: ['--skip-preview'],
    env: { PUNTOVIVO_LIGHTHOUSE_BASE_URL: 'http://localhost:3000' },
  });
  assert.equal(options.previewUrl, 'http://localhost:3000');
});

test('build command helpers point at the expected workspace commands', () => {
  assert.deepEqual(
    buildEnsureBrowserArgs().map(arg => arg.replace(/.*scripts\//, 'scripts/')),
    ['scripts/ensure-playwright-browser.mjs']
  );
  assert.deepEqual(buildSeedArgs(), ['run', 'seed:dev']);
  assert.deepEqual(buildServerArgs(), ['--filter', '@puntovivo/server', 'run', 'dev']);
  assert.deepEqual(buildPreviewArgs({ webHost: 'localhost', webPort: 4567 }), [
    '--filter',
    '@puntovivo/web',
    'exec',
    'vite',
    'preview',
    '--host',
    'localhost',
    '--port',
    '4567',
    '--strictPort',
  ]);
  const checkArgs = buildCheckArgs(['--strict']);
  assert.match(checkArgs[0], /scripts\/check-lighthouse\.mjs$/);
  assert.deepEqual(checkArgs.slice(1), ['--strict']);
});

test('buildGateEnv owns DB, browser cache, ports, and Lighthouse target', () => {
  const options = resolveRunLighthouseGateOptions({
    argv: ['--web-port=4555', '--api-port=8999'],
    env: {},
  });
  const env = buildGateEnv(
    { DATABASE_URL: '/should/not/leak.db', PUNTOVIVO_DB_KEY: 'ambient-key' },
    options,
    '/tmp/lighthouse.db',
    '/repo/.playwright-browsers'
  );
  assert.equal(env.DATABASE_URL, '/tmp/lighthouse.db');
  assert.equal(env.PLAYWRIGHT_BROWSERS_PATH, '/repo/.playwright-browsers');
  assert.equal(env.PUNTOVIVO_BIND_PORT, '8999');
  assert.equal(env.PUNTOVIVO_LIGHTHOUSE_BASE_URL, 'http://localhost:4555');
  assert.equal(env.PUNTOVIVO_LIGHTHOUSE_CDP_PORT, String(DEFAULT_CDP_PORT));
  assert.equal(env.PUNTOVIVO_DB_KEY, undefined);
});

test('buildGateEnv honors explicit Lighthouse DB overrides', () => {
  const options = resolveRunLighthouseGateOptions({ argv: [], env: {} });
  const env = buildGateEnv(
    { PUNTOVIVO_LIGHTHOUSE_DATABASE_URL: '/custom.db', PUNTOVIVO_LIGHTHOUSE_DB_KEY: 'abc123' },
    options,
    '/tmp/lighthouse.db',
    '/repo/.playwright-browsers'
  );
  assert.equal(env.DATABASE_URL, '/custom.db');
  assert.equal(env.PUNTOVIVO_DB_KEY, 'abc123');
});

test('waitForUrl retries until a response is available', async () => {
  let attempts = 0;
  await waitForUrl('http://example.test', {
    timeoutMs: 1000,
    intervalMs: 1,
    fetchImpl: async () => {
      attempts += 1;
      if (attempts < 3) {
        throw new Error('not ready');
      }
      return { ok: true };
    },
  });
  assert.equal(attempts, 3);
});

test('waitForUrl fails early when the caller aborts readiness', async () => {
  await assert.rejects(
    waitForUrl('http://example.test', {
      timeoutMs: 1000,
      intervalMs: 1,
      fetchImpl: async () => {
        throw new Error('not ready');
      },
      shouldAbort: () => 'preview exited',
    }),
    /preview exited/
  );
});
