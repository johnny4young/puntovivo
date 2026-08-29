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
import { EventEmitter } from 'node:events';
import { basename, sep } from 'node:path';
import {
  assertPortAvailable,
  buildCheckArgs,
  buildEnsureBrowserArgs,
  buildGateEnv,
  buildPreviewArgs,
  buildProductionWebEnv,
  buildSeedArgs,
  buildServerArgs,
  buildWebArgs,
  childFailureReason,
  DEFAULT_API_HOST,
  DEFAULT_API_PORT,
  DEFAULT_CDP_PORT,
  DEFAULT_SETTLE_MS,
  DEFAULT_WEB_HOST,
  DEFAULT_WEB_PORT,
  LIGHTHOUSE_OWNER_PATH,
  resolveRunLighthouseGateOptions,
  spawnOwnedService,
  waitForChildResult,
  waitForOwnedBundle,
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
  assert.equal(options.settleMs, DEFAULT_SETTLE_MS);
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
      '--settle-ms=0',
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
  assert.equal(options.settleMs, 0);
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
    buildEnsureBrowserArgs().map(arg => basename(arg)),
    ['ensure-playwright-browser.mjs']
  );
  assert.deepEqual(buildSeedArgs(), ['run', 'seed:dev']);
  assert.deepEqual(buildWebArgs('/tmp/lighthouse-web'), [
    '--filter',
    '@puntovivo/web',
    'exec',
    'vite',
    'build',
    '--outDir',
    '/tmp/lighthouse-web',
    '--emptyOutDir',
  ]);
  const serverArgs = buildServerArgs();
  assert.deepEqual(serverArgs[0].split(sep).slice(-3), ['tsx', 'dist', 'cli.mjs']);
  assert.deepEqual(serverArgs[1].split(sep).slice(-4), [
    'packages',
    'server',
    'src',
    'standalone.ts',
  ]);
  assert.deepEqual(buildPreviewArgs({ webHost: 'localhost', webPort: 4567 }, '/tmp/web'), [
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
    '--outDir',
    '/tmp/web',
  ]);
  const checkArgs = buildCheckArgs(['--strict']);
  assert.equal(basename(checkArgs[0]), 'check-lighthouse.mjs');
  assert.deepEqual(checkArgs.slice(1), ['--strict']);
});

test('buildGateEnv owns DB, browser cache, ports, and Lighthouse target', () => {
  const options = resolveRunLighthouseGateOptions({
    argv: ['--web-port=4555', '--api-port=8999'],
    env: {},
  });
  const env = buildGateEnv(
    {
      DATABASE_URL: '/should/not/leak.db',
      NODE_ENV: 'production',
      PUNTOVIVO_RUNTIME_ENV: 'staging',
      PUNTOVIVO_DB_KEY: 'ambient-key',
    },
    options,
    '/tmp/lighthouse.db',
    '/repo/.playwright-browsers'
  );
  assert.equal(env.DATABASE_URL, '/tmp/lighthouse.db');
  assert.equal(env.NODE_ENV, 'test');
  assert.equal(env.PUNTOVIVO_RUNTIME_ENV, 'test');
  assert.equal(env.PLAYWRIGHT_BROWSERS_PATH, '/repo/.playwright-browsers');
  assert.equal(env.PUNTOVIVO_BIND_PORT, '8999');
  assert.equal(env.PUNTOVIVO_LIGHTHOUSE_BASE_URL, 'http://localhost:4555');
  assert.equal(env.PUNTOVIVO_LIGHTHOUSE_CDP_PORT, String(DEFAULT_CDP_PORT));
  assert.equal(env.VITE_API_URL, 'http://localhost:8999');
  assert.equal(env.PUNTOVIVO_LOG_LEVEL, 'warn');
  assert.equal(env.PUNTOVIVO_SUPPRESS_CREDENTIAL_BANNER, 'true');
  assert.equal(env.PUNTOVIVO_DB_KEY, undefined);
});

