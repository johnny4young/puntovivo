import { afterEach, describe, expect, it, vi } from 'vitest';
import { createServer, type PuntovivoServer } from '../index.js';

let server: PuntovivoServer | undefined;
afterEach(async () => {
  await server?.close();
  server = undefined;
  vi.unstubAllEnvs();
});

describe('global HTTP throttle transport', () => {
  it.each([
    '/api/trpc/health.check',
    '/api/trpc/health.check?batch=1',
    '/api/trpc/health.check,health.check?batch=1',
  ])('keeps the cap and returns a safe tRPC error at %s', async url => {
    vi.stubEnv('PUNTOVIVO_GLOBAL_RATE_LIMIT_MAX', '1');
    server = await createServer({ dbPath: ':memory:', verbose: false });
    const first = await server.app.inject({ method: 'GET', url });
    expect(first.statusCode).toBe(200);
    const second = await server.app.inject({ method: 'GET', url });
    expect(second.statusCode).toBe(429);
    expect(second.headers['x-ratelimit-limit']).toBe('1');
    expect(Number(second.headers['retry-after'])).toBeGreaterThan(0);
    expect(Number(second.headers['retry-after'])).toBeLessThanOrEqual(60);
    expect(second.json()).toMatchObject({
      error: {
        code: -32029,
        message: 'Too many requests. Wait before trying again.',
        data: { code: 'TOO_MANY_REQUESTS', httpStatus: 429, errorCode: 'AUTH_RATE_LIMIT_EXCEEDED' },
      },
    });
    expect(second.body).not.toContain('stack');
    expect((await server.app.inject({ method: 'GET', url })).statusCode).toBe(429);
  });
  it('preserves non-tRPC HTTP errors without converting health to an application API', async () => {
    vi.stubEnv('PUNTOVIVO_GLOBAL_RATE_LIMIT_MAX', '1');
    server = await createServer({ dbPath: ':memory:', verbose: false });
    expect((await server.app.inject('/api/health')).statusCode).toBe(200);
    const response = await server.app.inject('/api/health');
    expect(response.statusCode).toBe(429);
    expect(response.json()).toMatchObject({ statusCode: 429, error: 'Too Many Requests' });
  });

  it('keeps the production default at 100 requests and isolates different IPs', async () => {
    vi.stubEnv('PUNTOVIVO_GLOBAL_RATE_LIMIT_MAX', '');
    server = await createServer({ dbPath: ':memory:', verbose: false });
    for (let request = 0; request < 100; request++) {
      expect((await server.app.inject('/api/health')).statusCode).toBe(200);
    }
    const blocked = await server.app.inject('/api/trpc/health.check?batch=1');
    expect(blocked.statusCode).toBe(429);
    expect(blocked.headers['x-ratelimit-limit']).toBe('100');
    expect(blocked.json().error.data.code).toBe('TOO_MANY_REQUESTS');
    expect(
      (await server.app.inject({ url: '/api/health', remoteAddress: '192.0.2.10' })).statusCode
    ).toBe(200);
  });

  it.each(['auth.refresh', 'workforce.schedulePlans.publish'])(
    'throttles %s before executing the mutation',
    async path => {
      vi.stubEnv('PUNTOVIVO_GLOBAL_RATE_LIMIT_MAX', '1');
      server = await createServer({ dbPath: ':memory:', verbose: false });
      expect((await server.app.inject('/api/health')).statusCode).toBe(200);
      const result = await server.app.inject({
        method: 'POST',
        url: `/api/trpc/${path}?batch=1`,
        payload: {},
      });
      expect(result.statusCode).toBe(429);
      expect(result.json().error.data).toMatchObject({
        code: 'TOO_MANY_REQUESTS',
        httpStatus: 429,
      });
    }
  );
});
