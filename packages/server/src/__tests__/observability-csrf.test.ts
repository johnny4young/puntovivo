import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type PuntovivoServer } from '../index.js';

let server: PuntovivoServer;
beforeAll(async () => {
  server = await createServer({ dbPath: ':memory:', verbose: false });
});
afterAll(async () => {
  await server.close();
});

describe('public telemetry preserves HTTP CSRF protection', () => {
  const token = 'a'.repeat(43);
  it.each([
    { name: 'anonymous first paint', cookies: {}, header: undefined, status: 200 },
    {
      name: 'stale refresh without CSRF',
      cookies: { puntovivo_refresh: 'expired' },
      header: undefined,
      status: 403,
    },
    {
      name: 'stale refresh after safe bootstrap',
      cookies: { puntovivo_refresh: 'expired', puntovivo_csrf: token },
      header: token,
      status: 200,
    },
    {
      name: 'mismatched CSRF',
      cookies: { puntovivo_refresh: 'expired', puntovivo_csrf: token },
      header: 'b'.repeat(43),
      status: 403,
    },
  ])('$name', async ({ cookies, header, status }) => {
    const response = await server.app.inject({
      method: 'POST',
      url: '/api/trpc/observability.reportWebVital?batch=1',
      cookies,
      headers: {
        'content-type': 'application/json',
        ...(header ? { 'x-csrf-token': header } : {}),
      },
      payload: JSON.stringify({
        '0': { metric: 'FCP', value: 120, rating: 'good', route: '/login', deviceClass: 'mid' },
      }),
    });
    expect(response.statusCode).toBe(status);
    if (status === 403) {
      expect(response.json().error.message).toContain('CSRF_VALIDATION_FAILED');
    } else {
      expect(response.json()[0].result.data).toEqual({ accepted: true });
    }
  });
});
