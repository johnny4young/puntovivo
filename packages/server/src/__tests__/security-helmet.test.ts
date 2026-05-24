/**
 * ENG-166 — assert that @fastify/helmet is wired and emits the security
 * headers the audit requires. Uses `app.inject` so the test pays for
 * Fastify boot but skips real socket binding.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { createServer, type PuntovivoServer } from '../index.js';

let server: PuntovivoServer | null = null;

afterEach(async () => {
  if (server) {
    await server.close();
    server = null;
  }
});

describe('security headers (helmet)', () => {
  it('emits the security headers on /api/health', async () => {
    server = await createServer({ dbPath: ':memory:', verbose: false });
    const response = await server.app.inject({
      method: 'GET',
      url: '/api/health',
    });

    expect(response.statusCode).toBe(200);

    const csp = response.headers['content-security-policy'];
    expect(csp).toBeDefined();
    expect(typeof csp).toBe('string');
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");

    expect(response.headers['x-frame-options']).toBe('DENY');
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['referrer-policy']).toBe('no-referrer');
    // HSTS intentionally disabled for the Electron loopback deployment.
    expect(response.headers['strict-transport-security']).toBeUndefined();
  });
});
