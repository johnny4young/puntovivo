/**
 * tRPC Client Configuration
 *
 * Configured tRPC client for Puntovivo web app
 */

import { createTRPCClient, httpBatchLink } from '@trpc/client';
import { createTRPCReact } from '@trpc/react-query';
import type { AppRouter } from '@puntovivo/server';
import { getStoredSiteId } from '@/features/tenant/siteStorage';
import { DEVICE_ID_HEADER } from './commandEnvelope';
import { getCachedDeviceIdSync } from './deviceId';
import { resolveApiBaseUrl } from './runtimeConfigClient';

// `API_URL` is resolved through the runtime config client
// at module init. In `hub_client` mode the renderer points at the
// remote Store Hub URL (synchronous Electron IPC); otherwise it
// stays on the historical `VITE_API_URL` default. Computed once
// because the runtime config is immutable per ADR-0008.
const API_URL = resolveApiBaseUrl(import.meta.env.VITE_API_URL || 'http://localhost:8090');
const CSRF_COOKIE_NAME = 'puntovivo_csrf';
const CSRF_HEADER_NAME = 'x-csrf-token';
const REFRESH_PATH = `${API_URL}/api/trpc/auth.refresh?batch=1`;
let accessToken: string | null = null;
let refreshRequest: Promise<string | null> | null = null;
let authSessionExpiredHandler: (() => void) | null = null;

function getCookieValue(name: string): string | null {
  const encodedName = `${encodeURIComponent(name)}=`;
  const cookies = document.cookie.split(';');

  for (const cookie of cookies) {
    const trimmedCookie = cookie.trim();
    if (!trimmedCookie.startsWith(encodedName)) {
      continue;
    }

    return decodeURIComponent(trimmedCookie.slice(encodedName.length));
  }

  return null;
}

/**
 * renderer-minted correlation id, one per tRPC request.
 * Mirrors the server-side constant in
 * packages/server/src/observability/correlation.ts (the client does
 * not import server runtime modules, only the AppRouter type).
 */
const CORRELATION_ID_HEADER = 'x-correlation-id';

let lastCorrelationId: string | null = null;

/**
 * Mint a fresh correlation id. `crypto.randomUUID` exists in every
 * modern browser, the Electron renderer, and jsdom; the fallback
 * keeps ancient webviews working with a lower-entropy id that still
 * satisfies the server's `[A-Za-z0-9_-]{8,64}` intake.
 */
