import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearAccessToken,
  createTrpcClientWithHeaders,
  createTrpcFetch,
  fetchProtectedApi,
  getTrpcHeaders,
  invalidateAuthSessionWork,
  setAccessToken,
  setAuthSessionExpiredHandler,
} from '../trpc';
import { COMMAND_ENVELOPE_HEADER, DEVICE_ID_HEADER } from '../commandEnvelope';
import { clearStoredSiteId, persistSiteId } from '@/features/tenant/siteStorage';

describe('trpc site header', () => {
  const stored = new Map<string, string>();

  beforeEach(() => {
    stored.clear();
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      value: {
        getItem: vi.fn((key: string) => stored.get(key) ?? null),
        setItem: vi.fn((key: string, value: string) => void stored.set(key, value)),
        removeItem: vi.fn((key: string) => void stored.delete(key)),
        clear: vi.fn(() => stored.clear()),
      },
    });
  });

  afterEach(() => {
    clearStoredSiteId('tenant-north');
    clearStoredSiteId('tenant-next');
  });

  it('keeps sending the site this document resolved after another tab changes the shared selection', () => {
    stored.set('auth_tenant', JSON.stringify({ id: 'tenant-north' }));
    persistSiteId('site-north', 'tenant-north');
    // Every same-origin tab shares localStorage: this write is another tab's switch.
    stored.set('active_site_id:tenant-north', 'site-south');

    expect(getTrpcHeaders()['x-site-id']).toBe('site-north');
  });

  it('sends the remembered selection before this document resolves a site', () => {
    stored.set('auth_tenant', JSON.stringify({ id: 'tenant-north' }));
    stored.set('active_site_id:tenant-north', 'site-south');

    expect(getTrpcHeaders()['x-site-id']).toBe('site-south');
  });

  it('follows the stored tenant once a login replaces this document identity', () => {
    stored.set('auth_tenant', JSON.stringify({ id: 'tenant-north' }));
    persistSiteId('site-north', 'tenant-north');
    // Login persists the new tenant before its provider resolves a site.
    stored.set('auth_tenant', JSON.stringify({ id: 'tenant-next' }));
    stored.set('active_site_id:tenant-next', 'site-next');

    expect(getTrpcHeaders()['x-site-id']).toBe('site-next');
  });
});

