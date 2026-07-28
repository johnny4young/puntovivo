import assert from 'node:assert/strict';
import { join } from 'node:path';
import { test } from 'node:test';
import {
  PACKAGED_RENDERER_ENTRY_URL,
  PACKAGED_RENDERER_SCHEME,
  installPackagedRendererProtocol,
  isPackagedRendererUrl,
  registerPackagedRendererScheme,
  resolvePackagedRendererPath,
  stripStaticMetaCsp,
} from '../renderer-protocol.ts';

test('registers a secure standard renderer scheme before app readiness', () => {
  let registered: unknown;

  registerPackagedRendererScheme({
    registerSchemesAsPrivileged: schemes => {
      registered = schemes;
    },
  });

  assert.deepEqual(registered, [
    {
      scheme: PACKAGED_RENDERER_SCHEME,
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        corsEnabled: true,
      },
    },
  ]);
});

test('resolves only assets inside the packaged renderer root', () => {
  const root = '/Applications/Puntovivo.app/Contents/Resources/dist';
  assert.equal(
    resolvePackagedRendererPath(root, PACKAGED_RENDERER_ENTRY_URL),
    join(root, 'index.html')
  );
  assert.equal(
    resolvePackagedRendererPath(root, 'puntovivo-app://app/assets/index.js'),
    join(root, 'assets', 'index.js')
  );
  assert.equal(resolvePackagedRendererPath(root, 'puntovivo-app://other/index.html'), null);
  assert.equal(resolvePackagedRendererPath(root, 'puntovivo-app://app/..%2F..%2Fsecret'), null);
  assert.equal(isPackagedRendererUrl('https://example.com'), false);
});

test('serves packaged assets through net.fetch and rejects foreign hosts', async () => {
  let handler: ((request: Request) => Promise<Response> | Response) | undefined;
  let fetched = '';

  await installPackagedRendererProtocol({
    rendererRoot: '/opt/puntovivo/dist',
    protocol: {
      handle: async (scheme, nextHandler) => {
        assert.equal(scheme, PACKAGED_RENDERER_SCHEME);
        handler = nextHandler;
      },
    },
    net: {
      fetch: async input => {
        fetched = input;
        return new Response('asset');
      },
    },
  });

  assert.ok(handler);
  const response = await handler(new Request('puntovivo-app://app/assets/index.js'));
  assert.equal(await response.text(), 'asset');
  assert.match(fetched, /^file:\/\/\/opt\/puntovivo\/dist\/assets\/index\.js$/);

  const rejected = await handler(new Request('puntovivo-app://foreign/index.html'));
  assert.equal(rejected.status, 404);
});

test('removes the static web CSP only from the packaged index response', async () => {
  let handler: ((request: Request) => Promise<Response> | Response) | undefined;
  const indexHtml = `<!doctype html><meta
    http-equiv="Content-Security-Policy"
    content="connect-src 'self' http://localhost:8090;"
  /><main>Puntovivo</main>`;

  installPackagedRendererProtocol({
    rendererRoot: '/opt/puntovivo/dist',
    protocol: {
      handle: (_scheme, nextHandler) => {
        handler = nextHandler;
      },
    },
    net: {
      fetch: async () =>
        new Response(indexHtml, {
          headers: { 'content-type': 'text/html; charset=utf-8', 'content-length': '200' },
        }),
    },
  });

  assert.ok(handler);
  const response = await handler(new Request(PACKAGED_RENDERER_ENTRY_URL));
  const html = await response.text();
  assert.doesNotMatch(html, /Content-Security-Policy/i);
  assert.match(html, /<main>Puntovivo<\/main>/);
  assert.equal(response.headers.get('content-type'), 'text/html; charset=utf-8');
  assert.equal(response.headers.has('content-length'), false);
});

test('stripStaticMetaCsp leaves unrelated metadata untouched', () => {
  const html =
    '<meta charset="UTF-8"><meta http-equiv="Content-Security-Policy" content="default-src self;" />';
  assert.equal(stripStaticMetaCsp(html), '<meta charset="UTF-8">');
});