test('buildProductionWebEnv isolates production mode from the seed runtime', () => {
  const gateEnv = { NODE_ENV: 'development', VITE_API_URL: 'http://localhost:8999' };

  const buildEnv = buildProductionWebEnv(gateEnv);

  assert.equal(buildEnv.NODE_ENV, 'production');
  assert.equal(buildEnv.VITE_API_URL, gateEnv.VITE_API_URL);
  assert.equal(gateEnv.NODE_ENV, 'development');
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

test('waitForUrl does not treat a foreign non-success response as ready', async () => {
  let attempts = 0;
  await waitForUrl('http://example.test', {
    timeoutMs: 1000,
    intervalMs: 1,
    fetchImpl: async () => {
      attempts += 1;
      return attempts < 3 ? { ok: false, status: 404 } : { ok: true, status: 200 };
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

test('port revalidation rejects a listener that appeared during settle', async () => {
  let occupied = false;
  const createServerImpl = () => {
    const probe = new EventEmitter();
    probe.listen = (_options, onListening) => {
      queueMicrotask(() => {
        if (occupied) {
          const error = new Error('late listener');
          error.code = 'EADDRINUSE';
          probe.emit('error', error);
        } else {
          onListening();
        }
      });
    };
    probe.close = onClose => queueMicrotask(() => onClose());
    return probe;
  };
  const port = 5173;
  await assert.doesNotReject(assertPortAvailable('127.0.0.1', port, { createServerImpl }));

  occupied = true;
  let spawnCalls = 0;

  await assert.rejects(
    spawnOwnedService('fixture', [], {
      host: '127.0.0.1',
      port,
      assertPortAvailableImpl: (host, targetPort) =>
        assertPortAvailable(host, targetPort, { createServerImpl }),
      spawnLongRunningImpl: () => {
        spawnCalls += 1;
      },
    }),
    new RegExp(`Required port 127\\.0\\.0\\.1:${port} is unavailable`)
  );
  assert.equal(spawnCalls, 0);
});

test('bundle ownership rejects a healthy foreign listener', async () => {
  await assert.rejects(
    waitForOwnedBundle('http://foreign-listener.test', 'expected-owner', {
      timeoutMs: 20,
      intervalMs: 1,
      fetchImpl: async () => ({
        ok: true,
        async text() {
          return '<!doctype html><title>another app</title>';
        },
      }),
    }),
    /bundle nonce mismatch/
  );
});

test('bundle ownership retries an incorrect nonce and requires the exact value', async () => {
  let attempts = 0;
  await waitForOwnedBundle('http://example.test', 'owned-bundle', {
    timeoutMs: 1000,
    intervalMs: 1,
    fetchImpl: async url => {
      attempts += 1;
      assert.equal(url.pathname, LIGHTHOUSE_OWNER_PATH);
      return {
        ok: true,
        async text() {
          return attempts < 3 ? 'wrong-bundle' : 'owned-bundle';
        },
      };
    },
  });
  assert.equal(attempts, 3);
});

test('bundle ownership bounds a listener that never completes its response', async () => {
  await assert.rejects(
    waitForOwnedBundle('http://stalled-listener.test', 'owned-bundle', {
      timeoutMs: 10,
      intervalMs: 1,
      fetchImpl: async (_url, { signal }) =>
        await new Promise((_resolvePromise, rejectPromise) => {
          signal.addEventListener('abort', () => rejectPromise(new Error('request aborted')), {
            once: true,
          });
        }),
    }),
    /Timed out waiting for owned Lighthouse bundle/
  );
});

test('a dead owned service aborts the running Lighthouse child', async () => {
  const service = Object.assign(new EventEmitter(), {
    exitCode: null,
    signalCode: null,
  });
  const lighthouse = Object.assign(new EventEmitter(), {
    pid: 4242,
    exitCode: null,
    signalCode: null,
  });
  let stopCalls = 0;
  const resultPromise = waitForChildResult(lighthouse, {
    command: 'Lighthouse fixture',
    pollIntervalMs: 1,
    shouldAbort: () => childFailureReason('API server', service),
    stopChildImpl: async child => {
      stopCalls += 1;
      child.signalCode = 'SIGTERM';
      child.emit('exit', null, 'SIGTERM');
    },
    logger: { error() {} },
  });

  service.exitCode = 1;
  service.emit('exit', 1, null);

  assert.equal(await resultPromise, 1);
  assert.equal(stopCalls, 1);
});

test('service death wins even when Lighthouse reports success in the same turn', async () => {
  const service = Object.assign(new EventEmitter(), {
    exitCode: null,
    signalCode: null,
  });
  const lighthouse = Object.assign(new EventEmitter(), {
    pid: 4343,
    exitCode: null,
    signalCode: null,
  });
  const resultPromise = waitForChildResult(lighthouse, {
    command: 'Lighthouse fixture',
    pollIntervalMs: 1,
    shouldAbort: () => childFailureReason('web preview', service),
    stopChildImpl: async () => {},
    logger: { error() {} },
  });

  service.exitCode = 1;
  service.emit('exit', 1, null);
  lighthouse.exitCode = 0;
  lighthouse.emit('exit', 0, null);

  assert.equal(await resultPromise, 1);
});
