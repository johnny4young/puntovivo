import { getRuntimeConfigSync } from '@/lib/runtimeConfigClient';

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
    const runtime = getRuntimeConfigSync();
    const api =
      runtime.authorityMode === 'hub_client'
        ? (window.api?.session ?? window.session ?? null)
        : null;
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
