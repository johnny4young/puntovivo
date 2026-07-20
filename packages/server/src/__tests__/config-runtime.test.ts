/**
 * `resolveRuntimeConfig` + active-singleton tests.
 *
 * Pure function tests; no DB, no Fastify, no env mutation. Each case
 * passes its own env object so tests stay deterministic and parallel-safe.
 */

import { afterEach, describe, expect, it } from 'vitest';
import {
  clearActiveRuntimeConfig,
  getActiveRuntimeConfig,
  getRuntimeDefaults,
  resolveRuntimeConfig,
  setActiveRuntimeConfig,
  VALID_AUTHORITY_MODES,
  type AuthorityMode,
  type RuntimeConfig,
} from '../config/runtime.js';

describe('resolveRuntimeConfig', () => {
  it('returns device_local + loopback + 8090 when env is empty', () => {
    const cfg = resolveRuntimeConfig({ env: {} });
    expect(cfg).toEqual({
      authorityMode: 'device_local',
      bindHost: '127.0.0.1',
      bindPort: 8090,
      hubUrl: null,
      siteId: null,
      deviceId: null,
      allowedLanOrigins: [],
    } satisfies RuntimeConfig);
  });

  it('honors caller-supplied defaults when env is empty', () => {
    const cfg = resolveRuntimeConfig({
      env: {},
      defaults: { bindHost: '0.0.0.0', bindPort: 9000 },
    });
    expect(cfg.bindHost).toBe('0.0.0.0');
    expect(cfg.bindPort).toBe(9000);
    expect(cfg.authorityMode).toBe('device_local');
  });

  it('reads PUNTOVIVO_AUTHORITY_MODE for site_hub', () => {
    const cfg = resolveRuntimeConfig({
      env: {
        PUNTOVIVO_AUTHORITY_MODE: 'site_hub',
        PUNTOVIVO_BIND_HOST: '0.0.0.0',
        PUNTOVIVO_ALLOWED_LAN_ORIGINS: 'http://192.168.1.10:3000, http://192.168.1.11:3000',
      },
    });
    expect(cfg.authorityMode).toBe('site_hub');
    expect(cfg.bindHost).toBe('0.0.0.0');
    expect(cfg.allowedLanOrigins).toEqual(['http://192.168.1.10:3000', 'http://192.168.1.11:3000']);
  });

  it('reads PUNTOVIVO_AUTHORITY_MODE for hub_client + hub URL', () => {
    const cfg = resolveRuntimeConfig({
      env: {
        PUNTOVIVO_AUTHORITY_MODE: 'hub_client',
        PUNTOVIVO_HUB_URL: 'http://hub.tienda.local:8090',
        PUNTOVIVO_DEVICE_ID: 'caja-2',
      },
    });
    expect(cfg.authorityMode).toBe('hub_client');
    expect(cfg.hubUrl).toBe('http://hub.tienda.local:8090');
    expect(cfg.deviceId).toBe('caja-2');
  });

  it('throws on invalid PUNTOVIVO_AUTHORITY_MODE', () => {
    expect(() => resolveRuntimeConfig({ env: { PUNTOVIVO_AUTHORITY_MODE: 'cluster' } })).toThrow(
      /Invalid PUNTOVIVO_AUTHORITY_MODE/
    );
    expect(() => resolveRuntimeConfig({ env: { PUNTOVIVO_AUTHORITY_MODE: 'cluster' } })).toThrow(
      /device_local, site_hub, hub_client/
    );
  });

  it('treats blank/whitespace PUNTOVIVO_AUTHORITY_MODE as unset', () => {
    const cfg = resolveRuntimeConfig({ env: { PUNTOVIVO_AUTHORITY_MODE: '   ' } });
    expect(cfg.authorityMode).toBe('device_local');
  });

  it('honors legacy HOST/PORT when PUNTOVIVO_BIND_HOST/PORT are absent', () => {
    const cfg = resolveRuntimeConfig({
      env: { HOST: '10.0.0.5', PORT: '9001' },
    });
    expect(cfg.bindHost).toBe('10.0.0.5');
    expect(cfg.bindPort).toBe(9001);
  });

  it('PUNTOVIVO_BIND_PORT takes precedence over PORT', () => {
    const cfg = resolveRuntimeConfig({
      env: { PUNTOVIVO_BIND_PORT: '9100', PORT: '9001' },
    });
    expect(cfg.bindPort).toBe(9100);
  });

  it('PUNTOVIVO_BIND_HOST takes precedence over HOST', () => {
    const cfg = resolveRuntimeConfig({
      env: { PUNTOVIVO_BIND_HOST: '0.0.0.0', HOST: '10.0.0.5' },
    });
    expect(cfg.bindHost).toBe('0.0.0.0');
  });

  it('throws when bind port is non-numeric', () => {
    expect(() => resolveRuntimeConfig({ env: { PUNTOVIVO_BIND_PORT: 'eighty-ninety' } })).toThrow(
      /Invalid bind port/
    );
    expect(() => resolveRuntimeConfig({ env: { PUNTOVIVO_BIND_PORT: '8090abc' } })).toThrow(
      /Invalid bind port/
    );
    expect(() => resolveRuntimeConfig({ env: { PUNTOVIVO_BIND_PORT: '1.5' } })).toThrow(
      /Invalid bind port/
    );
  });

  it('throws when bind port is out of range', () => {
    expect(() => resolveRuntimeConfig({ env: { PUNTOVIVO_BIND_PORT: '0' } })).toThrow(
      /Invalid bind port/
    );
    expect(() => resolveRuntimeConfig({ env: { PUNTOVIVO_BIND_PORT: '70000' } })).toThrow(
      /Invalid bind port/
    );
  });

  it('parses comma-separated PUNTOVIVO_ALLOWED_LAN_ORIGINS, trimming whitespace and dropping empties', () => {
    const cfg = resolveRuntimeConfig({
      env: {
        PUNTOVIVO_ALLOWED_LAN_ORIGINS: ' http://a.local , , http://b.local:3000 ,',
      },
    });
    expect(cfg.allowedLanOrigins).toEqual(['http://a.local', 'http://b.local:3000']);
  });

  it('allows authority mode change without overriding other defaults', () => {
    const cfg = resolveRuntimeConfig({
      env: { PUNTOVIVO_AUTHORITY_MODE: 'site_hub' },
      defaults: { bindHost: '0.0.0.0', bindPort: 8888 },
    });
    expect(cfg.authorityMode).toBe('site_hub');
    expect(cfg.bindHost).toBe('0.0.0.0');
    expect(cfg.bindPort).toBe(8888);
    expect(cfg.allowedLanOrigins).toEqual([]);
  });
});

