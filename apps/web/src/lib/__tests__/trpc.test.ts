import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearAccessToken,
  createTrpcFetch,
  getTrpcHeaders,
  setAccessToken,
  setAuthSessionExpiredHandler,
} from '../trpc';

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
    document.cookie =
      'puntovivo_csrf=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/';
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
    expect(fetchMock.mock.calls[1]?.[0]).toBe('http://localhost:8090/api/trpc/auth.refresh?batch=1');

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
});