describe('trpc auth transport', () => {
  beforeEach(() => {
    clearAccessToken();
    setAuthSessionExpiredHandler(null);
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      value: {
        getItem: vi.fn(() => null),
        setItem: vi.fn(),
        removeItem: vi.fn(),
        clear: vi.fn(),
      },
    });
    document.cookie = 'puntovivo_csrf=test-csrf-token; path=/';
  });

  afterEach(() => {
    clearAccessToken();
    setAuthSessionExpiredHandler(null);
    vi.unstubAllGlobals();
    delete window.api;
    document.cookie = 'puntovivo_csrf=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/';
  });

  it('decodes a global throttle as tRPC without expiring or retrying the session', async () => {
    setAccessToken('active-access-token');
    const onSessionExpired = vi.fn();
    setAuthSessionExpiredHandler(onSessionExpired);
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          statusCode: 429,
          error: {
            code: -32029,
            message: 'Too many requests. Wait before trying again.',
            data: {
              code: 'TOO_MANY_REQUESTS',
              httpStatus: 429,
              errorCode: 'AUTH_RATE_LIMIT_EXCEEDED',
            },
          },
        }),
        { status: 429, headers: { 'content-type': 'application/json', 'retry-after': '30' } }
      )
    );
    vi.stubGlobal('fetch', fetchMock);
    const client = createTrpcClientWithHeaders({});
    await expect(client.health.check.query()).rejects.toMatchObject({
      message: 'Too many requests. Wait before trying again.',
      data: { code: 'TOO_MANY_REQUESTS', httpStatus: 429, errorCode: 'AUTH_RATE_LIMIT_EXCEEDED' },
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(onSessionExpired).not.toHaveBeenCalled();
    expect(getTrpcHeaders().authorization).toBe('Bearer active-access-token');
  });

  it.each([429, 503])('does not expire or loop when a 401 refresh receives %s', async status => {
    setAccessToken('expired-access-token');
    const expired = vi.fn();
    setAuthSessionExpiredHandler(expired);
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response('{}', { status: 401 }))
      .mockResolvedValueOnce(new Response('{}', { status, headers: { 'retry-after': '45' } }));
    let failure: unknown;
    try {
      await createTrpcFetch(fetchMock)('http://localhost:8090/api/trpc/auth.me?batch=1');
    } catch (error) {
      failure = error;
    }
    expect(failure).toMatchObject({ data: { httpStatus: status } });
    expect(
      (failure as { meta: { response: Response } }).meta.response.headers.get('retry-after')
    ).toBe('45');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(expired).not.toHaveBeenCalled();
    expect(getTrpcHeaders().authorization).toBe('Bearer expired-access-token');
  });

  it.each([
    { status: 200, transition: 'new-operator' },
    { status: 401, transition: 'new-operator' },
    { status: 200, transition: 'logout' },
    { status: 401, transition: 'logout' },
  ])('ignores a late refresh $status after $transition', async ({ status, transition }) => {
    setAccessToken('old-operator');
    const expired = vi.fn();
    const register = vi.fn().mockResolvedValue({ ok: true });
    setAuthSessionExpiredHandler(expired);
    Object.defineProperty(window, 'api', { configurable: true, value: { session: { register } } });
    const deferred = createDeferred<Response>();
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response('{}', { status: 401 }))
      .mockReturnValueOnce(deferred.promise);
    const pending = createTrpcFetch(fetchMock)('http://localhost:8090/api/trpc/auth.me?batch=1');
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    if (transition === 'logout') invalidateAuthSessionWork();
    else {
      clearAccessToken();
      setAccessToken('new-operator');
    }
    expect(fetchMock.mock.calls[1]?.[1]?.signal?.aborted).toBe(true);
    deferred.resolve(
      new Response(JSON.stringify([{ result: { data: { token: 'late-old-token' } } }]), { status })
    );
    expect((await pending).status).toBe(401);
    expect(getTrpcHeaders().authorization).toBe(
      transition === 'logout' ? 'Bearer old-operator' : 'Bearer new-operator'
    );
    expect(expired).not.toHaveBeenCalled();
    expect(register).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('does not refresh an old request whose first 401 arrives after a handoff', async () => {
    setAccessToken('old-operator');
    const deferred = createDeferred<Response>();
    const fetchMock = vi.fn<typeof fetch>().mockReturnValueOnce(deferred.promise);
    const pending = createTrpcFetch(fetchMock)('http://localhost:8090/api/trpc/auth.me?batch=1');
    setAccessToken('new-operator');
    deferred.resolve(new Response('{}', { status: 401 }));
    expect((await pending).status).toBe(401);
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(getTrpcHeaders().authorization).toBe('Bearer new-operator');
  });

  it('keeps the new identity single-flight when an older refresh settles', async () => {
    const oldRefresh = createDeferred<Response>();
    const newRefresh = createDeferred<Response>();
    let refreshes = 0;
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(async (url, init) => {
      if (String(url).includes('auth.refresh'))
        return ++refreshes === 1 ? oldRefresh.promise : newRefresh.promise;
      return new Response('{}', {
        status:
          new Headers(init?.headers).get('authorization') === 'Bearer new-rotated' ? 200 : 401,
      });
    });
    const send = createTrpcFetch(fetchMock);
    setAccessToken('old');
    const oldRequest = send('http://localhost:8090/api/trpc/auth.me?batch=1');
    await vi.waitFor(() => expect(refreshes).toBe(1));
    setAccessToken('new');
    const first = send('http://localhost:8090/api/trpc/auth.me?batch=1');
    await vi.waitFor(() => expect(refreshes).toBe(2));
    oldRefresh.resolve(new Response('{}', { status: 401 }));
    expect((await oldRequest).status).toBe(401);
    const second = send('http://localhost:8090/api/trpc/products.list?batch=1');
    // Let the second 401 reach the still-pending new identity flight.
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(5));
    newRefresh.resolve(
      new Response(JSON.stringify([{ result: { data: { token: 'new-rotated' } } }]))
    );
    expect((await first).status).toBe(200);
    expect((await second).status).toBe(200);
    expect(refreshes).toBe(2);
    expect(getTrpcHeaders().authorization).toBe('Bearer new-rotated');
  });

  it('refreshes an expired access token and retries the request once', async () => {
    setAccessToken('expired-access-token');

    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(JSON.stringify([{ error: { message: 'Unauthorized' } }]), {
          status: 401,
          headers: { 'content-type': 'application/json' },
        })
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify([
            {
              result: {
                data: {
                  token: 'fresh-access-token',
                },
              },
            },
          ]),
          {
            status: 200,
            headers: { 'content-type': 'application/json' },
          }
        )
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify([{ result: { data: { ok: true } } }]), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      );

    const trpcFetch = createTrpcFetch(fetchMock);
    const response = await trpcFetch('http://localhost:8090/api/trpc/auth.me?batch=1', {
      method: 'GET',
      headers: {
        authorization: 'Bearer expired-access-token',
      },
    });

    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls[1]?.[0]).toBe(
      'http://localhost:8090/api/trpc/auth.refresh?batch=1'
    );

    const retryInit = fetchMock.mock.calls[2]?.[1];
    const retryHeaders = new Headers(retryInit?.headers);
    expect(retryHeaders.get('authorization')).toBe('Bearer fresh-access-token');
    expect(getTrpcHeaders().authorization).toBe('Bearer fresh-access-token');
  });

  it('clears the local access token and notifies the session handler when refresh fails', async () => {
    setAccessToken('expired-access-token');
    const onSessionExpired = vi.fn();
    setAuthSessionExpiredHandler(onSessionExpired);

    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(JSON.stringify([{ error: { message: 'Unauthorized' } }]), {
          status: 401,
          headers: { 'content-type': 'application/json' },
        })
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify([{ error: { message: 'Unauthorized' } }]), {
          status: 401,
          headers: { 'content-type': 'application/json' },
        })
      );

    const trpcFetch = createTrpcFetch(fetchMock);
    const response = await trpcFetch('http://localhost:8090/api/trpc/auth.me?batch=1', {
      method: 'GET',
      headers: {
        authorization: 'Bearer expired-access-token',
      },
    });

    expect(response.status).toBe(401);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(onSessionExpired).toHaveBeenCalledTimes(1);
    expect(getTrpcHeaders().authorization).toBeUndefined();
  });

  it('sends fixed critical command headers through a dedicated client', async () => {
    const envelopeHeader = JSON.stringify({
      operationId: '11111111-1111-4111-8111-111111111111',
      idempotencyKey: 'change-password-key',
      clientCreatedAt: '2026-05-02T00:00:00.000Z',
    });
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify([
          {
            result: {
              data: {
                success: true,
                message: 'Password changed successfully',
              },
            },
          },
        ]),
        {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }
      )
    );
    vi.stubGlobal('fetch', fetchMock);

    const client = createTrpcClientWithHeaders({
      [DEVICE_ID_HEADER]: 'device-test-id',
      [COMMAND_ENVELOPE_HEADER]: envelopeHeader,
    });

    await client.auth.changePassword.mutate({
      currentPassword: 'CurrentPassword123!',
      newPassword: 'NewPassword123!',
    });

    const init = fetchMock.mock.calls[0]?.[1];
    const headers = new Headers(init?.headers);
    expect(headers.get(DEVICE_ID_HEADER)).toBe('device-test-id');
    expect(headers.get(COMMAND_ENVELOPE_HEADER)).toBe(envelopeHeader);
  });

  it('sends payload-heavy return previews as POST queries', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify([
          {
            result: {
              data: {
                refundAmount: 1,
                allocations: [],
              },
            },
          },
        ]),
        {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }
      )
    );
    vi.stubGlobal('fetch', fetchMock);
    const client = createTrpcClientWithHeaders({});

    await client.sales.previewReturn.query({
      id: 'sale-large-return',
      items: Array.from({ length: 200 }, (_, index) => ({
        saleItemId: `line-${index}-${'x'.repeat(80)}`,
        quantity: 1,
      })),
    });

    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(init?.method).toBe('POST');
    expect(String(url)).toContain('/api/trpc/sales.previewReturn?batch=1');
    expect(String(url)).not.toContain('sale-large-return');
    expect(String(init?.body)).toContain('sale-large-return');
  });

  it('downloads protected binary routes with the active auth and CSRF transport', async () => {
    setAccessToken('pdf-access-token');
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response('%PDF-1.7', {
        status: 200,
        headers: { 'content-type': 'application/pdf' },
      })
    );

    const response = await fetchProtectedApi(
      '/api/reports/day-close/artifacts/artifact-123',
      { method: 'GET' },
      fetchMock
    );

    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      'http://localhost:8090/api/reports/day-close/artifacts/artifact-123'
    );
    const headers = new Headers(fetchMock.mock.calls[0]?.[1]?.headers);
    expect(headers.get('authorization')).toBe('Bearer pdf-access-token');
    expect(headers.get('x-csrf-token')).toBe('test-csrf-token');
  });
});

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(complete => {
    resolve = complete;
  });
  return { promise, resolve };
}
