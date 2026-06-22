/**
 * Pre-Fastify server configuration resolution.
 *
 * Runs before the Fastify instance is built: the ENG-169 verbose-prod
 * refusal, JWT-secret resolution (explicit vs auto-generated), the
 * ENG-072 Authority Node runtime resolution + bind host/port, the
 * ENG-073 site_hub LAN-bind hardening, and the effective CORS allow-list.
 * Owns the `setActiveRuntimeConfig` side effect, exactly where it ran
 * inline in createServer.
 *
 * @module server/config
 */

import { setActiveRuntimeConfig, type RuntimeConfig } from '../config/runtime.js';
import { createModuleLogger } from '../logging/logger.js';
import {
  describeSiteHubJwtSecretRequirement,
  generateSecret,
  getSiteHubJwtSecretPolicyFailures,
} from './jwt-secret.js';
import type { ServerOptions } from './types.js';

/**
 * The resolved boot configuration createServer threads into the Fastify
 * instance + plugin registration. Every field is derived from
 * `ServerOptions` (and, for `resolvedRuntime`, the Authority Node
 * defaults); `setActiveRuntimeConfig` has already been called with
 * `resolvedRuntime` by the time this is returned.
 */
export interface ResolvedServerConfig {
  /** Effective JWT secret (explicit when supplied, else auto-generated). */
  jwtSecret: string;
  /** Resolved Authority Node runtime (explicit or synthesized device_local). */
  resolvedRuntime: RuntimeConfig;
  /** Host the server will bind to (runtime wins over the legacy host option). */
  bindHost: string;
  /** Port the server will bind to (runtime wins over the legacy port option). */
  bindPort: number;
  /** CORS allow-list (extended with LAN origins under site_hub). */
  effectiveCorsOrigins: string[];
}

/**
 * Resolve and validate the pre-Fastify configuration. Throws on a
 * verbose-prod boot without the override and on a misconfigured
 * site_hub; otherwise returns the bundle createServer wires into Fastify.
 */
export function resolveServerConfig(options: ServerOptions): ResolvedServerConfig {
  const {
    port = 8090,
    host = '127.0.0.1',
    jwtSecret: explicitJwtSecret,
    verbose = false,
    corsOrigins = [
      'http://localhost:3000',
      'http://localhost:5173',
      'http://127.0.0.1:3000',
      'http://127.0.0.1:5173',
    ],
    runtime,
  } = options;

  // ENG-169 — refuse to start a production server with verbose logging
  // unless the operator opts in explicitly. Verbose mode attaches the
  // full pino instance to every request (headers + bodies), which is a
  // dev convenience but a data-leak + throughput cost in production. The
  // PUNTOVIVO_ALLOW_VERBOSE_PROD escape hatch exists for deliberate prod
  // debugging and logs a structured warning when it fires.
  if (verbose && process.env.NODE_ENV === 'production') {
    if (process.env.PUNTOVIVO_ALLOW_VERBOSE_PROD !== '1') {
      throw new Error(
        '[runtime-config] Refusing to start: verbose logging is enabled while NODE_ENV=production. ' +
          'Verbose mode logs request-level detail and is unsafe for production. ' +
          'Unset VERBOSE (or pass verbose:false), or set PUNTOVIVO_ALLOW_VERBOSE_PROD=1 to override deliberately.'
      );
    }
    createModuleLogger('server').warn(
      { override: 'PUNTOVIVO_ALLOW_VERBOSE_PROD' },
      'verbose logging is enabled in production via explicit override'
    );
  }

  // ENG-073 — track whether the operator explicitly supplied the
  // JWT secret. Auto-generated secrets reset on every restart, which
  // is fine on a single device_local cashier (the operator just logs
  // back in once after a desktop relaunch) but unacceptable on a
  // site_hub (every cashier in the store loses their session). The
  // LAN guard below uses this flag to refuse a misconfigured hub
  // boot.
  const normalizedExplicitJwtSecret =
    typeof explicitJwtSecret === 'string' ? explicitJwtSecret.trim() : undefined;
  const jwtSecretWasExplicit =
    normalizedExplicitJwtSecret !== undefined && normalizedExplicitJwtSecret.length > 0;
  const jwtSecret = jwtSecretWasExplicit ? normalizedExplicitJwtSecret : generateSecret();

  // ENG-072 — resolve the Authority Node runtime config. Explicit
  // option wins; otherwise synthesize a `device_local` runtime from
  // the host/port options so callers that predate the runtime field
  // (existing tests, internal tooling) keep working without change.
  const resolvedRuntime: RuntimeConfig = runtime ?? {
    authorityMode: 'device_local',
    bindHost: host,
    bindPort: port,
    hubUrl: null,
    siteId: null,
    deviceId: null,
    allowedLanOrigins: [],
  };
  setActiveRuntimeConfig(resolvedRuntime);
  // Honor the runtime config's bind host/port over the legacy options
  // when an explicit runtime is supplied. Tests passing only host/port
  // hit the synthesized runtime branch above, so this assignment is a
  // no-op for them.
  const bindHost = runtime ? resolvedRuntime.bindHost : host;
  const bindPort = runtime ? resolvedRuntime.bindPort : port;

  // ENG-073 — Store Hub LAN bind hardening. When the operator opts
  // into `site_hub` mode the embedded Fastify becomes reachable to
  // every cashier terminal on the LAN, which widens the trust
  // surface beyond the loopback default. Refuse the boot when:
  //   - JWT_SECRET was not supplied explicitly OR does not meet the
  //     Store Hub strength policy (auto-generated or weak secrets
  //     reset/break cashier sessions or make LAN tokens guessable), OR
  //   - allowedLanOrigins is empty (no operator-defined CORS
  //     surface; we never accept arbitrary origins on a hub).
  // device_local and hub_client modes skip this check — the former
  // is loopback-only, the latter only consumes a remote hub and
  // does not accept LAN traffic on its own.
  if (resolvedRuntime.authorityMode === 'site_hub') {
    const missing: string[] = [];
    const jwtSecretFailures = getSiteHubJwtSecretPolicyFailures(
      jwtSecretWasExplicit ? jwtSecret : undefined
    );
    if (jwtSecretFailures.length > 0) {
      missing.push(describeSiteHubJwtSecretRequirement(jwtSecretFailures));
    }
    if (resolvedRuntime.allowedLanOrigins.length === 0) {
      missing.push('PUNTOVIVO_ALLOWED_LAN_ORIGINS');
    }
    if (missing.length > 0) {
      throw new Error(
        `[runtime-config] site_hub mode requires explicit ` +
          `${missing.join(' and ')}. ` +
          `See docs/AUTHORITY-NODE.md > Store Hub Mode for the operator setup.`
      );
    }
  }

  // ENG-073 — extend the CORS allow-list with operator-configured
  // LAN origins when in site_hub mode. The default dev origins stay
  // intact so an operator setting up a hub can still load the
  // renderer from `localhost:3000` while bringing the LAN
  // configuration online. device_local and hub_client modes leave
  // the list untouched.
  const effectiveCorsOrigins =
    resolvedRuntime.authorityMode === 'site_hub'
      ? Array.from(new Set([...corsOrigins, ...resolvedRuntime.allowedLanOrigins]))
      : corsOrigins;

  return { jwtSecret, resolvedRuntime, bindHost, bindPort, effectiveCorsOrigins };
}
