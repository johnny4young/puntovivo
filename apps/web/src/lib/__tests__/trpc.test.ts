import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearAccessToken,
  createTrpcClientWithHeaders,
  createTrpcFetch,
  fetchProtectedApi,
  getTrpcHeaders,
  setAccessToken,
  setAuthSessionExpiredHandler,
} from '../trpc';
import { COMMAND_ENVELOPE_HEADER, DEVICE_ID_HEADER } from '../commandEnvelope';

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
    document.cookie = 'puntovivo_csrf=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/';
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
