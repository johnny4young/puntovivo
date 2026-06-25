#!/usr/bin/env node
/**
 * ENG-133d — pure tests for the Electron memory gate runner.
 *
 * The real launch is covered by `ci:desktop`; these tests pin argument/env
 * handling and the retry helper without starting Vite or Electron.
 *
 * @module scripts/run-electron-memory-gate.test
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildCheckArgs,
  buildCheckEnv,
  buildPreviewArgs,
  DEFAULT_PREVIEW_HOST,
  DEFAULT_PREVIEW_PORT,
  resolveRunElectronMemoryGateOptions,
  waitForUrl,
} from './run-electron-memory-gate.mjs';

test('resolveRunElectronMemoryGateOptions uses safe defaults and passes strict flags through', () => {
  const options = resolveRunElectronMemoryGateOptions({
    argv: ['--strict', '--require-measurement'],
    env: {},
  });
  assert.equal(options.host, DEFAULT_PREVIEW_HOST);
  assert.equal(options.port, DEFAULT_PREVIEW_PORT);
  assert.equal(options.previewUrl, `http://${DEFAULT_PREVIEW_HOST}:${DEFAULT_PREVIEW_PORT}`);
  assert.deepEqual(options.passThroughArgs, ['--strict', '--require-measurement']);
});

test('resolveRunElectronMemoryGateOptions accepts runner flags without forwarding them', () => {
  const options = resolveRunElectronMemoryGateOptions({
    argv: ['--host=0.0.0.0', '--port', '4321', '--ready-timeout-ms=1234', '--skip-preview', '--strict'],
    env: {},
  });
  assert.equal(options.host, '0.0.0.0');
  assert.equal(options.port, 4321);
  assert.equal(options.readyTimeoutMs, 1234);
  assert.equal(options.previewUrl, 'http://0.0.0.0:4321');
  assert.equal(options.skipPreview, true);
  assert.deepEqual(options.passThroughArgs, ['--strict']);
});

test('resolveRunElectronMemoryGateOptions ignores ambient WEB_DEV_SERVER_URL when it owns preview startup', () => {
  const options = resolveRunElectronMemoryGateOptions({
    argv: ['--port=5000'],
    env: { WEB_DEV_SERVER_URL: 'http://localhost:3000' },
  });
  assert.equal(options.port, 5000);
  assert.equal(options.previewUrl, 'http://127.0.0.1:5000');
});

test('resolveRunElectronMemoryGateOptions lets WEB_DEV_SERVER_URL select a skip-preview target', () => {
  const options = resolveRunElectronMemoryGateOptions({
    argv: ['--skip-preview'],
    env: { WEB_DEV_SERVER_URL: 'http://localhost:3000' },
  });
  assert.equal(options.skipPreview, true);
  assert.equal(options.previewUrl, 'http://localhost:3000');
});

test('buildPreviewArgs starts Vite preview on a strict port', () => {
  assert.deepEqual(buildPreviewArgs({ host: '127.0.0.1', port: 4444 }), [
    '--filter',
    '@puntovivo/web',
    'exec',
    'vite',
    'preview',
    '--host',
    '127.0.0.1',
    '--port',
    '4444',
    '--strictPort',
  ]);
});

test('buildCheckArgs forwards only check-electron-memory arguments', () => {
  const args = buildCheckArgs(['--strict', '--require-measurement']);
  assert.match(args[0], /scripts\/check-electron-memory\.mjs$/);
  assert.deepEqual(args.slice(1), ['--strict', '--require-measurement']);
});

test('buildCheckEnv points Electron at the preview renderer', () => {
  const env = buildCheckEnv({ A: '1', WEB_DEV_SERVER_URL: 'old' }, 'http://127.0.0.1:4173');
  assert.equal(env.A, '1');
  assert.equal(env.WEB_DEV_SERVER_URL, 'http://127.0.0.1:4173');
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
