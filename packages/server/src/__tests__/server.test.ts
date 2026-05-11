/**
 * Server HTTP-level regression tests
 *
 * Validates Fastify server configuration at the HTTP layer using app.inject(),
 * catching issues that tRPC caller tests (which bypass HTTP) would miss.
 *
 * @module __tests__/server.test
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  createServer,
  SERVER_BODY_LIMIT_BYTES,
  SERVER_HEADERS_TIMEOUT_MS,
  SERVER_KEEP_ALIVE_TIMEOUT_MS,
  SERVER_REQUEST_TIMEOUT_MS,
  SERVER_SOCKET_TIMEOUT_MS,
  type PuntovivoServer,
} from '../index.js';

let server: PuntovivoServer;

beforeAll(async () => {
  server = await createServer({
    dbPath: ':memory:',
    verbose: false,
  });
});

afterAll(async () => {
  if (server) {
    await server.close();
  }
});

describe('tRPC batch URL routing', () => {
  /**
   * Regression for the maxParamLength: 1024 fix.
   *
   * Fastify's default maxParamLength is 100 characters. tRPC encodes
   * batched procedure names as comma-separated values in a single route
   * parameter, e.g. `/api/trpc/auth.me,dashboard.summary,products.list,...`
   * A 5-procedure batch easily exceeds 100 chars, causing Fastify to return
   * 404 before the tRPC handler ever runs.
   *
   * The fix sets maxParamLength: 1024 in the Fastify constructor options.
   */
  it('handles a 5-procedure batch URL without returning 404', async () => {
    // Craft a batch URL whose route-param segment is > 100 characters.
    // These are all public/unauthenticated query procedures.
    // Using health.check repeated conceptually — in reality we list 5 distinct
    // procedure names so the encoded param is realistically long.
    const procedures = [
      'health.check',
      'geography.countries',
      'geography.departments',
      'geography.cities',
      'units.list',
      'vatRates.list',
      'categories.list',
      'products.list',
    ];
    const batchParam = procedures.join(',');

    // The param must exceed the old 100-char limit to prove the fix matters.
    expect(batchParam.length).toBeGreaterThan(100);

    const response = await server.app.inject({
      method: 'GET',
      url: `/api/trpc/${batchParam}?batch=1`,
    });

    // 404 means Fastify rejected the long param before reaching tRPC.
    // Any tRPC response (200 or a structured tRPC error like 401/UNAUTHORIZED)
    // confirms the handler was reached.
    expect(response.statusCode).not.toBe(404);
  });

  it('returns a valid tRPC response for the health.check procedure', async () => {
    const response = await server.app.inject({
      method: 'GET',
      url: '/api/trpc/health.check?batch=1',
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as unknown[];
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBeGreaterThan(0);

    const first = body[0] as { result?: { data?: { status?: string } } };
    expect(first?.result?.data?.status).toBe('ok');
  });

  it('does not return 404 for the legacy /api/health endpoint', async () => {
    const response = await server.app.inject({
      method: 'GET',
      url: '/api/health',
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as { status: string; compatibility: boolean };
    expect(body.status).toBe('ok');
    expect(body.compatibility).toBe(true);
  });
});

describe('HTTP transport hardening', () => {
  it('allows the documented OCR image payload size through HTTP', () => {
    expect(server.app.initialConfig.bodyLimit).toBe(SERVER_BODY_LIMIT_BYTES);
  });

  it('configures bounded socket, header, request, and keep-alive timeouts', () => {
    expect(server.app.server.keepAliveTimeout).toBe(SERVER_KEEP_ALIVE_TIMEOUT_MS);
    expect(server.app.server.headersTimeout).toBe(SERVER_HEADERS_TIMEOUT_MS);
    expect(server.app.server.requestTimeout).toBe(SERVER_REQUEST_TIMEOUT_MS);
    expect(server.app.server.timeout).toBe(SERVER_SOCKET_TIMEOUT_MS);
    expect(server.app.server.headersTimeout).toBeGreaterThan(
      server.app.server.keepAliveTimeout
    );
  });
});

describe('CSRF protection', () => {
  it('blocks unsafe methods without a CSRF token when a refresh cookie is present', async () => {
    const response = await server.app.inject({
      method: 'POST',
      url: '/api/trpc/auth.login?batch=1',
      cookies: {
        puntovivo_refresh: 'some-refresh-token',
        // No CSRF cookie set — deliberate omission
      },
      headers: {
        'content-type': 'application/json',
        // No x-csrf-token header
      },
      payload: JSON.stringify({
        '0': { email: 'test@example.com', password: 'password' },
      }),
    });

    expect(response.statusCode).toBe(403);
    const body = JSON.parse(response.body) as { error: string };
    expect(body.error).toBe('CSRF_VALIDATION_FAILED');
  });

  it('allows unsafe methods when no refresh cookie is present (unauthenticated)', async () => {
    // Without a refresh cookie, CSRF check is skipped (user not logged in).
    // The request should reach tRPC (and fail with a business-logic error,
    // not a 403 CSRF error).
    const response = await server.app.inject({
      method: 'POST',
      url: '/api/trpc/auth.login?batch=1',
      headers: {
        'content-type': 'application/json',
      },
      payload: JSON.stringify({
        '0': { email: 'nobody@example.com', password: 'wrong' },
      }),
    });

    // 403 from CSRF would mean our logic is wrong; expect tRPC to handle it.
    // tRPC maps UNAUTHORIZED to HTTP 401, which confirms the handler was reached.
    expect(response.statusCode).not.toBe(403);
  });

  it('rejects unsafe methods when the csrf cookie is malformed even if the header mirrors it', async () => {
    const response = await server.app.inject({
      method: 'POST',
      url: '/api/trpc/auth.refresh?batch=1',
      headers: {
        cookie: 'puntovivo_refresh=some-refresh-token; puntovivo_csrf=attacker-token',
        'content-type': 'application/json',
        'x-csrf-token': 'attacker-token',
      },
      payload: '{}',
    });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toEqual({
      error: 'CSRF_VALIDATION_FAILED',
      message: 'Missing or invalid CSRF token',
    });
  });
});
