#!/usr/bin/env node
/**
 * contract tests for the Electron memory gate runner.
 *
 * The real launch is covered by `ci:desktop`; these tests pin argument/env
 * handling, literal child-process arguments and readiness without starting
 * Vite or Electron.
 *
 * @module scripts/run-electron-memory-gate.test
 */
import { test } from 'node:test';
import { createServer } from 'node:http';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  buildCheckArgs,
  buildCheckEnv,
  buildPreviewArgs,
  buildPreviewInvocation,
  DEFAULT_PREVIEW_HOST,
  DEFAULT_PREVIEW_PORT,
  reserveLoopbackPort,
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
  assert.equal(options.portExplicit, false);
  assert.equal(options.previewUrl, `http://${DEFAULT_PREVIEW_HOST}:${DEFAULT_PREVIEW_PORT}`);
  assert.deepEqual(options.passThroughArgs, ['--strict', '--require-measurement']);
});

test('resolveRunElectronMemoryGateOptions accepts runner flags without forwarding them', () => {
  const options = resolveRunElectronMemoryGateOptions({
    argv: [
      '--host=0.0.0.0',
      '--port',
      '4321',
      '--ready-timeout-ms=1234',
      '--skip-preview',
      '--strict',
    ],
    env: {},
  });
  assert.equal(options.host, '0.0.0.0');
  assert.equal(options.port, 4321);
  assert.equal(options.portExplicit, true);
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
  assert.equal(options.portExplicit, true);
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

test('resolveRunElectronMemoryGateOptions treats an environment preview port as explicit', () => {
  const options = resolveRunElectronMemoryGateOptions({
    argv: ['--strict'],
    env: { PUNTOVIVO_MEMORY_WEB_PORT: '5123' },
  });
  assert.equal(options.port, 5123);
  assert.equal(options.portExplicit, true);
  assert.equal(options.previewUrl, 'http://127.0.0.1:5123');
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

test('the public memory-gate command runs through the pnpm script environment', () => {
  const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  assert.equal(
    manifest.scripts['perf:electron-memory:gate'],
    'node scripts/run-electron-memory-gate.mjs'
  );
});

test('buildPreviewInvocation runs a pnpm script through the current Node on Windows', () => {
  const entry = String.raw`C:\Program Files\pnpm\pnpm.cjs`;
  assert.deepEqual(
    buildPreviewInvocation(
      { host: '127.0.0.1', port: 4444 },
      { env: { npm_execpath: entry }, platform: 'win32', execPath: 'node.exe' }
    ),
    {
      command: 'node.exe',
      args: [entry, ...buildPreviewArgs({ host: '127.0.0.1', port: 4444 })],
      shell: false,
    }
  );
});

test('buildPreviewInvocation launches the native standalone pnpm executable without a shell', () => {
  const entry = String.raw`C:\Program Files\pnpm\pnpm.exe`;
  const options = { host: '127.0.0.1', port: 4444 };
  assert.deepEqual(
    buildPreviewInvocation(options, { env: { npm_execpath: entry }, platform: 'win32' }),
    { command: entry, args: buildPreviewArgs(options), shell: false }
  );
});

test('buildPreviewInvocation preserves direct POSIX invocation and honors explicit pnpm entries', () => {
  const options = { host: '127.0.0.1', port: 4444 };
  assert.deepEqual(buildPreviewInvocation(options, { env: {}, platform: 'linux' }), {
    command: 'pnpm',
    args: buildPreviewArgs(options),
    shell: false,
  });
  assert.deepEqual(
    buildPreviewInvocation(options, { env: { npm_execpath: '/store/pnpm' }, platform: 'darwin' }),
    {
      command: '/store/pnpm',
      args: buildPreviewArgs(options),
      shell: false,
    }
  );
});

test('buildPreviewInvocation never hands pnpm arguments to another package manager', () => {
  const options = { host: '127.0.0.1', port: 4444 };
  for (const entry of ['/usr/lib/node_modules/npm/bin/npm-cli.js', '/opt/yarn/bin/yarn.js']) {
    assert.deepEqual(
      buildPreviewInvocation(options, { env: { npm_execpath: entry }, platform: 'linux' }),
      { command: 'pnpm', args: buildPreviewArgs(options), shell: false },
      entry
    );
  }
  assert.throws(
    () =>
      buildPreviewInvocation(options, {
        env: { npm_execpath: String.raw`C:\npm\bin\npm-cli.js` },
        platform: 'win32',
      }),
    /Run the memory gate via pnpm/
  );
});

test('buildPreviewInvocation fails closed for a missing Windows entry or a shell wrapper', () => {
  const options = { host: '127.0.0.1', port: 4444 };
  for (const entry of [undefined, '', 'pnpm.cmd', 'pnpm.bat']) {
    assert.throws(
      () => buildPreviewInvocation(options, { env: { npm_execpath: entry }, platform: 'win32' }),
      /Run the memory gate via pnpm/,
      String(entry)
    );
  }
});

test('buildPreviewInvocation preserves literal arguments through a real child script without shell evaluation', () => {
  const dir = mkdtempSync(join(tmpdir(), 'puntovivo-pnpm-preview-'));
  try {
    const entry = join(dir, 'pnpm with spaces.cjs');
    writeFileSync(entry, 'process.stdout.write(JSON.stringify(process.argv.slice(2)))');
    const options = { host: '127.0.0.1 & echo unexpected', port: 4444 };
    const invocation = buildPreviewInvocation(options, {
      env: { npm_execpath: entry },
      platform: 'win32',
      execPath: process.execPath,
    });
    const result = spawnSync(invocation.command, invocation.args, {
      shell: invocation.shell,
      encoding: 'utf8',
    });
    assert.equal(result.error, undefined);
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), buildPreviewArgs(options));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('buildCheckArgs forwards only check-electron-memory arguments', () => {
  const args = buildCheckArgs(['--strict', '--require-measurement']);
  assert.equal(args[0], fileURLToPath(new URL('./check-electron-memory.mjs', import.meta.url)));
  assert.deepEqual(args.slice(1), ['--strict', '--require-measurement']);
});

test('buildCheckEnv points Electron at the preview renderer', () => {
  const env = buildCheckEnv(
    { A: '1', WEB_DEV_SERVER_URL: 'old', PUNTOVIVO_BIND_PORT: '8090' },
    'http://127.0.0.1:4173',
    54321
  );
  assert.equal(env.A, '1');
  assert.equal(env.WEB_DEV_SERVER_URL, 'http://127.0.0.1:4173');
  assert.equal(env.PUNTOVIVO_BIND_PORT, '54321');
});

test('reserveLoopbackPort returns a valid ephemeral port', async () => {
  const port = await reserveLoopbackPort();
  assert.ok(Number.isInteger(port));
  assert.ok(port > 0 && port <= 65_535);
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

// Native fetch can throw outside its promise when macOS rejects the optional
// QoS socket marking. Simulate that socket failure in a disposable child only.
test('preview readiness does not invoke optional socket QoS marking', () => {
  const moduleUrl = new URL('./run-electron-memory-gate.mjs', import.meta.url).href;
  const child = spawnSync(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      `
    import { createServer } from 'node:http';
    import { Socket } from 'node:net';
    import { waitForUrl } from ${JSON.stringify(moduleUrl)};
    const server = createServer((_request, response) => response.writeHead(404).end());
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    Socket.prototype.setTypeOfService = () => {
      throw Object.assign(new Error('setTypeOfService EINVAL'), { code: 'EINVAL' });
    };
    try {
      await waitForUrl('http://127.0.0.1:' + server.address().port, { timeoutMs: 1000 });
    } finally {
      server.closeAllConnections();
      await new Promise(resolve => server.close(resolve));
    }
  `,
    ],
    { encoding: 'utf8', timeout: 5000 }
  );
  assert.equal(child.status, 0, child.stderr);
  assert.equal(child.signal, null);
});

test('preview readiness keeps the deadline when a server never sends headers', async () => {
  const server = createServer(() => {});
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    await assert.rejects(
      waitForUrl(`http://127.0.0.1:${server.address().port}`, { timeoutMs: 50, intervalMs: 1 }),
      /Timed out waiting/
    );
  } finally {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
});