describe('VALID_AUTHORITY_MODES', () => {
  it('exposes the three modes documented in ADR-0008', () => {
    expect(VALID_AUTHORITY_MODES).toEqual(['device_local', 'site_hub', 'hub_client']);
  });

  it('every value satisfies the AuthorityMode type', () => {
    for (const mode of VALID_AUTHORITY_MODES) {
      const typed: AuthorityMode = mode;
      expect(typeof typed).toBe('string');
    }
  });
});

describe('getRuntimeDefaults', () => {
  it('returns a fresh copy each call (no shared mutation)', () => {
    const a = getRuntimeDefaults();
    const b = getRuntimeDefaults();
    a.bindPort = 12345;
    a.allowedLanOrigins.push('http://mutated.local');
    expect(b.bindPort).toBe(8090);
    expect(b.allowedLanOrigins).toEqual([]);
  });
});

describe('active runtime config singleton', () => {
  afterEach(() => clearActiveRuntimeConfig());

  it('returns defaults when no active config has been set', () => {
    expect(getActiveRuntimeConfig().authorityMode).toBe('device_local');
    expect(getActiveRuntimeConfig().bindPort).toBe(8090);
  });

  it('returns the explicitly set config after setActiveRuntimeConfig', () => {
    setActiveRuntimeConfig({
      authorityMode: 'site_hub',
      bindHost: '0.0.0.0',
      bindPort: 8090,
      hubUrl: null,
      siteId: 'sede-norte',
      deviceId: null,
      allowedLanOrigins: ['http://192.168.1.10:3000'],
    });
    const active = getActiveRuntimeConfig();
    expect(active.authorityMode).toBe('site_hub');
    expect(active.bindHost).toBe('0.0.0.0');
    expect(active.siteId).toBe('sede-norte');
    expect(active.allowedLanOrigins).toEqual(['http://192.168.1.10:3000']);
  });

  it('clearActiveRuntimeConfig resets to defaults', () => {
    setActiveRuntimeConfig({
      authorityMode: 'hub_client',
      bindHost: '127.0.0.1',
      bindPort: 8090,
      hubUrl: 'http://hub.local:8090',
      siteId: null,
      deviceId: 'caja-3',
      allowedLanOrigins: [],
    });
    expect(getActiveRuntimeConfig().authorityMode).toBe('hub_client');
    clearActiveRuntimeConfig();
    expect(getActiveRuntimeConfig().authorityMode).toBe('device_local');
  });
});
