import type { PuntovivoServer } from '@puntovivo/server';

/** This is an in-process routing identity, never an outbound network target. */
export const EMBEDDED_AUTH_ORIGIN = 'https://embedded.puntovivo.invalid';
const AUTH_PATHS = new Set([
  '/api/trpc/auth.login',
  '/api/trpc/auth.refresh',
  '/api/trpc/auth.switchStaff',
  '/api/trpc/auth.logout',
  '/api/trpc/health.check',
]);

/** Keep the real auth/CSRF/rate-limit handlers while removing browser cookie custody. */
export function createEmbeddedAuthFetch(getServer: () => PuntovivoServer | null): typeof fetch {
  return async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    const method = init?.method ?? 'GET';
    if (
      url.origin !== EMBEDDED_AUTH_ORIGIN ||
      !AUTH_PATHS.has(url.pathname) ||
      (method !== 'GET' && method !== 'POST')
    ) {
      throw new Error('Embedded authentication target is not allowed');
    }
    const server = getServer();
    if (!server) return new Response('{}', { status: 503 });
    const headers = Object.fromEntries(new Headers(init?.headers).entries());
    const result = await server.app.inject({
      method,
      url: url.pathname + url.search,
      headers,
      ...(typeof init?.body === 'string' ? { payload: init.body } : {}),
    });
    const responseHeaders = new Headers();
    for (const [name, value] of Object.entries(result.headers)) {
      if (value === undefined) continue;
      if (Array.isArray(value)) for (const item of value) responseHeaders.append(name, item);
      else responseHeaders.set(name, String(value));
    }
    const nullBody = [204, 205, 304].includes(result.statusCode);
    return new Response(nullBody ? null : result.body, {
      status: result.statusCode,
      headers: responseHeaders,
    });
  };
}
