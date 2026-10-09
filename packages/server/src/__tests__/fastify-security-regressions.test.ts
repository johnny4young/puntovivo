import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify';
import { describe, expect, it, onTestFinished } from 'vitest';

const HTTP2_CHILD_TIMEOUT_MS = 8000;
// The test budget must outlast the child's own bound so a hang reports the
// child's failure instead of the default 5 s Vitest timeout.
const HTTP2_TEST_TIMEOUT_MS = HTTP2_CHILD_TIMEOUT_MS + 2000;

function createApp() {
  const app = Fastify({ logger: false });
  onTestFinished(() => app.close());
  return app;
}

// Exercise the installed dependency, not a mock or a version-only assertion.
// These test-only routes are not additions to the application's tRPC API.
describe('Fastify security contracts', () => {
  it.each(['body', 'querystring', 'query', 'params', 'headers'])(
    'enforces a deny-all boolean %s schema',
    async part => {
      const app = createApp();
      let calls = 0;
      app.post('/deny/:id', { schema: { [part]: false } }, async () => {
        calls++;
        return { accepted: true };
      });
      app.post('/allow/:id', { schema: { [part]: true } }, async () => ({ accepted: true }));
      const request = { method: 'POST' as const, payload: { item: 'valid' } };

      const denied = await app.inject({ ...request, url: '/deny/one?item=valid' });
      expect(denied.statusCode).toBe(400);
      expect(calls).toBe(0);
      const allowed = await app.inject({ ...request, url: '/allow/one?item=valid' });
      expect(allowed.statusCode).toBe(200);
      expect(allowed.json()).toEqual({ accepted: true });
    }
  );

  it.each([
    { operation: 'read', value: { operation: 'delete' } },
    { operation: 'read', error: 'payload-is-not-a-validation-result' },
  ])('preserves an async-validated body containing $value or $error', async payload => {
    const app = createApp();
    app.post(
      '/async',
      {
        schema: {
          body: {
            $async: true,
            type: 'object',
            required: ['operation'],
            properties: { operation: { const: 'read' } },
          },
        },
      },
      async request => request.body
    );

    const valid = await app.inject({ method: 'POST', url: '/async', payload });
    expect(valid.statusCode).toBe(200);
    expect(valid.json()).toEqual(payload);
    const invalid = await app.inject({
      method: 'POST',
      url: '/async',
      payload: { operation: 'delete' },
    });
    expect(invalid.statusCode).toBe(400);
  });

  it('preserves the synchronous custom-validator replacement contract', async () => {
    const app = createApp();
    app.setValidatorCompiler(() => () => ({ value: { operation: 'normalized' } }));
    app.post('/sync', { schema: { body: { type: 'object' } } }, async request => request.body);
    const response = await app.inject({
      method: 'POST',
      url: '/sync',
      payload: { operation: 'read' },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ operation: 'normalized' });
  });

  it.each([
    { dependencies: { 'X-Action': ['X-Action-Token'] } },
    { allOf: [{ required: ['X-Action-Token'] }] },
  ])('normalizes cross-header and nested schema assertions (%j)', async assertion => {
    const app = createApp();
    let calls = 0;
    app.get(
      '/headers',
      {
        schema: {
          headers: {
            type: 'object',
            properties: { 'X-Action': { type: 'string' }, 'X-Action-Token': { type: 'string' } },
            ...assertion,
          },
        },
      },
      async () => {
        calls++;
        return { accepted: true };
      }
    );
    const denied = await app.inject({ url: '/headers', headers: { 'x-action': 'read' } });
    expect(denied.statusCode).toBe(400);
    expect(calls).toBe(0);
    const allowed = await app.inject({
      url: '/headers',
      headers: { 'x-action': 'read', 'x-action-token': 'test-only-token' },
    });
    expect(allowed.statusCode).toBe(200);
    expect(allowed.json()).toEqual({ accepted: true });
    expect(calls).toBe(1);
  });

  it('rejects malformed URLs before sibling private fallback handlers run', async () => {
    const app = createApp();
    let privateCalls = 0;
    app.register(
      async publicApp => {
        publicApp.get('/known', async () => ({ public: true }));
        publicApp.setNotFoundHandler(async (_request, reply) =>
          reply.code(404).send({ public: true })
        );
      },
      { prefix: '/public' }
    );
    app.register(
      async privateApp => {
        privateApp.get('/known', async () => ({ private: true }));
        privateApp.setNotFoundHandler(
          {
            preHandler: async (request: FastifyRequest, reply: FastifyReply) => {
              if (request.headers.authorization !== 'Bearer test-only-token') {
                return reply.code(401).send({ denied: true });
              }
            },
          },
          (_request, reply) => {
            privateCalls++;
            reply.send({ private: true });
          }
        );
      },
      { prefix: '/private' }
    );

    const malformed = await app.inject({ method: 'DELETE', url: '/public/%c0' });
    expect(malformed.statusCode).toBe(400);
    expect(privateCalls).toBe(0);
    const publicMissing = await app.inject({ url: '/public/missing' });
    expect(publicMissing.statusCode).toBe(404);
    expect(publicMissing.json()).toEqual({ public: true });
    const privateDenied = await app.inject({ url: '/private/missing' });
    expect(privateDenied.statusCode).toBe(401);
    expect(privateCalls).toBe(0);
    const privateAllowed = await app.inject({
      url: '/private/missing',
      headers: { authorization: 'Bearer test-only-token' },
    });
    expect(privateAllowed.statusCode).toBe(200);
    expect(privateAllowed.json()).toEqual({ private: true });
    expect(privateCalls).toBe(1);
  });

  it(
    'serves HTTP/2 trailers without a connection-header crash',
    async () => {
      // An affected version terminates the process. Isolate that failure in a
      // bounded child; inject() cannot exercise Node's HTTP/2 header serializer.
      // Loopback port 0 is test-owned; the application remains HTTP/1 + tRPC.
      const script = `
      import assert from 'node:assert/strict';
      import { connect } from 'node:http2';
      import { once } from 'node:events';
      import Fastify from 'fastify';
      const app = Fastify({ http2: true, logger: false });
      app.get('/trailers', async (_request, reply) => {
        reply.trailer('x-test-proof', async () => 'verified');
        return 'payload';
      });
      app.get('/health', async () => 'alive');
      const address = await app.listen({ host: '127.0.0.1', port: 0 });
      const client = connect(address);
      try {
        const request = client.request({ ':path': '/trailers' });
        let headers, trailers, body = '';
        request.on('response', value => { headers = value; });
        request.on('trailers', value => { trailers = value; });
        request.setEncoding('utf8');
        request.on('data', chunk => { body += chunk; });
        await once(request, 'end');
        assert.equal(headers[':status'], 200);
        assert.equal(headers['transfer-encoding'], undefined);
        assert.equal(trailers['x-test-proof'], 'verified');
        assert.equal(body, 'payload');
        const health = client.request({ ':path': '/health' });
        let healthBody = '';
        health.setEncoding('utf8');
        health.on('data', chunk => { healthBody += chunk; });
        await once(health, 'end');
        assert.equal(healthBody, 'alive');
      } finally {
        client.destroy();
        await app.close();
      }
    `;
      const result = await promisify(execFile)(
        process.execPath,
        ['--input-type=module', '--eval', script],
        {
          cwd: fileURLToPath(new URL('../../', import.meta.url)),
          timeout: HTTP2_CHILD_TIMEOUT_MS,
          maxBuffer: 64 * 1024,
        }
      );
      expect(result.stderr).toBe('');
      expect(result.stdout).toBe('');
    },
    HTTP2_TEST_TIMEOUT_MS
  );
});
