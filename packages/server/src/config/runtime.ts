/**
 * ENG-072 — Authority Node runtime config resolver.
 *
 * Resolves the local runtime configuration that selects which Authority
 * Node mode the boot is running under. The default is `device_local`,
 * matching every existing install before this ticket. `site_hub` and
 * `hub_client` modes are accepted by the resolver here so the type
 * surface is complete; their actual behavior (LAN bind, hub URL plumbing,
 * pairing) lands in ENG-073 and ENG-074.
 *
 * Pure function — no side effects, no env mutation, no logging. Callers
 * resolve once at boot and pass the result into `createServer`.
 *
 * See [docs/AUTHORITY-NODE.md](../../../docs/AUTHORITY-NODE.md) for the
 * vocabulary and [docs/architecture/0008-authority-node-runtime-modes.md](../../../docs/architecture/0008-authority-node-runtime-modes.md)
 * for the ADR.
 *
 * @module config/runtime
 */

/**
 * Authority Node runtime mode per ADR-0008. The name is inclusive: it
 * covers all three runtime shapes a Puntovivo install can take, even
 * though `hub_client` is technically a UI terminal pointing at a
 * `site_hub` and not an Authority Node itself.
 */
export type AuthorityMode = 'device_local' | 'site_hub' | 'hub_client';

/**
 * Resolved runtime config. Fixed at boot. Read by the diagnostics
 * export and the boot banner; future ENG-073..075 layers will read it
 * to decide LAN binding, CORS allowlists, and pairing flows.
 */
export interface RuntimeConfig {
  /** Authority mode per ADR-0008. */
  authorityMode: AuthorityMode;
  /** Bind host for the embedded Fastify server. */
  bindHost: string;
  /** Bind port for the embedded Fastify server. */
  bindPort: number;
  /** Hub URL when `authorityMode === 'hub_client'`; `null` otherwise. */
  hubUrl: string | null;
  /** Operator-supplied site identifier; `null` to derive from the database. */
  siteId: string | null;
  /** Operator-supplied device identifier; `null` to derive from `device-id.txt`. */
  deviceId: string | null;
  /** LAN origins allowed by CORS when `authorityMode === 'site_hub'`. */
  allowedLanOrigins: string[];
}

/** Closed list of valid authority modes for runtime validation. */
export const VALID_AUTHORITY_MODES: readonly AuthorityMode[] = [
  'device_local',
  'site_hub',
  'hub_client',
] as const;

const FALLBACK_DEFAULTS: RuntimeConfig = {
  authorityMode: 'device_local',
  bindHost: '127.0.0.1',
  bindPort: 8090,
  hubUrl: null,
  siteId: null,
  deviceId: null,
  allowedLanOrigins: [],
};

/**
 * Returns a fresh copy of the fallback defaults — pure, safe to mutate
 * by the caller without affecting the constant.
 */
export function getRuntimeDefaults(): RuntimeConfig {
  return { ...FALLBACK_DEFAULTS, allowedLanOrigins: [] };
}

function isAuthorityMode(value: unknown): value is AuthorityMode {
  return (
    typeof value === 'string' &&
    (VALID_AUTHORITY_MODES as readonly string[]).includes(value)
  );
}