function generateCorrelationId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `cid-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

/**
 * The id attached to the MOST RECENT tRPC request from this page.
 * `captureRenderError` stamps it on client error events so the
 * renderer event and the server trace of the request that (most
 * likely) caused it share one identifier. Under concurrent in-flight
 * requests this is an approximation — documented in
 * docs/OBSERVABILITY.md. Null until the first request fires.
 */
export function getLastCorrelationId(): string | null {
  return lastCorrelationId;
}

/** Test-only: reset the per-page correlation state between cases. */
export function __resetCorrelationForTests(): void {
  lastCorrelationId = null;
}

/**
 * Assemble the per-request header set for every tRPC call: the bearer access
 * token, the selected `x-site-id`, the CSRF double-submit token read from the
 * cookie, the device id, and a freshly minted correlation id. Each header is
 * omitted when its source is unset, so anonymous / pre-registration requests
 * stay valid (the correlation id is always present — it has no precondition).
 */
export function getTrpcHeaders(): Record<string, string> {
  const headers: Record<string, string> = {};
  const siteId = getStoredSiteId();
  const csrfToken = getCookieValue(CSRF_COOKIE_NAME);
  const deviceId = getCachedDeviceIdSync();

  // a NEW id per request: the server adopts it (after
  // strict sanitization) into its request-scoped logs, tracing
  // middleware attrs, and sink events.
  const correlationId = generateCorrelationId();
  lastCorrelationId = correlationId;
  headers[CORRELATION_ID_HEADER] = correlationId;

  if (accessToken) {
    headers.authorization = `Bearer ${accessToken}`;
  }

  if (siteId) {
    headers['x-site-id'] = siteId;
  }

  if (csrfToken) {
    headers[CSRF_HEADER_NAME] = csrfToken;
  }

  // every request that runs after device registration
  // ships the id; the server only enforces it on procedures wrapped
  // with `criticalCommandProcedure` (ADR-0002), so unwrapped reads
  // and catalog mutations stay unaffected by an unset id.
  if (deviceId) {
    headers[DEVICE_ID_HEADER] = deviceId;
  }

  return headers;
}

export function setAccessToken(token: string): void {
  accessToken = token;
}

export function clearAccessToken(): void {
  accessToken = null;
}

export function setAuthSessionExpiredHandler(handler: (() => void) | null): void {
  authSessionExpiredHandler = handler;
}

function notifyAuthSessionExpired(): void {
  authSessionExpiredHandler?.();
}

function buildHeaders(init?: HeadersInit): Headers {
  return new Headers(init);
}

/**
 * Single-flight access-token refresh against `auth.refresh`.
 *
 * Concurrent 401s (a page firing several queries at once) must NOT each POST a
 * refresh — the rotating refresh cookie would invalidate the in-flight peers.
 * The pending promise is cached in `refreshRequest` so every caller awaits the
 * same round-trip; the `.finally` clears it once settled so the next genuine
 * expiry refreshes again.
 *
 * On failure (non-2xx or missing token) the access token is cleared and the
 * `authSessionExpired` handler fires so the app can route to login. On success
 * the rotated token is re-registered with the desktop session singleton — a
 * no-op in pure-browser mode ().
 */
async function requestAccessTokenRefresh(fetchImpl: typeof fetch): Promise<string | null> {
  if (refreshRequest) {
    return refreshRequest;
  }

  refreshRequest = (async () => {
    const headers = buildHeaders({ 'content-type': 'application/json' });
    const csrfToken = getCookieValue(CSRF_COOKIE_NAME);

    if (csrfToken) {
      headers.set(CSRF_HEADER_NAME, csrfToken);
    }

    // the refresh round-trip builds its headers manually
    // (it bypasses getTrpcHeaders), so mint its correlation id here;
    // a failing refresh is exactly the kind of trace support needs
    // to find from a renderer auth error.
    const correlationId = generateCorrelationId();
    lastCorrelationId = correlationId;
    headers.set(CORRELATION_ID_HEADER, correlationId);

    const response = await fetchImpl(REFRESH_PATH, {
      method: 'POST',
      credentials: 'include',
      headers,
      body: '{}',
    });

    if (!response.ok) {
      clearAccessToken();
      notifyAuthSessionExpired();
      return null;
    }

    const payload = (await response.json()) as Array<{
      result?: {
        data?: {
          token?: string;
        };
      };
    }>;

    const nextToken = payload[0]?.result?.data?.token ?? null;
    if (!nextToken) {
      clearAccessToken();
      notifyAuthSessionExpired();
      return null;
    }

    setAccessToken(nextToken);
    // re-register the rotated token with the desktop
    // session singleton so the IPC bridge keeps validating against
    // the current sessionVersion. No-op in pure-browser mode. A
    // failure here means the bridge handlers will throw
    // SESSION_NOT_REGISTERED on the next call; tRPC itself keeps
    // working with the new token.
    try {
      await window.api?.session?.register?.(nextToken);
    } catch (registerErr) {
      console.warn('Desktop session re-register failed after refresh:', registerErr);
    }
    return nextToken;
  })().finally(() => {
    refreshRequest = null;
  });

  return refreshRequest;
}

export function createTrpcFetch(fetchImpl: typeof fetch = fetch): typeof fetch {
  return async (input, init) => {
    const response = await fetchImpl(input, {
      ...init,
      credentials: 'include',
    });

    if (response.status !== 401 || !accessToken) {
      return response;
    }

    const requestUrl = typeof input === 'string' ? input : input.toString();
    if (requestUrl === REFRESH_PATH || requestUrl.includes('/auth.login')) {
      return response;
    }

    const nextToken = await requestAccessTokenRefresh(fetchImpl);
    if (!nextToken) {
      return response;
    }

    const retryHeaders = buildHeaders(init?.headers);
    retryHeaders.set('authorization', `Bearer ${nextToken}`);

    return fetchImpl(input, {
      ...init,
      credentials: 'include',
      headers: retryHeaders,
    });
  };
}

/**
 * Authenticated same-authority fetch for server-built binary artifacts.
 * Reuses the tRPC bearer/refresh transport so a PDF download cannot diverge
 * from the active renderer session or silently fail at the 15-minute boundary.
 */
export function fetchProtectedApi(
  path: `/api/${string}`,
  init: RequestInit = {},
  fetchImpl: typeof fetch = fetch
): Promise<Response> {
  const headers = buildHeaders(init.headers);
  for (const [name, value] of Object.entries(getTrpcHeaders())) {
    headers.set(name, value);
  }
  return createTrpcFetch(fetchImpl)(`${API_URL}${path}`, { ...init, headers });
}

type HeaderFactory = () => Record<string, string>;

export function createTrpcBatchLink(extraHeaders?: HeaderFactory) {
  // tRPC's `FetchEsque` accepts `RequestInitEsque` where
  // `signal?: AbortSignal | undefined`; the lib DOM `RequestInit.signal`
  // is `AbortSignal | null`. Under exactOptionalPropertyTypes these are
  // not bidirectionally assignable, so route through `unknown` at the
  // options object boundary (single contained cast — no `as any` leak).
  const linkOptions = {
    url: `${API_URL}/api/trpc`,
    fetch: createTrpcFetch(),
    headers() {
      return {
        ...getTrpcHeaders(),
        ...(extraHeaders?.() ?? {}),
      };
    },
  };
  return httpBatchLink(linkOptions as unknown as Parameters<typeof httpBatchLink>[0]);
}

export function createTrpcClientWithHeaders(headers: Record<string, string>) {
  return createTRPCClient<AppRouter>({
    links: [createTrpcBatchLink(() => headers)],
  });
}

// React client for hooks
export const trpc = createTRPCReact<AppRouter>();

// Vanilla client for use outside React components
export const vanillaClient = createTRPCClient<AppRouter>({
  links: [createTrpcBatchLink()],
});
