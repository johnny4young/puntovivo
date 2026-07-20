/**
 * Store Hub LAN bind requirements.
 *
 * `createServer` must refuse to boot when `runtime.authorityMode ===
 * 'site_hub'` and either the JWT secret or the LAN-origin allow-list
 * is missing. `device_local` and `hub_client` modes must skip the
 * guard entirely so a fresh install + a future hub-client terminal
 * keep booting under their existing semantics.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { createServer, type RuntimeConfig } from '../index.js';
import { clearActiveRuntimeConfig } from '../config/runtime.js';

const SITE_HUB_BASE: RuntimeConfig = {
  authorityMode: 'site_hub',
  bindHost: '0.0.0.0',
  bindPort: 0,
  hubUrl: null,
  siteId: null,
  deviceId: null,
  allowedLanOrigins: [],
};

const STRONG_SITE_HUB_JWT_SECRET = 'hub-secret-2026-8f4b7c1d9a3e6f20b5a9';

afterEach(() => clearActiveRuntimeConfig());

describe('createServer site_hub LAN guard', () => {
  it('refuses site_hub boot when JWT_SECRET is not supplied explicitly', async () => {
    await expect(
      createServer({
        dbPath: ':memory:',
        verbose: false,
        runtime: {
          ...SITE_HUB_BASE,
          allowedLanOrigins: ['http://192.168.1.10:3000'],
        },
      })
    ).rejects.toThrow(/JWT_SECRET/);
  });

  it('refuses site_hub boot when allowedLanOrigins is empty', async () => {
    await expect(
      createServer({
        dbPath: ':memory:',
        verbose: false,
        jwtSecret: STRONG_SITE_HUB_JWT_SECRET,
        runtime: { ...SITE_HUB_BASE, allowedLanOrigins: [] },
      })
    ).rejects.toThrow(/PUNTOVIVO_ALLOWED_LAN_ORIGINS/);
  });

  it('refuses site_hub boot when JWT_SECRET is only whitespace', async () => {
    await expect(
      createServer({
        dbPath: ':memory:',
        verbose: false,
        jwtSecret: '   ',
        runtime: {
          ...SITE_HUB_BASE,
          allowedLanOrigins: ['http://192.168.1.10:3000'],
        },
      })
    ).rejects.toThrow(/JWT_SECRET/);
  });

  it('refuses site_hub boot when JWT_SECRET is shorter than 32 characters', async () => {
    await expect(
      createServer({
        dbPath: ':memory:',
        verbose: false,
        jwtSecret: 'short-but-explicit',
        runtime: {
          ...SITE_HUB_BASE,
          allowedLanOrigins: ['http://192.168.1.10:3000'],
        },
      })
    ).rejects.toThrow(/minimum 32 characters/);
  });

  it('refuses site_hub boot when JWT_SECRET has too little character variety', async () => {
    await expect(
      createServer({
        dbPath: ':memory:',
        verbose: false,
        jwtSecret: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        runtime: {
          ...SITE_HUB_BASE,
          allowedLanOrigins: ['http://192.168.1.10:3000'],
        },
      })
    ).rejects.toThrow(/at least 8 unique characters/);
  });

  it('refuses site_hub boot when JWT_SECRET is a common placeholder', async () => {
    await expect(
      createServer({
        dbPath: ':memory:',
        verbose: false,
        jwtSecret: '12345678901234567890123456789012',
        runtime: {
          ...SITE_HUB_BASE,
          allowedLanOrigins: ['http://192.168.1.10:3000'],
        },
      })
    ).rejects.toThrow(/not a common placeholder/);
  });

  it('names BOTH missing pieces in a single error when neither is supplied', async () => {
    await expect(
      createServer({
        dbPath: ':memory:',
        verbose: false,
        runtime: { ...SITE_HUB_BASE, allowedLanOrigins: [] },
      })
    ).rejects.toThrow(/JWT_SECRET and PUNTOVIVO_ALLOWED_LAN_ORIGINS/);
  });

  it('points operators at the Authority Node architecture guide in the error', async () => {
    await expect(
      createServer({
        dbPath: ':memory:',
        verbose: false,
        runtime: SITE_HUB_BASE,
      })
    ).rejects.toThrow(/ARCHITECTURE\.md.*Sync and Authority Node/);
  });

  it('boots site_hub successfully when JWT_SECRET and allowedLanOrigins are both supplied', async () => {
    const server = await createServer({
      dbPath: ':memory:',
      verbose: false,
      jwtSecret: STRONG_SITE_HUB_JWT_SECRET,
      runtime: {
        ...SITE_HUB_BASE,
        allowedLanOrigins: ['http://192.168.1.10:3000'],
      },
    });
    expect(server.app).toBeDefined();
    await server.close();
  });

  it('skips the guard for device_local even when JWT_SECRET and origins are absent', async () => {
    const server = await createServer({ dbPath: ':memory:', verbose: false });
    expect(server.app).toBeDefined();
    await server.close();
  });

  it('skips the guard for hub_client even with empty origins', async () => {
    const server = await createServer({
      dbPath: ':memory:',
      verbose: false,
      runtime: {
        authorityMode: 'hub_client',
        bindHost: '127.0.0.1',
        bindPort: 0,
        hubUrl: 'http://hub.tienda.local:8090',
        siteId: null,
        deviceId: 'caja-2',
        allowedLanOrigins: [],
      },
    });
    expect(server.app).toBeDefined();
    await server.close();
  });
});
