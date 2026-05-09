/**
 * ENG-074 — runtimeConfigClient unit tests.
 *
 * Pure module-init resolver tests; no React, no DOM. Each case
 * mounts a `window.electron` shape on the test harness, calls the
 * resolver, then resets the cache and the global.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  __resetRuntimeConfigCacheForTests,
  getRuntimeConfigSync,
  resolveApiBaseUrl,
  type RendererRuntimeConfig,
} from '../runtimeConfigClient';

const ORIGINAL_ELECTRON = (window as unknown as { electron?: unknown }).electron;

function setBridge(config: RendererRuntimeConfig | null | undefined): void {
  (window as unknown as { electron?: { runtime?: { getConfigSync: () => unknown } } }).electron =
    config === undefined
      ? undefined
      : {
          runtime: {
            getConfigSync: () => config,
          },
        };
}

function setBridgeThatThrows(): void {
  (window as unknown as { electron?: { runtime?: { getConfigSync: () => unknown } } }).electron = {
    runtime: {
      getConfigSync: () => {
        throw new Error('forced sync IPC failure');
      },
    },
  };
}

beforeEach(() => {
  __resetRuntimeConfigCacheForTests();
});

afterEach(() => {
  (window as unknown as { electron?: unknown }).electron = ORIGINAL_ELECTRON;
  __resetRuntimeConfigCacheForTests();
  vi.restoreAllMocks();
});

describe('getRuntimeConfigSync', () => {
  it('falls back to device_local when window.electron is absent (web-standalone)', () => {
    setBridge(undefined);
    expect(getRuntimeConfigSync()).toEqual({
      authorityMode: 'device_local',
      hubUrl: null,
      siteId: null,
      deviceId: null,
    });
  });

  it('returns the bridge value when Electron preload exposes hub_client', () => {
    setBridge({
      authorityMode: 'hub_client',
      hubUrl: 'http://hub.tienda.local:8090',
      siteId: 'sede-norte',
      deviceId: 'caja-2',
    });
    const cfg = getRuntimeConfigSync();
    expect(cfg.authorityMode).toBe('hub_client');
    expect(cfg.hubUrl).toBe('http://hub.tienda.local:8090');
    expect(cfg.siteId).toBe('sede-norte');
    expect(cfg.deviceId).toBe('caja-2');
  });

  it('caches across calls so repeated reads do not hit the bridge twice', () => {
    let count = 0;
    (window as unknown as { electron?: { runtime?: { getConfigSync: () => unknown } } }).electron = {
      runtime: {
        getConfigSync: () => {
          count++;
          return {
            authorityMode: 'site_hub',
            hubUrl: null,
            siteId: null,
            deviceId: null,
          } satisfies RendererRuntimeConfig;
        },
      },
    };
    expect(getRuntimeConfigSync().authorityMode).toBe('site_hub');
    expect(getRuntimeConfigSync().authorityMode).toBe('site_hub');
    expect(getRuntimeConfigSync().authorityMode).toBe('site_hub');
    expect(count).toBe(1);
  });

  it('falls back to device_local when the bridge throws (preload race / IPC failure)', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    setBridgeThatThrows();
    expect(getRuntimeConfigSync().authorityMode).toBe('device_local');
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('falling back to device_local'),
      expect.any(Error)
    );
  });

  it('falls back to device_local when the bridge returns a malformed authorityMode', () => {
    setBridge({
      // deliberately invalid runtime shape from a buggy preload
      authorityMode: 'cluster' as unknown as RendererRuntimeConfig['authorityMode'],
      hubUrl: null,
      siteId: null,
      deviceId: null,
    });
    expect(getRuntimeConfigSync().authorityMode).toBe('device_local');
  });
});

describe('resolveApiBaseUrl', () => {
  it('returns the default URL in device_local mode', () => {
    setBridge({
      authorityMode: 'device_local',
      hubUrl: null,
      siteId: null,
      deviceId: null,
    });
    expect(resolveApiBaseUrl('http://localhost:8090')).toBe('http://localhost:8090');
  });

  it('returns the hubUrl in hub_client mode and strips a trailing slash', () => {
    setBridge({
      authorityMode: 'hub_client',
      hubUrl: 'http://hub.tienda.local:8090/',
      siteId: null,
      deviceId: null,
    });
    expect(resolveApiBaseUrl('http://localhost:8090')).toBe('http://hub.tienda.local:8090');
  });

  it('returns the default URL in hub_client mode when hubUrl is missing (operator misconfig)', () => {
    setBridge({
      authorityMode: 'hub_client',
      hubUrl: null,
      siteId: null,
      deviceId: null,
    });
    // Defensive: hub_client without a URL is an operator misconfig;
    // the renderer should still try the default rather than crash.
    expect(resolveApiBaseUrl('http://localhost:8090')).toBe('http://localhost:8090');
  });

  it('returns the default URL in site_hub mode (the hub IS the local server)', () => {
    setBridge({
      authorityMode: 'site_hub',
      hubUrl: null,
      siteId: null,
      deviceId: null,
    });
    expect(resolveApiBaseUrl('http://localhost:8090')).toBe('http://localhost:8090');
  });
});
