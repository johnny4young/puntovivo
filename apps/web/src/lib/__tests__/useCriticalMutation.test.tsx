/**
 * ENG-052b — `useCriticalMutation` generic regression suite.
 *
 * Verifies the runtime behaviour of the hook (the type-level
 * inference is enforced by `tsc` at build time):
 *
 * - Throws `DEVICE_NOT_REGISTERED` when no device id is cached.
 * - Mints a fresh `CommandEnvelope` per `mutateAsync()` call.
 * - Calls the procedure resolved from the dotted path.
 * - Bubbles up server errors so React Query can populate `error`.
 */

import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getCachedDeviceIdSyncMock, createTrpcClientWithHeadersMock, mintEnvelopeMock, mutateMocks } =
  vi.hoisted(() => ({
    getCachedDeviceIdSyncMock: vi.fn<() => string | null>(),
    createTrpcClientWithHeadersMock: vi.fn(),
    mintEnvelopeMock: vi.fn(),
    mutateMocks: {
      salesCreate: vi.fn(),
      cashSessionsOpen: vi.fn(),
      usersUpdate: vi.fn(),
    },
  }));

vi.mock('@/lib/deviceId', () => ({
  getCachedDeviceIdSync: getCachedDeviceIdSyncMock,
}));

vi.mock('@/lib/trpc', () => ({
  createTrpcClientWithHeaders: createTrpcClientWithHeadersMock,
}));

vi.mock('@/lib/commandEnvelope', () => ({
  buildCriticalCommandHeaders: (deviceId: string, envelope: unknown) => ({
    'x-device-id': deviceId,
    'x-puntovivo-envelope': JSON.stringify(envelope),
  }),
  mintEnvelope: mintEnvelopeMock,
}));

import { useCriticalMutation } from '../useCriticalMutation';

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { mutations: { retry: false } },
  });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  vi.clearAllMocks();
  let envelopeCounter = 0;
  mintEnvelopeMock.mockImplementation(() => {
    envelopeCounter += 1;
    return {
      operationId: `op-${envelopeCounter}`,
      idempotencyKey: `idem-${envelopeCounter}`,
      clientCreatedAt: '2026-05-01T00:00:00.000Z',
    };
  });
  createTrpcClientWithHeadersMock.mockReturnValue({
    sales: { create: { mutate: mutateMocks.salesCreate } },
    cashSessions: { open: { mutate: mutateMocks.cashSessionsOpen } },
    users: { update: { mutate: mutateMocks.usersUpdate } },
  });
});

describe('useCriticalMutation', () => {
  it('throws DEVICE_NOT_REGISTERED when no device id is cached', async () => {
    getCachedDeviceIdSyncMock.mockReturnValue(null);
    const { result } = renderHook(() => useCriticalMutation('sales.create'), {
      wrapper,
    });

    await expect(
      result.current.mutateAsync({} as never)
    ).rejects.toMatchObject({ errorCode: 'DEVICE_NOT_REGISTERED' });

    expect(mutateMocks.salesCreate).not.toHaveBeenCalled();
  });

  it('dispatches against the resolved procedure on the dotted path', async () => {
    getCachedDeviceIdSyncMock.mockReturnValue('dev-123');
    mutateMocks.cashSessionsOpen.mockResolvedValue({ id: 'cash-1', status: 'open' });

    const { result } = renderHook(
      () => useCriticalMutation('cashSessions.open'),
      { wrapper }
    );

    const value = await result.current.mutateAsync({
      registerName: 'Front',
    } as never);

    expect(value).toEqual({ id: 'cash-1', status: 'open' });
    expect(mutateMocks.cashSessionsOpen).toHaveBeenCalledWith({
      registerName: 'Front',
    });
    expect(createTrpcClientWithHeadersMock).toHaveBeenCalledWith({
      'x-device-id': 'dev-123',
      'x-puntovivo-envelope': expect.stringContaining('"operationId":"op-1"'),
    });
  });

  it('mints a fresh envelope on every mutateAsync call', async () => {
    getCachedDeviceIdSyncMock.mockReturnValue('dev-fresh');
    mutateMocks.usersUpdate.mockResolvedValue({ id: 'u-1' });

    const { result } = renderHook(() => useCriticalMutation('users.update'), {
      wrapper,
    });

    await result.current.mutateAsync({ id: 'u-1' } as never);
    await result.current.mutateAsync({ id: 'u-1' } as never);

    // Two calls => two envelope mintings; replays are intentionally
    // orchestrated through React Query's retry semantics, not by
    // re-using the envelope at the call site.
    expect(mintEnvelopeMock).toHaveBeenCalledTimes(2);
    const firstHeaders = createTrpcClientWithHeadersMock.mock.calls[0]?.[0];
    const secondHeaders = createTrpcClientWithHeadersMock.mock.calls[1]?.[0];
    expect(firstHeaders).not.toEqual(secondHeaders);
  });

  it('bubbles server errors so React Query can populate error', async () => {
    getCachedDeviceIdSyncMock.mockReturnValue('dev-err');
    const upstream = new Error('IDEMPOTENCY_KEY_CONFLICT');
    mutateMocks.salesCreate.mockRejectedValue(upstream);

    const { result } = renderHook(() => useCriticalMutation('sales.create'), {
      wrapper,
    });

    result.current.mutate({} as never);

    await waitFor(() => {
      expect(result.current.error).toBe(upstream);
    });
  });
});
