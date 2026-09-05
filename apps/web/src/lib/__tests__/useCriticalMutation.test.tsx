/**
 * `useCriticalMutation` generic regression suite.
 *
 * Verifies the runtime behaviour of the hook (the type-level
 * inference is enforced by `tsc` at build time):
 *
 * - Throws `DEVICE_NOT_REGISTERED` when no device id is cached.
 * - Mints a fresh `CommandEnvelope` after each settled success.
 * - Calls the procedure resolved from the dotted path.
 * - Bubbles up server errors so React Query can populate `error`.
 */

import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  getCachedDeviceIdSyncMock,
  createTrpcClientWithHeadersMock,
  mintEnvelopeMock,
  mutateMocks,
} = vi.hoisted(() => ({
  getCachedDeviceIdSyncMock: vi.fn<() => string | null>(),
  createTrpcClientWithHeadersMock: vi.fn(),
  mintEnvelopeMock: vi.fn(),
  mutateMocks: {
    salesCreate: vi.fn(),
    cashSessionsOpen: vi.fn(),
    usersUpdate: vi.fn(),
    dayCloseSignOff: vi.fn(),
    purchasesCreate: vi.fn(),
    ordersVoid: vi.fn(),
    externalAccept: vi.fn(),
    employmentCreate: vi.fn(),
    payrollPeriodCreate: vi.fn(),
    timeOffAdvance: vi.fn(),
    availabilityCreate: vi.fn(),
    availabilityReplace: vi.fn(),
    availabilityVoid: vi.fn(),
    scheduleCreate: vi.fn(),
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

function retryWrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { mutations: { retry: 1, retryDelay: 0 } },
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
    employeeShifts: { schedule: { create: { mutate: mutateMocks.scheduleCreate } } },
    workforce: {
      contracts: { create: { mutate: mutateMocks.employmentCreate } },
      payroll: {
        periods: { create: { mutate: mutateMocks.payrollPeriodCreate } },
      },
      timeOff: { advance: { mutate: mutateMocks.timeOffAdvance } },
      availability: {
        create: { mutate: mutateMocks.availabilityCreate },
        replace: { mutate: mutateMocks.availabilityReplace },
        void: { mutate: mutateMocks.availabilityVoid },
      },
    },
    externalOrders: { accept: { mutate: mutateMocks.externalAccept } },
    sales: { create: { mutate: mutateMocks.salesCreate } },
    cashSessions: { open: { mutate: mutateMocks.cashSessionsOpen } },
    users: { update: { mutate: mutateMocks.usersUpdate } },
    purchases: { create: { mutate: mutateMocks.purchasesCreate } },
    orders: { void: { mutate: mutateMocks.ordersVoid } },
    reports: { dayClose: { signOff: { mutate: mutateMocks.dayCloseSignOff } } },
  });
});

