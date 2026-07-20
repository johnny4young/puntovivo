/**
 * `/api/health` Authority Node identity surface.
 *
 * The endpoint stays unauthenticated (Kubernetes-style status) but
 * gains five fields so an operator can run `curl /api/health`
 * against a hub box and verify the boot mode + DB lineage + active
 * device count + app version without logging in. Sanitization
 * concern: `dbPathFingerprint` is a SHA-256 truncation, never the
 * raw path.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type PuntovivoServer, type RuntimeConfig } from '../index.js';
import { clearActiveRuntimeConfig } from '../config/runtime.js';
import { fingerprintDbPath } from '../lib/runtimeMetadata.js';

let server: PuntovivoServer;

beforeAll(async () => {
  // `app.inject` exercises the route handler without
  // opening a real socket, so the test stays parallel-safe and
  // never collides with another server on port 8090 (e.g. a dev
  // preview running in the background).
  server = await createServer({
    dbPath: ':memory:',
    verbose: false,
    appVersion: '1.2.3-test',
  });
});

afterAll(async () => {
  await server.close();
  clearActiveRuntimeConfig();
});

async function getHealth(): Promise<Record<string, unknown>> {
  const response = await server.app.inject({ method: 'GET', url: '/api/health' });
  expect(response.statusCode).toBe(200);
  return response.json() as Record<string, unknown>;
}

describe('GET /api/health', () => {
  it('returns the legacy compatibility fields plus the new Authority Node identity block', async () => {
    const body = await getHealth();
    // Pre-existing fields stay intact.
    expect(body.status).toBe('ok');
    expect(body.compatibility).toBe(true);
    expect(body.canonicalProcedure).toBe('health.check');
    expect(typeof body.timestamp).toBe('string');
    // additions.
    expect(body.authorityMode).toBe('device_local');
    expect(body.appVersion).toBe('1.2.3-test');
    expect(typeof body.dbSchemaVersion).toBe('number');
    expect(typeof body.dbPathFingerprint).toBe('string');
    expect(typeof body.activeDeviceCount).toBe('number');
  });

  it('reports a stable fingerprint that matches fingerprintDbPath(":memory:")', async () => {
    const body = await getHealth();
    expect(body.dbPathFingerprint).toBe(fingerprintDbPath(':memory:'));
    expect(body.dbPathFingerprint).toBe('memory');
  });

  it('reports activeDeviceCount as a non-negative integer for a clean DB', async () => {
    const body = await getHealth();
    const value = body.activeDeviceCount as number;
    expect(Number.isInteger(value)).toBe(true);
    expect(value).toBeGreaterThanOrEqual(0);
  });

  it('reports dbSchemaVersion > 0 because initDatabase always runs migrations before listen', async () => {
    const body = await getHealth();
    const version = body.dbSchemaVersion as number;
    // strictly positive: initDatabase runs the full
    // migration journal before listen, so a server reporting 0
    // here would indicate the migration runner did not execute
    // (the bug the old `>= 0` assertion would have hidden).
    expect(version).toBeGreaterThan(0);
  });

  it('does NOT expose the raw dbPath under any field', async () => {
    const body = await getHealth();
    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain(':memory:');
    expect(serialized).not.toContain('/data/local.db');
  });
});

describe('GET /api/health under explicit site_hub runtime', () => {
  let hubServer: PuntovivoServer;

  beforeAll(async () => {
    const runtime: RuntimeConfig = {
      authorityMode: 'site_hub',
      bindHost: '127.0.0.1',
      bindPort: 0,
      hubUrl: null,
      siteId: 'sede-norte',
      deviceId: null,
      allowedLanOrigins: ['http://192.168.1.10:3000'],
    };
    hubServer = await createServer({
      dbPath: ':memory:',
      verbose: false,
      jwtSecret: 'hub-secret-2026-8f4b7c1d9a3e6f20b5a9',
      appVersion: '2.0.0-hub',
      runtime,
    });
  });

  afterAll(async () => {
    await hubServer.close();
    clearActiveRuntimeConfig();
  });

  it('reports authorityMode=site_hub on the unauthenticated endpoint', async () => {
    const response = await hubServer.app.inject({ method: 'GET', url: '/api/health' });
    expect(response.statusCode).toBe(200);
    const body = response.json() as Record<string, unknown>;
    expect(body.authorityMode).toBe('site_hub');
    expect(body.appVersion).toBe('2.0.0-hub');
  });
});
