/**
 * HTTP plugin + security-hook registration.
 *
 * Registers, in the exact boot-critical order createServer ran them
 * inline: helmet (CSP) -> cors -> cookie -> jwt -> the request-scoped
 * logger onRequest hook -> the CSRF onRequest hook -> the global
 * rate-limit -> the SSE plugin. The ordering is load-bearing (the CSRF
 * hook must see the cookie plugin's parsed cookies; the logger hook must
 * run before any /api/ work), so this function must not be reordered.
 *
 * @module server/plugins
 */

import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import jwt from '@fastify/jwt';
import type { FastifyInstance } from 'fastify';
import { CORRELATION_ID_HEADER } from '../observability/index.js';
import { ssePlugin } from '../realtime/sse.js';
import { REFRESH_COOKIE_NAME } from '../security/authTokens.js';
import {
  CSRF_HEADER_NAME,
  csrfTokensMatch,
  ensureCsrfCookie,
  getCsrfHeader,
  isUnsafeMethod,
} from '../security/csrf.js';
import { buildRequestScopedLogger } from './request-logger.js';

/** Inputs the HTTP plugin stack needs from the resolved server config. */
export interface RegisterHttpPluginsOptions {
  /** Resolved CORS allow-list (already extended with LAN origins under site_hub). */
  effectiveCorsOrigins: string[];
  /** Effective JWT secret for the @fastify/jwt signer. */
  jwtSecret: string;
}

/**
 * Register the third-party HTTP plugins + the two onRequest security
 * hooks on `app`, in the boot-critical order. Mutates `app`; returns
 * once every plugin has registered.
 */
