import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveE2eApiOrigin, resolveE2eWebOrigin } from '../e2e/web/support/api-origin.ts';

test('E2E API origin keeps the default and accepts an explicit loopback override', () => {
  assert.equal(resolveE2eApiOrigin(undefined, 'http://127.0.0.1:8090'), 'http://127.0.0.1:8090');
  assert.equal(
    resolveE2eApiOrigin('http://localhost:18091/', 'http://localhost:8090'),
    'http://localhost:18091'
  );
});

test('E2E API origin rejects external, credentialed or component-bearing URLs', () => {
  for (const input of [
    '',
    'http://example.com:18091',
    'https://127.0.0.1:18091',
    'http://user:pass@127.0.0.1:18091',
    'http://127.0.0.1:18091/api',
    'http://127.0.0.1:18091/?token=secret',
    'http://127.0.0.1:18091/#fragment',
    'http://127.0.0.1',
    'file:///tmp/socket',
  ]) {
    assert.throws(
      () => resolveE2eApiOrigin(input, 'http://127.0.0.1:8090'),
      /E2E API origin must be an HTTP loopback origin with an explicit port/
    );
  }
});

test('E2E API origin rejects zero ports and components hidden by URL normalization', () => {
  for (const input of [
    'http://127.0.0.1:0',
    'http://localhost:18091/?',
    'http://localhost:18091/#',
    'http://localhost:18091/ignored/..',
    'http://localhost:18091/%2e',
    'http://local\\host:18091',
    'http://local\thost:18091',
  ]) {
    assert.throws(
      () => resolveE2eApiOrigin(input, 'http://127.0.0.1:8090'),
      /E2E API origin must be an HTTP loopback origin with an explicit port/
    );
  }
});

test('owned Web uses the API hostname at its dedicated port for strict cookie continuity', () => {
  for (const host of ['localhost', '127.0.0.1']) {
    assert.equal(resolveE2eWebOrigin(`http://${host}:18091`), `http://${host}:5173`);
    assert.equal(resolveE2eWebOrigin(`http://${host}:18091/`), `http://${host}:5173`);
  }
  assert.throws(() => resolveE2eWebOrigin('http://example.com:18091'), /HTTP loopback origin/);
});
