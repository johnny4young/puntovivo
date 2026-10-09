import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, before, test } from 'node:test';

const require = createRequire(import.meta.url);
const builderRequire = createRequire(require.resolve('app-builder-lib/package.json'));
const { downloadWithFetch } = builderRequire('./out/util/fetchDownload.js');
const payload = Buffer.from('verified local Electron artifact fixture');
const checksum = createHash('sha256').update(payload).digest('hex');
let server, root, baseURL, redirectTarget, redirectAuthorization;
let requests = 0;
const envKeys = ['HTTP_PROXY', 'HTTPS_PROXY', 'NO_PROXY', 'http_proxy', 'https_proxy', 'no_proxy'];
const previousEnv = Object.fromEntries(envKeys.map(key => [key, process.env[key]]));

before(async () => {
  for (const key of envKeys) delete process.env[key];
  root = await mkdtemp(join(tmpdir(), 'puntovivo-fetch-download-'));
  server = createServer((request, response) => {
    requests += 1;
    if (request.url === '/cross-origin') {
      redirectAuthorization = request.headers.authorization;
      response.writeHead(302, { location: redirectTarget }).end();
    } else if (request.url === '/redirect') {
      response.writeHead(302, { location: '/artifact' }).end();
    } else if (request.url === '/missing') {
      response.writeHead(404).end();
    } else if (request.url === '/server-error') {
      // Larger than the stream buffers, so an unread body cannot complete.
      const body = Buffer.alloc(4 * 1024 * 1024, 120);
      response.writeHead(500, { 'content-length': body.length }).end(body);
    } else if (request.url === '/reset') {
      request.socket.destroy();
    } else if (request.url === '/slow') {
      response.writeHead(200);
      response.write('partial');
    } else {
      response.writeHead(200, { 'content-length': payload.length }).end(payload);
    }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  baseURL = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  server?.closeAllConnections();
  if (server) await new Promise(resolve => server.close(resolve));
  if (root) await rm(root, { recursive: true, force: true });
  for (const [key, value] of Object.entries(previousEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

function config(name, route = '/artifact', options = {}) {
  return {
    isGeneric: true,
    artifactName: `${name}.bin`,
    version: '43.4.1',
    cacheRoot: join(root, name),
    tempDirectory: root,
    checksums: { [`${name}.bin`]: checksum },
    mirrorOptions: { resolveAssetURL: async () => `${baseURL}${route}` },
    downloadOptions: { quiet: true, ...options },
  };
}

test(
  'Node 24 CommonJS owner loads the ESM fetch API and the two patched download paths',
  { timeout: 15000 },
  async () => {
    assert.equal(typeof builderRequire('@electron/get').downloadArtifact, 'function');
    assert.equal(typeof builderRequire('./out/binDownload.js').download, 'function');
    assert.equal(
      typeof builderRequire('./out/util/electronGet.js').downloadElectronArtifactZip,
      'function'
    );
    const graph = JSON.parse(
      await readFile(
        join(dirname(builderRequire.resolve('@electron/get')), '..', 'package.json'),
        'utf8'
      )
    );
    assert.equal(graph.version, '5.1.0');
    assert.ok(!graph.dependencies.got);
  }
);

test(
  'downloads, reports progress, validates integrity and reuses a verified cache',
  { timeout: 15000 },
  async () => {
    const progress = [];
    const input = config('cache', '/redirect', {
      getProgressCallback: async value => {
        progress.push(value);
      },
    });
    const file = await downloadWithFetch(input);
    assert.deepEqual(await readFile(file), payload);
    assert.equal(progress.at(-1).percent, 1);
    assert.equal(progress.at(-1).transferred, payload.length);
    const count = requests;
    assert.equal(await downloadWithFetch(input), file);
    assert.equal(requests, count);
  }
);

test(
  'checksum mismatch and HTTP failure reject instead of accepting a bad artifact',
  { timeout: 15000 },
  async () => {
    const input = config('bad-hash');
    input.checksums['bad-hash.bin'] = '0'.repeat(64);
    await assert.rejects(downloadWithFetch(input), /checksum|digest/i);
    await assert.rejects(
      downloadWithFetch(config('missing', '/missing')),
      error => error.response?.statusCode === 404
    );
  }
);

test(
  'an unread server-error body is released instead of stalling until the deadline',
  { timeout: 15000 },
  async () => {
    const started = Date.now();
    await assert.rejects(
      downloadWithFetch(config('server-error', '/server-error', { timeout: 10000 })),
      error => error.response?.statusCode === 500
    );
    assert.ok(Date.now() - started < 5000, 'dispatcher close waited for the unread body');
  }
);

test('transport failures keep a retryable errno-style code', { timeout: 15000 }, async () => {
  await assert.rejects(
    downloadWithFetch(config('reset', '/reset')),
    error => error.code === 'ECONNRESET'
  );
});

test(
  'the electron-builder cache-miss fallback uses the adapter, not a removed binding',
  { timeout: 15000 },
  async () => {
    const source = await readFile(builderRequire.resolve('./out/util/electronGet.js'), 'utf8');
    assert.doesNotMatch(source, /\bget\.downloadArtifact\(/);
    assert.match(
      source,
      /downloadWithFetch\(\{ \.\.\.configWithProgress, cacheMode: get_1\.ElectronDownloadCacheMode\.WriteOnly \}\)/
    );
  }
);

test('deadline and caller cancellation abort a stalled body', { timeout: 15000 }, async () => {
  await assert.rejects(
    downloadWithFetch(config('timeout', '/slow', { timeout: { request: 100 } })),
    error => error.name === 'TimeoutError' && error.code === 'ETIMEDOUT'
  );
  const controller = new AbortController();
  const task = downloadWithFetch(config('cancel', '/slow', { signal: controller.signal }));
  controller.abort();
  await assert.rejects(task, error => error.name === 'AbortError');
  // A caller's own timeout signal is a final cancellation, not a retryable deadline.
  await assert.rejects(
    downloadWithFetch(config('caller-timeout', '/slow', { signal: AbortSignal.timeout(50) })),
    error => error.name === 'TimeoutError' && error.code !== 'ETIMEDOUT'
  );
});

test('caller cancellation preserves a null abort reason', { timeout: 15000 }, async () => {
  const controller = new AbortController();
  controller.abort(null);
  const count = requests;
  await assert.rejects(
    downloadWithFetch(config('cancel-null', '/artifact', { signal: controller.signal })),
    error => error === controller.signal.reason
  );
  assert.equal(requests, count);
});

test(
  'invalid deadlines and legacy custom agents fail explicitly before any network request',
  { timeout: 15000 },
  async () => {
    const count = requests;
    for (const timeout of [0, -1, Infinity, NaN, 1.5, { connect: 100 }]) {
      await assert.rejects(
        downloadWithFetch(config('invalid', '/artifact', { timeout })),
        /positive request deadline/
      );
    }
    await assert.rejects(
      downloadWithFetch(config('agent', '/artifact', { agent: {} })),
      /legacy got option/
    );
    await assert.rejects(
      downloadWithFetch(
        config('legacy-tls', '/artifact', { https: { rejectUnauthorized: false } })
      ),
      /Unsupported electronDownload fetch option/
    );
    for (const dispatcher of [null, 0, {}]) {
      await assert.rejects(
        downloadWithFetch(config('dispatcher', '/artifact', { dispatcher })),
        /fetch dispatch contract/
      );
    }
    assert.equal(requests, count);
  }
);

test('environment proxy is used and NO_PROXY bypasses it', { timeout: 15000 }, async () => {
  let proxyRequests = 0;
  const proxy = createServer((request, response) => {
    proxyRequests += 1;
    assert.ok(request.url.includes('127.0.0.1'));
    response.writeHead(200, { 'content-length': payload.length }).end(payload);
  });
  // Undici uses CONNECT for HTTP as well as HTTPS through a proxy.
  proxy.on('connect', async (request, socket, head) => {
    const { connect } = await import('node:net');
    proxyRequests += 1;
    const target = connect(server.address().port, '127.0.0.1', () => {
      socket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      if (head.length) target.write(head);
      socket.pipe(target);
      target.pipe(socket);
    });
    socket.on('close', () => target.destroy());
    target.on('error', () => socket.destroy());
  });
  await new Promise(resolve => proxy.listen(0, '127.0.0.1', resolve));
  process.env.HTTP_PROXY = `http://127.0.0.1:${proxy.address().port}`;
  try {
    await downloadWithFetch(config('proxied'));
    assert.equal(proxyRequests, 1);
    process.env.NO_PROXY = '127.0.0.1';
    await downloadWithFetch(config('bypass'));
    assert.equal(proxyRequests, 1);
  } finally {
    delete process.env.HTTP_PROXY;
    delete process.env.NO_PROXY;
    proxy.closeAllConnections();
    await new Promise(resolve => proxy.close(resolve));
  }
});

test(
  'both electron-builder owner paths download verified bytes through the adapter',
  { timeout: 15000 },
  async () => {
    const originalCache = process.env.ELECTRON_BUILDER_CACHE;
    process.env.ELECTRON_BUILDER_CACHE = join(root, 'builder-owner');
    try {
      const output = join(root, 'builder.bin');
      await builderRequire('./out/binDownload.js').download(
        `${baseURL}/artifact`,
        output,
        checksum
      );
      assert.deepEqual(await readFile(output), payload);
      const filename = 'electron-v43.4.1-darwin-arm64.zip';
      const file = await builderRequire('./out/util/electronGet.js').downloadElectronArtifactZip({
        artifactName: 'electron',
        platformName: 'darwin',
        arch: 'arm64',
        version: '43.4.1',
        cacheDir: join(root, 'builder-zip'),
        electronDownload: {
          mirrorOptions: { resolveAssetURL: async () => `${baseURL}/artifact` },
          checksums: { [filename]: checksum },
          downloadOptions: { timeout: { request: 1000 } },
        },
      });
      assert.deepEqual(await readFile(file), payload);
    } finally {
      if (originalCache === undefined) delete process.env.ELECTRON_BUILDER_CACHE;
      else process.env.ELECTRON_BUILDER_CACHE = originalCache;
    }
  }
);

test('a caller-owned dispatcher is not closed by the adapter', { timeout: 15000 }, async () => {
  const { EnvHttpProxyAgent } = builderRequire('undici');
  const dispatcher = new EnvHttpProxyAgent();
  const close = dispatcher.close.bind(dispatcher);
  let closed = 0;
  dispatcher.close = (...args) => {
    closed += 1;
    return close(...args);
  };
  try {
    await downloadWithFetch(config('external-dispatcher', '/artifact', { dispatcher }));
    assert.equal(closed, 0);
  } finally {
    await close();
  }
  assert.equal(closed, 1);
  assert.equal(dispatcher.closed, true);
});

test(
  'cross-origin redirects do not forward an authorization header',
  { timeout: 15000 },
  async () => {
    let authorization;
    const target = createServer((request, response) => {
      authorization = request.headers.authorization;
      response.writeHead(200, { 'content-length': payload.length }).end(payload);
    });
    await new Promise(resolve => target.listen(0, '127.0.0.1', resolve));
    redirectTarget = `http://127.0.0.1:${target.address().port}/artifact`;
    try {
      const file = await downloadWithFetch(
        config('cross-origin', '/cross-origin', { headers: { authorization: 'fixture' } })
      );
      assert.deepEqual(await readFile(file), payload);
      assert.equal(redirectAuthorization, 'fixture');
      assert.equal(authorization, undefined);
    } finally {
      target.closeAllConnections();
      await new Promise(resolve => target.close(resolve));
    }
  }
);
