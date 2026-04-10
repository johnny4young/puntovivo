/**
 * tRPC Client Configuration
 *
 * Configured tRPC client for Open Yojob web app
 */

import { createTRPCClient, httpBatchLink } from '@trpc/client';
import { createTRPCReact } from '@trpc/react-query';
import type { AppRouter } from '@open-yojob/server';
import { getStoredSiteId } from '@/features/tenant/siteStorage';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8090';
const CSRF_COOKIE_NAME = 'open_yojob_csrf';
const CSRF_HEADER_NAME = 'x-csrf-token';
let accessToken: string | null = null;

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

// React client for hooks
export const trpc = createTRPCReact<AppRouter>();

// Vanilla client for use outside React components
export const vanillaClient = createTRPCClient<AppRouter>({
  links: [
    httpBatchLink({
      url: `${API_URL}/api/trpc`,
      fetch(url, options) {
        return fetch(url, {
          ...options,
          credentials: 'include',
        });
      },
      headers() {
        return getTrpcHeaders();
      },
    }),
  ],
});
