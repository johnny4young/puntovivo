/**
 * tRPC Client Configuration
 *
 * Configured tRPC client for Puntovivo web app
 */

import { createTRPCClient, httpBatchLink, splitLink, TRPCClientError } from '@trpc/client';
import { createTRPCReact } from '@trpc/react-query';
import type { AppRouter } from '@puntovivo/server';
import { getStoredSiteId } from '@/features/tenant/siteStorage';
import { DEVICE_ID_HEADER, generateUuid as generateCorrelationId } from './commandEnvelope';
import { getCachedDeviceIdSync } from './deviceId';
import { resolveApiBaseUrl } from './runtimeConfigClient';
import { isUnauthorizedAuthFailure } from '@/features/auth/authBootstrapFailure';
import {
  createHubApiFetch,
  isHubClientAuth,
  refreshHubSession,
} from '@/features/auth/hubAuthTransport';

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
// An identity handoff invalidates pending refresh effects. Token rotation within
// the same identity deliberately keeps this epoch so concurrent 401s still share
// one refresh; public credential installation/clear always starts a new epoch.
let authEpoch = 0;
let refreshRequest: {
  epoch: number;
  promise: Promise<string | null>;
  controller: AbortController;
} | null = null;
let authSessionExpiredHandler: (() => void) | null = null;

function getCsrfCookie(): string | null {
  const encodedName = `${CSRF_COOKIE_NAME}=`;
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
  const csrfToken = getCsrfCookie();
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

/** Capture a non-secret fence for optional work owned by the current identity. */
export function captureAuthSessionGuard(): () => boolean {
  const epoch = authEpoch;
  return () => !!accessToken && authEpoch === epoch;
}

/** Stop identity-owned work while retaining authority for the logout command. */
export function invalidateAuthSessionWork(): void {
  authEpoch += 1;
  refreshRequest?.controller.abort();
}

export function setAccessToken(token: string | null): void {
  invalidateAuthSessionWork();
  accessToken = token;
}

export function clearAccessToken(): void {
  setAccessToken(null);
}

export function setAuthSessionExpiredHandler(handler: (() => void) | null): void {
  authSessionExpiredHandler = handler;
}

/** Fail the active renderer session through the same path as an exhausted refresh. */
export function expireAuthSession(): void {
  clearAccessToken();
  authSessionExpiredHandler?.();
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
 * On rejected credentials or missing token the access token is cleared and the
 * `authSessionExpired` handler fires so the app can route to login. On success
 * the rotated token is re-registered with the desktop session singleton — a
 * no-op in pure-browser mode. Throttling, server outages and network failures
 * propagate without expiring the session or retrying automatically.
 */
async function requestAccessTokenRefresh(
  fetchImpl: typeof fetch,
  epoch: number
): Promise<string | null> {
  const isCurrent = () => epoch === authEpoch;
  if (!isCurrent()) return null;
  if (refreshRequest?.epoch === epoch) return refreshRequest.promise;
  const controller = new AbortController();

  const promise = (async () => {
    if (isHubClientAuth()) {
      try {
        const result = await refreshHubSession();
        if (!isCurrent()) return null;
        accessToken = result.token;
        await window.api?.session?.register?.(result.token);
        return isCurrent() ? result.token : null;
      } catch (error) {
        if (!isCurrent()) return null;
        if (!isUnauthorizedAuthFailure(error)) throw error;
        expireAuthSession();
        return null;
      }
    }

    const headers = new Headers({ 'content-type': 'application/json' });
    const csrfToken = getCsrfCookie();

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
      signal: controller.signal,
    });

    if (!isCurrent()) return null;
    if (response.status === 429 || response.status >= 500) {
      // A temporary refresh failure must not turn the original 401 into a
      // false session revocation. Propagate safe metadata, including the
      // server cooldown, without retrying a rotating credential automatically.
      throw TRPCClientError.from(
        {
          error: {
            code: response.status === 429 ? -32029 : -32603,
            message: 'Session verification unavailable.',
            data: {
              code: response.status === 429 ? 'TOO_MANY_REQUESTS' : 'INTERNAL_SERVER_ERROR',
              httpStatus: response.status,
            },
          },
        },
        { meta: { response } }
      );
    }
    if (!response.ok) {
      expireAuthSession();
      return null;
    }

    const payload = (await response.json()) as Array<{
      result?: {
        data?: {
          token?: string;
        };
      };
    }>;

    if (!isCurrent()) return null;
    const nextToken = payload[0]?.result?.data?.token;
    if (!nextToken) {
      expireAuthSession();
      return null;
    }

    accessToken = nextToken;
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
    return isCurrent() ? nextToken : null;
  })().finally(() => {
    // An older identity's completion must not clear the newer single flight.
    if (refreshRequest?.promise === promise) refreshRequest = null;
  });
  refreshRequest = { epoch, promise, controller };
  return promise;
}

function getDefaultApiFetch(): typeof fetch {
  return isHubClientAuth() ? createHubApiFetch() : fetch;
}

export function createTrpcFetch(fetchImpl: typeof fetch = getDefaultApiFetch()): typeof fetch {
  return async (input, init) => {
    const epoch = authEpoch;
    const response = await fetchImpl(input, {
      ...init,
      credentials: 'include',
    });

    if (response.status !== 401 || !accessToken || epoch !== authEpoch) {
      return response;
    }

    const requestUrl = input.toString();
    if (requestUrl === REFRESH_PATH || requestUrl.includes('/auth.login')) {
      return response;
    }

    const nextToken = await requestAccessTokenRefresh(fetchImpl, epoch);
    if (!nextToken || epoch !== authEpoch) {
      return response;
    }

    const retryHeaders = new Headers(init?.headers);
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
  fetchImpl: typeof fetch = getDefaultApiFetch()
): Promise<Response> {
  const headers = new Headers(init.headers);
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
        ...extraHeaders?.(),
      };
    },
  };
  const typedOptions = linkOptions as unknown as Parameters<typeof httpBatchLink<AppRouter>>[0];
  return splitLink<AppRouter>({
    // Return previews can carry up to 200 lines with lot and serial
    // allocations. Keep their read-only query semantics while using POST so
    // browser, proxy and Store Hub URL limits cannot truncate the selection.
    condition: operation => operation.path === 'sales.previewReturn',
    true: httpBatchLink<AppRouter>({ ...typedOptions, methodOverride: 'POST' }),
    false: httpBatchLink<AppRouter>(typedOptions),
  });
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