describe('useCriticalMutation', () => {
  it('retains schedule identity after a safe but uncertain server failure', async () => {
    getCachedDeviceIdSyncMock.mockReturnValue('schedule-device');
    const unavailable = Object.assign(new Error('Schedule unavailable'), {
      data: { code: 'INTERNAL_SERVER_ERROR', errorCode: 'SCHEDULE_TEMPORARILY_UNAVAILABLE' },
    });
    mutateMocks.scheduleCreate
      .mockRejectedValueOnce(unavailable)
      .mockResolvedValueOnce({ id: 'shift', version: 1 });
    const { result } = renderHook(() => useCriticalMutation('employeeShifts.schedule.create'), {
      wrapper,
    });
    const input = {
      userId: 'worker',
      siteId: 'site',
      startDate: '2026-09-04',
      endDate: '2026-09-04',
      startTime: '08:00',
      endTime: '16:00',
      notes: null,
    };
    await act(async () => {
      await expect(result.current.mutateAsync(input)).rejects.toBe(unavailable);
    });
    await act(async () => {
      await expect(result.current.mutateAsync(input)).resolves.toEqual({ id: 'shift', version: 1 });
    });
    expect(mintEnvelopeMock).toHaveBeenCalledTimes(1);
    expect(createTrpcClientWithHeadersMock.mock.calls[1]?.[0]).toEqual(
      createTrpcClientWithHeadersMock.mock.calls[0]?.[0]
    );
  });
  it.each([
    {
      path: 'workforce.availability.create' as const,
      mutate: mutateMocks.availabilityCreate,
      input: {
        userId: 'worker',
        fromDate: '2026-09-07',
        untilDate: null,
        slots: [],
        reason: 'Explicit unavailable week',
      },
    },
    {
      path: 'workforce.availability.replace' as const,
      mutate: mutateMocks.availabilityReplace,
      input: {
        id: 'policy',
        expectedVersion: 1,
        fromDate: '2026-09-14',
        slots: [],
        reason: 'Explicit unavailable week',
      },
    },
    {
      path: 'workforce.availability.void' as const,
      mutate: mutateMocks.availabilityVoid,
      input: { id: 'policy', expectedVersion: 1, reason: 'Explicit removal of policy' },
    },
  ])(
    'retains outcome-uncertain availability identity for $path',
    async ({ path, mutate, input }) => {
      getCachedDeviceIdSyncMock.mockReturnValue('availability-device');
      const unavailable = Object.assign(new Error('Availability unavailable'), {
        data: { code: 'INTERNAL_SERVER_ERROR', errorCode: 'AVAILABILITY_TEMPORARILY_UNAVAILABLE' },
      });
      mutate.mockRejectedValueOnce(unavailable).mockResolvedValueOnce({ id: 'policy', version: 2 });
      const { result } = renderHook(() => useCriticalMutation(path), { wrapper });
      await act(async () => {
        await expect(result.current.mutateAsync(input)).rejects.toBe(unavailable);
      });
      await act(async () => {
        await expect(result.current.mutateAsync(input)).resolves.toEqual({
          id: 'policy',
          version: 2,
        });
      });
      expect(mintEnvelopeMock).toHaveBeenCalledTimes(1);
      expect(createTrpcClientWithHeadersMock.mock.calls[1]?.[0]).toEqual(
        createTrpcClientWithHeadersMock.mock.calls[0]?.[0]
      );
      expect(mutate).toHaveBeenCalledTimes(2);
    }
  );
  it('retains absence approval identity after an outcome-uncertain server failure', async () => {
    getCachedDeviceIdSyncMock.mockReturnValue('absence-device');
    const unavailable = Object.assign(new Error('Absence unavailable'), {
      data: { code: 'INTERNAL_SERVER_ERROR', errorCode: 'TIME_OFF_TEMPORARILY_UNAVAILABLE' },
    });
    mutateMocks.timeOffAdvance
      .mockRejectedValueOnce(unavailable)
      .mockResolvedValueOnce({ id: 'request', version: 2 });
    const { result } = renderHook(() => useCriticalMutation('workforce.timeOff.advance'), {
      wrapper,
    });
    const input = {
      id: 'request',
      siteId: 'site',
      expectedVersion: 1,
      status: 'approved' as const,
      reason: 'Explicit absence decision',
    };
    await act(async () => {
      await expect(result.current.mutateAsync(input)).rejects.toBe(unavailable);
    });
    await act(async () => {
      await expect(result.current.mutateAsync(input)).resolves.toEqual({
        id: 'request',
        version: 2,
      });
    });
    expect(mintEnvelopeMock).toHaveBeenCalledTimes(1);
    expect(createTrpcClientWithHeadersMock.mock.calls[1]?.[0]).toEqual(
      createTrpcClientWithHeadersMock.mock.calls[0]?.[0]
    );
  });
  it('retains employment identity after an outcome-uncertain server failure', async () => {
    getCachedDeviceIdSyncMock.mockReturnValue('workforce-device');
    const unavailable = Object.assign(new Error('Employment unavailable'), {
      data: {
        code: 'INTERNAL_SERVER_ERROR',
        errorCode: 'EMPLOYMENT_CONTRACT_TEMPORARILY_UNAVAILABLE',
      },
    });
    mutateMocks.employmentCreate
      .mockRejectedValueOnce(unavailable)
      .mockResolvedValueOnce({ id: 'contract', siteId: 'site', version: 1 });
    const { result } = renderHook(() => useCriticalMutation('workforce.contracts.create'), {
      wrapper,
    });
    const input = {
      terms: {
        userId: 'worker',
        siteId: 'site',
        position: 'Sales associate',
        effectiveFrom: '2026-01-01',
        currencyCode: 'COP',
        pay: { basis: 'hourly' as const, amount: 10000 },
      },
      reason: 'Explicit employment terms',
    };
    await act(async () => {
      await expect(result.current.mutateAsync(input)).rejects.toBe(unavailable);
    });
    await act(async () => {
      await expect(result.current.mutateAsync(input)).resolves.toEqual({
        id: 'contract',
        siteId: 'site',
        version: 1,
      });
    });
    expect(mintEnvelopeMock).toHaveBeenCalledTimes(1);
    expect(createTrpcClientWithHeadersMock.mock.calls[1]?.[0]).toEqual(
      createTrpcClientWithHeadersMock.mock.calls[0]?.[0]
    );
  });
  it('retains pre-payroll identity after an outcome-uncertain private write failure', async () => {
    getCachedDeviceIdSyncMock.mockReturnValue('payroll-device');
    const unavailable = Object.assign(new Error('Pre-payroll unavailable'), {
      data: {
        code: 'INTERNAL_SERVER_ERROR',
        errorCode: 'PAYROLL_TEMPORARILY_UNAVAILABLE',
      },
    });
    mutateMocks.payrollPeriodCreate
      .mockRejectedValueOnce(unavailable)
      .mockResolvedValueOnce({ id: 'period', status: 'open', version: 1 });
    const { result } = renderHook(() => useCriticalMutation('workforce.payroll.periods.create'), {
      wrapper,
    });
    const input = {
      countryCode: 'CO' as const,
      frequency: 'monthly' as const,
      fromDate: '2026-08-01',
      untilDate: '2026-09-01',
      payDate: '2026-09-05',
      currencyCode: 'COP' as const,
      reason: 'Reviewed August payroll period',
    };
    await act(async () => {
      await expect(result.current.mutateAsync(input)).rejects.toBe(unavailable);
    });
    await act(async () => {
      await expect(result.current.mutateAsync(input)).resolves.toEqual({
        id: 'period',
        status: 'open',
        version: 1,
      });
    });
    expect(mintEnvelopeMock).toHaveBeenCalledTimes(1);
    expect(mutateMocks.payrollPeriodCreate).toHaveBeenCalledTimes(2);
  });
  it('retains external acceptance identity after a safe but outcome-uncertain server failure', async () => {
    getCachedDeviceIdSyncMock.mockReturnValue('external-device');
    mutateMocks.externalAccept
      .mockRejectedValueOnce({
        data: {
          code: 'INTERNAL_SERVER_ERROR',
          errorCode: 'EXTERNAL_ORDER_TEMPORARILY_UNAVAILABLE',
        },
      })
      .mockResolvedValueOnce({ id: 'draft' });
    const { result } = renderHook(() => useCriticalMutation('externalOrders.accept'), { wrapper });
    const input = {
      siteId: 'site',
      id: 'order',
      expectedVersion: 1,
      fingerprint: 'a'.repeat(64),
      confirmedLocalPricing: true as const,
    };
    await act(async () => {
      await expect(result.current.mutateAsync(input)).rejects.toMatchObject({
        data: { errorCode: 'EXTERNAL_ORDER_TEMPORARILY_UNAVAILABLE' },
      });
    });
    await act(async () => {
      await expect(result.current.mutateAsync(input)).resolves.toEqual({ id: 'draft' });
    });
    expect(mintEnvelopeMock).toHaveBeenCalledTimes(1);
    expect(createTrpcClientWithHeadersMock.mock.calls[1]?.[0]).toEqual(
      createTrpcClientWithHeadersMock.mock.calls[0]?.[0]
    );
  });

  it('throws DEVICE_NOT_REGISTERED when no device id is cached', async () => {
    getCachedDeviceIdSyncMock.mockReturnValue(null);
    const { result } = renderHook(() => useCriticalMutation('sales.create'), {
      wrapper,
    });

    await expect(result.current.mutateAsync({} as never)).rejects.toMatchObject({
      errorCode: 'DEVICE_NOT_REGISTERED',
    });

    expect(mutateMocks.salesCreate).not.toHaveBeenCalled();
  });

  it('dispatches against the resolved procedure on the dotted path', async () => {
    getCachedDeviceIdSyncMock.mockReturnValue('dev-123');
    mutateMocks.cashSessionsOpen.mockResolvedValue({ id: 'cash-1', status: 'open' });

    const { result } = renderHook(() => useCriticalMutation('cashSessions.open'), { wrapper });

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

  it('dispatches through a nested sub-router path', async () => {
    getCachedDeviceIdSyncMock.mockReturnValue('dev-report');
    mutateMocks.dayCloseSignOff.mockResolvedValue({ id: 'signoff-1' });

    const { result } = renderHook(() => useCriticalMutation('reports.dayClose.signOff'), {
      wrapper,
    });

    const value = await result.current.mutateAsync({
      date: '2026-07-14',
      attestationAccepted: true,
    });

    expect(value).toEqual({ id: 'signoff-1' });
    expect(mutateMocks.dayCloseSignOff).toHaveBeenCalledWith({
      date: '2026-07-14',
      attestationAccepted: true,
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

    // Two completed logical intents mint independently. Only concurrent or
    // outcome-uncertain retries reuse the prior identity.
    expect(mintEnvelopeMock).toHaveBeenCalledTimes(2);
    const firstHeaders = createTrpcClientWithHeadersMock.mock.calls[0]?.[0];
    const secondHeaders = createTrpcClientWithHeadersMock.mock.calls[1]?.[0];
    expect(firstHeaders).not.toEqual(secondHeaders);
  });

  it('coalesces concurrent duplicate clicks into one network command', async () => {
    getCachedDeviceIdSyncMock.mockReturnValue('dev-double-click');
    let resolveCreate!: (value: { id: string }) => void;
    mutateMocks.purchasesCreate.mockReturnValue(
      new Promise(resolve => {
        resolveCreate = resolve;
      })
    );

    const { result } = renderHook(() => useCriticalMutation('purchases.create'), { wrapper });
    await act(async () => {
      const first = result.current.mutateAsync({ providerId: 'provider-1', items: [] } as never);
      const second = result.current.mutateAsync({ items: [], providerId: 'provider-1' } as never);
      resolveCreate({ id: 'purchase-1' });

      await expect(Promise.all([first, second])).resolves.toEqual([
        { id: 'purchase-1' },
        { id: 'purchase-1' },
      ]);
    });
    expect(mutateMocks.purchasesCreate).toHaveBeenCalledTimes(1);
    expect(mintEnvelopeMock).toHaveBeenCalledTimes(1);
  });

  it('reuses the same envelope across an automatic React Query retry', async () => {
    getCachedDeviceIdSyncMock.mockReturnValue('dev-retry');
    mutateMocks.ordersVoid
      .mockRejectedValueOnce(new Error('transient'))
      .mockResolvedValueOnce({ id: 'order-1', status: 'voided' });

    const { result } = renderHook(() => useCriticalMutation('orders.void'), {
      wrapper: retryWrapper,
    });
    await act(async () => {
      await expect(result.current.mutateAsync({ id: 'order-1' } as never)).resolves.toMatchObject({
        status: 'voided',
      });
    });

    expect(mutateMocks.ordersVoid).toHaveBeenCalledTimes(2);
    expect(mintEnvelopeMock).toHaveBeenCalledTimes(1);
    const firstHeaders = createTrpcClientWithHeadersMock.mock.calls[0]?.[0];
    const retryHeaders = createTrpcClientWithHeadersMock.mock.calls[1]?.[0];
    expect(retryHeaders).toEqual(firstHeaders);
  });

  it('reuses the envelope when the next user retry follows an uncertain transport failure', async () => {
    getCachedDeviceIdSyncMock.mockReturnValue('dev-uncertain');
    mutateMocks.purchasesCreate
      .mockRejectedValueOnce(new Error('Failed to fetch'))
      .mockResolvedValueOnce({ id: 'purchase-after-network-recovery' });

    const { result } = renderHook(() => useCriticalMutation('purchases.create'), { wrapper });
    const input = { providerId: 'provider-network', items: [] } as never;

    await act(async () => {
      await expect(result.current.mutateAsync(input)).rejects.toThrow('Failed to fetch');
    });
    await act(async () => {
      await expect(result.current.mutateAsync(input)).resolves.toEqual({
        id: 'purchase-after-network-recovery',
      });
    });

    expect(mintEnvelopeMock).toHaveBeenCalledTimes(1);
    expect(createTrpcClientWithHeadersMock.mock.calls[1]?.[0]).toEqual(
      createTrpcClientWithHeadersMock.mock.calls[0]?.[0]
    );
  });

  it('expires a retained uncertain envelope before retrying the same input', async () => {
    getCachedDeviceIdSyncMock.mockReturnValue('dev-expired-uncertain');
    mutateMocks.purchasesCreate
      .mockRejectedValueOnce(new Error('Failed to fetch'))
      .mockResolvedValueOnce({ id: 'purchase-after-retention-window' });
    let now = Date.parse('2026-05-01T00:00:00.000Z');
    const nowSpy = vi.spyOn(Date, 'now').mockImplementation(() => now);

    try {
      const { result } = renderHook(() => useCriticalMutation('purchases.create'), { wrapper });
      const input = { providerId: 'provider-expired', items: [] } as never;

      await act(async () => {
        await expect(result.current.mutateAsync(input)).rejects.toThrow('Failed to fetch');
      });
      now += 24 * 60 * 60 * 1000 + 1;
      await act(async () => {
        await expect(result.current.mutateAsync(input)).resolves.toEqual({
          id: 'purchase-after-retention-window',
        });
      });

      expect(mintEnvelopeMock).toHaveBeenCalledTimes(2);
      expect(createTrpcClientWithHeadersMock.mock.calls[1]?.[0]).not.toEqual(
        createTrpcClientWithHeadersMock.mock.calls[0]?.[0]
      );
    } finally {
      nowSpy.mockRestore();
    }
  });

  it('reuses the envelope after a structured busy response', async () => {
    getCachedDeviceIdSyncMock.mockReturnValue('dev-busy');
    const busy = Object.assign(new Error('Command store busy'), {
      data: { code: 'CONFLICT', errorCode: 'COMMAND_DATABASE_BUSY' },
    });
    mutateMocks.ordersVoid
      .mockRejectedValueOnce(busy)
      .mockResolvedValueOnce({ id: 'order-busy', status: 'voided' });

    const { result } = renderHook(() => useCriticalMutation('orders.void'), { wrapper });
    const input = { id: 'order-busy' } as never;

    await act(async () => {
      await expect(result.current.mutateAsync(input)).rejects.toBe(busy);
    });
    await act(async () => {
      await expect(result.current.mutateAsync(input)).resolves.toMatchObject({ status: 'voided' });
    });

    expect(mintEnvelopeMock).toHaveBeenCalledTimes(1);
    expect(createTrpcClientWithHeadersMock.mock.calls[1]?.[0]).toEqual(
      createTrpcClientWithHeadersMock.mock.calls[0]?.[0]
    );
  });

  it('mints a new envelope after an explicit terminal server rejection', async () => {
    getCachedDeviceIdSyncMock.mockReturnValue('dev-terminal');
    const rejection = Object.assign(new Error('Product not found'), {
      data: { code: 'NOT_FOUND', errorCode: 'PRODUCT_NOT_FOUND' },
    });
    mutateMocks.purchasesCreate
      .mockRejectedValueOnce(rejection)
      .mockResolvedValueOnce({ id: 'purchase-after-terminal-rejection' });

    const { result } = renderHook(() => useCriticalMutation('purchases.create'), { wrapper });
    const input = { providerId: 'provider-terminal', items: [] } as never;

    await act(async () => {
      await expect(result.current.mutateAsync(input)).rejects.toBe(rejection);
    });
    await act(async () => {
      await expect(result.current.mutateAsync(input)).resolves.toEqual({
        id: 'purchase-after-terminal-rejection',
      });
    });

    expect(mintEnvelopeMock).toHaveBeenCalledTimes(2);
    expect(createTrpcClientWithHeadersMock.mock.calls[1]?.[0]).not.toEqual(
      createTrpcClientWithHeadersMock.mock.calls[0]?.[0]
    );
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
