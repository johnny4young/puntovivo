/**
 * ENG-074 — Renderer-side Authority Node runtime config client.
 *
 * Resolves `{authorityMode, hubUrl, siteId, deviceId}` synchronously
 * at module init so `lib/trpc.ts` can pick the right tRPC base URL
 * before the tRPC client is constructed. Three sources, in order:
 *
 *   1. Electron preload sync IPC (`window.electron.runtime.getConfigSync`).
 *      Available when the renderer ships inside the desktop binary.
 *      The handler reads the once-cached `resolveRuntimeConfig` result
 *      from the main process and returns it via `event.returnValue`.
 *
 *   2. Web-standalone fallback. When `window.electron` is absent (the
 *      pure-web build, dev:web target, or any non-Electron host), the
 *      client returns the historical `device_local + null hubUrl`
 *      shape so the existing build behavior is preserved.
 *
 *   3. IPC failure fallback. If the Electron bridge is present but the
 *      sync call throws (preload race, malformed IPC payload), the
 *      client logs a warning and returns the same `device_local`
 *      shape rather than crashing module init.
 *
 * The result is cached for the page lifetime — runtime config is
 * immutable per ADR-0008 (env vars do not change after Electron
 * boot).
 *
 * @module lib/runtimeConfigClient
 */

export type AuthorityMode = 'device_local' | 'site_hub' | 'hub_client';

export interface RendererRuntimeConfig {
  authorityMode: AuthorityMode;
  hubUrl: string | null;
  siteId: string | null;
  deviceId: string | null;
}

const DEVICE_LOCAL_DEFAULT: RendererRuntimeConfig = {
  authorityMode: 'device_local',
  hubUrl: null,
  siteId: null,
  deviceId: null,
};

interface ElectronRuntimeBridge {
  getConfigSync: () => RendererRuntimeConfig | null | undefined;
}

interface ElectronGlobal {
  runtime?: ElectronRuntimeBridge;
}

function readBridgeConfig(): RendererRuntimeConfig | null {
  if (typeof window === 'undefined') return null;
  const electron = (window as unknown as { electron?: ElectronGlobal }).electron;
  const bridge = electron?.runtime;
  if (!bridge?.getConfigSync) return null;
  try {
    const raw = bridge.getConfigSync();
    if (!raw || typeof raw !== 'object') return null;
    if (
      raw.authorityMode !== 'device_local' &&
      raw.authorityMode !== 'site_hub' &&
      raw.authorityMode !== 'hub_client'
    ) {
      return null;
    }
    return {
      authorityMode: raw.authorityMode,
      hubUrl: typeof raw.hubUrl === 'string' && raw.hubUrl.length > 0 ? raw.hubUrl : null,
      siteId: typeof raw.siteId === 'string' && raw.siteId.length > 0 ? raw.siteId : null,
      deviceId:
        typeof raw.deviceId === 'string' && raw.deviceId.length > 0 ? raw.deviceId : null,
    };
  } catch (err) {
    console.warn('[runtime-config] Electron bridge sync read failed; falling back to device_local:', err);
    return null;
  }
}

let cached: RendererRuntimeConfig | null = null;

/**
 * Returns the resolved runtime config. Synchronous so callers
 * (notably `lib/trpc.ts`) can pick a base URL at module init.
 */
export function getRuntimeConfigSync(): RendererRuntimeConfig {
  if (cached) return cached;
  cached = readBridgeConfig() ?? { ...DEVICE_LOCAL_DEFAULT };
  return cached;
}

/**
 * Returns the API base URL the renderer should target. For
 * `hub_client` with a configured `hubUrl`, returns that URL stripped
 * of any trailing slash. For `device_local` / `site_hub`, returns the
 * `defaultUrl` argument (caller passes the existing
 * `VITE_API_URL`-derived default).
 */
export function resolveApiBaseUrl(defaultUrl: string): string {
  const cfg = getRuntimeConfigSync();
  if (cfg.authorityMode === 'hub_client' && cfg.hubUrl) {
    return cfg.hubUrl.replace(/\/+$/, '');
  }
  return defaultUrl;
}

/**
 * Test-only escape hatch. Resets the cached config so a unit test
 * can re-resolve under a different `window.electron` shape. Never
 * called from production code paths.
 */
export function __resetRuntimeConfigCacheForTests(): void {
  cached = null;
}
