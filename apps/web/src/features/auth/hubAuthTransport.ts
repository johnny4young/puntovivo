import { getRuntimeConfigSync } from '@/lib/runtimeConfigClient';
import type { HubAccessGrant, HubAuthIpcResult, SessionAPI } from '@/types/electron';

function hubSessionApi(): SessionAPI | null {
  if (getRuntimeConfigSync().authorityMode !== 'hub_client') return null;
  return window.api?.session ?? window.session ?? null;
}

async function requestBodyText(
  input: RequestInfo | URL,
  init?: RequestInit
): Promise<string | undefined> {
  const body = init?.body;
  if (body === undefined || body === null) {
    return input instanceof Request && input.method !== 'GET'
      ? await input.clone().text()
      : undefined;
  }
  if (typeof body === 'string') return body;
  if (body instanceof URLSearchParams) return body.toString();
  if (body instanceof Blob) return body.text();
  throw new Error('Store Hub transport accepts only text request bodies');
}

/**
 * Fixed-destination API transport for Electron hub clients.
 *
 * The static web meta CSP intentionally knows only the device-local API.
 * Rather than widening it to every possible merchant hub, Electron main
 * performs configured-hub `/api/*` requests and returns a response-shaped
 * result. Main revalidates the path and strips every non-allowlisted header.
 */
export function createHubApiFetch(): typeof fetch {
  return async (input, init) => {
    const api = hubSessionApi();
    const runtime = getRuntimeConfigSync();
    if (!api?.requestHub || !runtime.hubUrl) {
      throw new Error('Store Hub API bridge is unavailable');
    }
    const rawUrl = input instanceof Request ? input.url : input.toString();
    const target = new URL(rawUrl);
    const hub = new URL(runtime.hubUrl);
    if (target.origin !== hub.origin || !target.pathname.startsWith('/api/')) {
      throw new Error('Store Hub API request does not match the configured hub');
    }
    const method = (
      init?.method ?? (input instanceof Request ? input.method : 'GET')
    ).toUpperCase();
    if (!['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
      throw new Error(`Store Hub API method is not supported: ${method}`);
    }
    const headers = new Headers(input instanceof Request ? input.headers : undefined);
    new Headers(init?.headers).forEach((value, name) => headers.set(name, value));
    const body = await requestBodyText(input, init);
    const result = await api.requestHub({
      path: `${target.pathname}${target.search}`,
      method: method as 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
      headers: Object.fromEntries(headers.entries()),
      ...(body !== undefined ? { body } : {}),
    });
    return new Response(result.body, {
      status: result.status,
      headers: result.headers,
    });
  };
}

function unwrapHubResult<T>(result: HubAuthIpcResult<T>): T {
  if (result.ok) return result.data;
  const error = new Error(result.error.message) as Error & {
    data?: { errorCode?: string; code?: string; httpStatus?: number };
  };
  error.data = {
    ...(result.error.errorCode ? { errorCode: result.error.errorCode } : {}),
    ...(result.error.trpcCode ? { code: result.error.trpcCode } : {}),
    ...(result.error.status ? { httpStatus: result.error.status } : {}),
  };
  throw error;
}

export function isHubClientAuth(): boolean {
  return getRuntimeConfigSync().authorityMode === 'hub_client';
}

export async function loginToHub(input: {
  email: string;
  password: string;
}): Promise<HubAccessGrant> {
  const api = hubSessionApi();
  if (!api) throw new Error('Store Hub authentication bridge is unavailable');
  return unwrapHubResult(await api.loginHub(input));
}

export async function refreshHubSession(): Promise<HubAccessGrant> {
  const api = hubSessionApi();
  if (!api) throw new Error('Store Hub authentication bridge is unavailable');
  return unwrapHubResult(await api.refreshHub());
}

export async function switchHubStaff(input: {
  targetUserId: string;
  pin: string;
}): Promise<HubAccessGrant> {
  const api = hubSessionApi();
  if (!api) throw new Error('Store Hub authentication bridge is unavailable');
  return unwrapHubResult(await api.switchStaffHub(input));
}

export async function logoutFromHub(): Promise<void> {
  const api = hubSessionApi();
  if (!api) return;
  unwrapHubResult(await api.logoutHub());
}

export async function clearHubSession(): Promise<void> {
  const api = hubSessionApi();
  if (!api) return;
  await api.clearHub();
}
