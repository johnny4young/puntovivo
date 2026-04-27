/**
 * tRPC Client Configuration
 *
 * Configured tRPC client for Puntovivo web app
 */

import { createTRPCClient, httpBatchLink } from '@trpc/client';
import { createTRPCReact } from '@trpc/react-query';
import type { AppRouter } from '@puntovivo/server';
import { getStoredSiteId } from '@/features/tenant/siteStorage';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8090';
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

export function getTrpcHeaders(): Record<string, string> {
  const headers: Record<string, string> = {};
  const siteId = getStoredSiteId();
  const csrfToken = getCookieValue(CSRF_COOKIE_NAME);

  if (accessToken) {
    headers.authorization = `Bearer ${accessToken}`;
  }

  if (siteId) {
    headers['x-site-id'] = siteId;
  }

  if (csrfToken) {
    headers[CSRF_HEADER_NAME] = csrfToken;
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
    // ENG-025 — re-register the rotated token with the desktop
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

export function createTrpcBatchLink() {
  return httpBatchLink({
    url: `${API_URL}/api/trpc`,
    fetch: createTrpcFetch(),
    headers() {
      return getTrpcHeaders();
    },
  });
}

// React client for hooks
export const trpc = createTRPCReact<AppRouter>();

// Vanilla client for use outside React components
export const vanillaClient = createTRPCClient<AppRouter>({
  links: [createTrpcBatchLink()],
});