function readTrimmed(env: NodeJS.ProcessEnv, key: string): string | undefined {
  const raw = env[key];
  if (typeof raw !== 'string') return undefined;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export interface ResolveRuntimeConfigOptions {
  /** Env source to read from. Defaults to `process.env`. */
  env?: NodeJS.ProcessEnv;
  /**
   * Caller-supplied defaults. Used when env vars are absent. Explicit
   * env vars always override these.
   */
  defaults?: Partial<RuntimeConfig>;
}

/**
 * Resolve the runtime config from env vars + caller defaults.
 *
 * Env precedence:
 *   1. `PUNTOVIVO_*` vars (preferred, explicit prefix).
 *   2. Legacy `HOST` / `PORT` for bind host/port (kept for existing
 *      standalone deployments — the standalone server has read these
 *      since day one).
 *   3. Caller-supplied `defaults`.
 *   4. `FALLBACK_DEFAULTS` (`device_local` + `127.0.0.1` + `8090`).
 *
 * Throws when:
 *   - `PUNTOVIVO_AUTHORITY_MODE` is set to a value outside
 *     {`device_local`, `site_hub`, `hub_client`}.
 *   - The resolved bind port is not a finite integer in `[1, 65535]`.
 *
 * Fail-fast behavior is intentional: a misconfigured boot should crash
 * the server with an actionable error message instead of silently
 * falling back to defaults.
 */
export function resolveRuntimeConfig(
  options: ResolveRuntimeConfigOptions = {}
): RuntimeConfig {
  const env = options.env ?? process.env;
  const merged: RuntimeConfig = {
    ...FALLBACK_DEFAULTS,
    ...options.defaults,
    allowedLanOrigins:
      options.defaults?.allowedLanOrigins ?? [...FALLBACK_DEFAULTS.allowedLanOrigins],
  };

  const rawMode = readTrimmed(env, 'PUNTOVIVO_AUTHORITY_MODE');
  if (rawMode !== undefined) {
    if (!isAuthorityMode(rawMode)) {
      throw new Error(
        `[runtime-config] Invalid PUNTOVIVO_AUTHORITY_MODE='${rawMode}'. ` +
          `Valid values: ${VALID_AUTHORITY_MODES.join(', ')}`
      );
    }
    merged.authorityMode = rawMode;
  }

  const rawBindHost = readTrimmed(env, 'PUNTOVIVO_BIND_HOST') ?? readTrimmed(env, 'HOST');
  if (rawBindHost !== undefined) {
    merged.bindHost = rawBindHost;
  }

  const rawBindPort = readTrimmed(env, 'PUNTOVIVO_BIND_PORT') ?? readTrimmed(env, 'PORT');
  if (rawBindPort !== undefined) {
    if (!/^\d+$/.test(rawBindPort)) {
      throw new Error(
        `[runtime-config] Invalid bind port '${rawBindPort}'. Expected integer in [1, 65535].`
      );
    }
    const parsed = Number.parseInt(rawBindPort, 10);
    if (!Number.isFinite(parsed) || parsed < 1 || parsed > 65535) {
      throw new Error(
        `[runtime-config] Invalid bind port '${rawBindPort}'. Expected integer in [1, 65535].`
      );
    }
    merged.bindPort = parsed;
  }

  const rawHubUrl = readTrimmed(env, 'PUNTOVIVO_HUB_URL');
  if (rawHubUrl !== undefined) {
    merged.hubUrl = rawHubUrl;
  }

  const rawSiteId = readTrimmed(env, 'PUNTOVIVO_SITE_ID');
  if (rawSiteId !== undefined) {
    merged.siteId = rawSiteId;
  }

  const rawDeviceId = readTrimmed(env, 'PUNTOVIVO_DEVICE_ID');
  if (rawDeviceId !== undefined) {
    merged.deviceId = rawDeviceId;
  }

  const rawOrigins = readTrimmed(env, 'PUNTOVIVO_ALLOWED_LAN_ORIGINS');
  if (rawOrigins !== undefined) {
    merged.allowedLanOrigins = rawOrigins
      .split(',')
      .map(s => s.trim())
      .filter(s => s.length > 0);
  }

  return merged;
}

// --- Active singleton ---------------------------------------------------
//
// `createServer` calls `setActiveRuntimeConfig(...)` once at boot so any
// downstream module (diagnostics router, future request hooks) can read
// the config without threading it through every function signature.
//
// Tests that run multiple `createServer` instances in the same process
// (uncommon) will each overwrite the singleton — by design, since one
// process can only host one runtime at a time. Tests that need an
// independent runtime should call `clearActiveRuntimeConfig()` between
// instances.

let activeRuntimeConfig: RuntimeConfig | null = null;

export function setActiveRuntimeConfig(config: RuntimeConfig): void {
  activeRuntimeConfig = config;
}

/**
 * Returns the active runtime config. Falls back to defaults when
 * called before `setActiveRuntimeConfig` (e.g. tests that exercise a
 * router directly without booting the full server). The fallback is
 * defensive — production callers always boot through `createServer`,
 * which sets the singleton.
 */
export function getActiveRuntimeConfig(): RuntimeConfig {
  if (activeRuntimeConfig === null) {
    return getRuntimeDefaults();
  }
  return activeRuntimeConfig;
}

export function clearActiveRuntimeConfig(): void {
  activeRuntimeConfig = null;
}
