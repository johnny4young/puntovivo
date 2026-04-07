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

export function getTrpcHeaders(): Record<string, string> {
  const headers: Record<string, string> = {};
  const token = localStorage.getItem('auth_token');
  const siteId = getStoredSiteId();

  if (token) {
    headers.authorization = `Bearer ${token}`;
  }

  if (siteId) {
    headers['x-site-id'] = siteId;
  }

  return headers;
}

// React client for hooks
export const trpc = createTRPCReact<AppRouter>();

// Vanilla client for use outside React components
export const vanillaClient = createTRPCClient<AppRouter>({
  links: [
    httpBatchLink({
      url: `${API_URL}/api/trpc`,
      headers() {
        return getTrpcHeaders();
      },
    }),
  ],
});