export async function registerHttpPlugins(
  app: FastifyInstance,
  { effectiveCorsOrigins, jwtSecret }: RegisterHttpPluginsOptions
): Promise<void> {
  // security headers. helmet ships sane defaults for
  // X-Frame-Options (DENY), X-Content-Type-Options (nosniff),
  // Referrer-Policy (no-referrer), Cross-Origin-Resource-Policy, etc.
  // The CSP is overridden so the renderer (web + Electron) can pull
  // Google Fonts and the Vite dev server can inject HMR scripts in
  // development. The renderer additionally mirrors the same CSP at the
  // HTML <meta http-equiv> level so static-host deployments keep the
  // policy even when an upstream CDN strips response headers.
  const isProduction = process.env.NODE_ENV === 'production';
  await app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        // 'data:' images cover receipt previews + chart sprites; blob:
        // covers OCR upload thumbnails. Both are same-origin payloads.
        imgSrc: ["'self'", 'data:', 'blob:'],
        styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
        fontSrc: ["'self'", 'https://fonts.gstatic.com', 'data:'],
        connectSrc: ["'self'"],
        // Dev / Electron renderer keeps inline + eval because Vite HMR
        // and React DevTools inject inline scripts. Production locks the
        // policy down to same-origin scripts; bundled assets all sit
        // under '/'.
        scriptSrc: isProduction ? ["'self'"] : ["'self'", "'unsafe-inline'", "'unsafe-eval'"],
        frameAncestors: ["'none'"],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
      },
    },
    // Strict-Transport-Security is left off for the Electron-loopback
    // deployment (HTTP on 127.0.0.1) so a misconfigured browser cannot
    // pin a missing-HTTPS upgrade across sessions. Hosted deployments
    // re-enable HSTS at the CDN tier where TLS is terminated.
    strictTransportSecurity: false,
    // Cross-origin embedder policy would block the OCR pipeline (data:
    // URLs sourced from the renderer's File input). Re-enable when the
    // renderer migrates to module workers — captured in .
    crossOriginEmbedderPolicy: false,
    crossOriginResourcePolicy: { policy: 'same-origin' },
    referrerPolicy: { policy: 'no-referrer' },
    // CSP already pins `frame-ancestors 'none'`; X-Frame-Options is the
    // legacy-browser fallback. DENY matches the audit's exact ask.
    frameguard: { action: 'deny' },
  });

  // Register CORS
  await app.register(cors, {
    origin: effectiveCorsOrigins,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'x-site-id',
      CSRF_HEADER_NAME,
      // Command Envelope (ADR-0002) headers.
      'x-device-id',
      'x-puntovivo-envelope',
      // renderer-minted correlation id; the allowlist is
      // explicit (not reflective), so without this entry the browser
      // preflight strips the header silently.
      CORRELATION_ID_HEADER,
    ],
    credentials: true,
  });

  await app.register(cookie);

  // Register JWT
  await app.register(jwt, {
    secret: jwtSecret,
    sign: {
      expiresIn: '7d',
    },
  });

  // request-scoped child logger so every log line emitted
  // during a request carries `requestId` (Fastify reqId) plus the
  // best-effort `deviceId` from the Command Envelope header. The
  // tenant + user ids are NOT yet known here (auth runs later in the
  // tRPC layer) — `commandEnvelope` adds them when it has the
  // resolved context. The hook is intentionally cheap (string read +
  // child(), no DB calls) so non-/api/ routes stay unaffected.
  app.addHook('onRequest', async request => {
    request.log = buildRequestScopedLogger(request);
  });

  app.addHook('onRequest', async (request, reply) => {
    if (!request.url.startsWith('/api/')) {
      return;
    }

    const csrfToken = ensureCsrfCookie(request, reply);
    const hasRefreshCookie = typeof request.cookies[REFRESH_COOKIE_NAME] === 'string';

    if (!hasRefreshCookie || !isUnsafeMethod(request.method)) {
      return;
    }

    const csrfHeader = getCsrfHeader(request);
    if (csrfTokensMatch(csrfHeader, csrfToken)) {
      return;
    }

    // follow-up — reply with a tRPC-shaped error envelope so
    // the web client surfaces the real message instead of the cryptic
    // 'Unable to transform response from server' it produced for the
    // previous plain {error,message} body (the hook answers before the
    // tRPC handler, so the shape must be hand-built; -32003 is the
    // JSON-RPC code tRPC v11 assigns to FORBIDDEN). The stable
    // CSRF_VALIDATION_FAILED token stays grep-able in the message.
    reply.code(403).send({
      error: {
        message: 'CSRF_VALIDATION_FAILED: missing or invalid CSRF token',
        code: -32003,
        data: { code: 'FORBIDDEN', httpStatus: 403 },
      },
    });
  });

  // vector 2 — global rate-limit on every HTTP surface
  // (tRPC, SSE, /api/health). Previously registered with
  // `global: false`, which meant nothing on the wire was throttled —
  // `auth.refresh`, `auth.changePassword`, and every mutation were
  // open to brute-force. Switched to global: true with a generous
  // 100/min/IP cap; the fastify-trpc plugin registers a single
  // wildcard route (`/api/trpc/:path`) so per-procedure distinction
  // is not possible at the Fastify level — the cap is uniform and
  // intentionally permissive to leave normal session traffic
  // untouched while still catching brute-force.
  //
  // `auth.login` keeps its custom DB-backed dual bucket from
  // `loginRateLimit.ts` (per-IP 10/60s + per-username 5/15min), which
  // stays stricter for failed-login traffic. The global bucket still
  // caps aggregate login traffic, matching every other HTTP route
  // until 's per-procedure follow-up lands.
  //
  // Per-procedure stricter buckets (e.g. `auth.changePassword`
  // tightened to 5/15min) need a tRPC-layer middleware similar to
  // `loginRateLimit.ts`. Captured as a follow-up; the 100/min cap
  // closes the bulk of the original rate-limit finding.
  const rateLimit = await import('@fastify/rate-limit');
  const globalRateLimitMax = Number.parseInt(process.env.PUNTOVIVO_GLOBAL_RATE_LIMIT_MAX ?? '', 10);
  await app.register(rateLimit.default, {
    global: true,
    max: Number.isFinite(globalRateLimitMax) && globalRateLimitMax > 0 ? globalRateLimitMax : 100,
    timeWindow: '1 minute',
  });

  // Register SSE plugin
  await app.register(ssePlugin, { corsOrigins: effectiveCorsOrigins });
}
