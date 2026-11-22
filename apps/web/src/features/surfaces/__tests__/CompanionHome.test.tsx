import { act, Suspense } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import type { RealtimeEvent } from '@/hooks/useRealtimeChannel';

const { snapshotUseQuery, snapshotInvalidate, snapshotReset, channelSpy, auth, owner } = vi.hoisted(
  () => ({
    snapshotUseQuery: vi.fn(),
    snapshotInvalidate: vi.fn(),
    snapshotReset: vi.fn(),
    channelSpy: vi.fn(),
    auth: { role: 'viewer' },
    owner: { invalidate: vi.fn(), reset: vi.fn() },
  })
);

vi.mock('@/lib/trpc', () => ({
  trpc: {
    companion: { snapshot: { useQuery: snapshotUseQuery } },
    useUtils: () => ({
      companion: { snapshot: { invalidate: snapshotInvalidate, reset: snapshotReset } },
      operations: { today: owner, dayCurve: owner },
      managerApprovals: { queue: owner },
      reports: {
        dayClose: {
          invalidate: owner.invalidate,
          signoff: owner,
          signoffMetadata: owner,
          checklist: owner,
        },
      },
    }),
  },
}));

vi.mock('@/features/auth/AuthProvider', () => ({
  useAuth: () => ({ user: { role: auth.role } }),
}));

vi.mock('../CompanionMore', () => ({
  CompanionMore: () => <p data-testid="more-stub">more</p>,
}));

vi.mock('../CompanionOwnerViews', () => ({
  CompanionOwnerViews: ({ view }: { view: string }) => <p data-testid="owner-stub">{view}</p>,
}));

vi.mock('@/hooks/useRealtimeChannel', () => ({
  useRealtimeChannel: (options: unknown) => channelSpy(options),
}));

vi.mock('@/features/locale/LocaleProvider', () => ({
  useResolvedLocale: () => ({ timezone: 'America/Bogota', locale: 'es-CO' }),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

import { CompanionHome } from '../CompanionHome';

function home(path = '/c/') {
  return (
    <MemoryRouter initialEntries={[path]}>
      <Suspense fallback={null}>
        <CompanionHome />
      </Suspense>
    </MemoryRouter>
  );
}

const SNAPSHOT = {
  businessDate: '2026-08-28',
  generatedAt: '2026-08-28T18:00:00.000Z',
  stats: { revenue: 1_000, orders: 3 },
  recentSales: [
    {
      id: 'sale-1',
      saleNumber: 'VTA-000001',
      total: 500,
      completedAt: '2026-08-28T17:00:00.000Z',
    },
  ],
  attention: { areas: [], totalCount: 0, highestSeverity: null },
  dayClose: null,
};

interface Channel {
  emit: (event: RealtimeEvent) => void;
  setState: (state: 'connecting' | 'open' | 'closed') => void;
}

function captureChannel(): Channel {
  const options = channelSpy.mock.calls.at(-1)?.[0] as {
    onEvent: (event: RealtimeEvent) => void;
    onStateChange?: (state: 'connecting' | 'open' | 'closed') => void;
  };
  return {
    emit: event => act(() => options.onEvent(event)),
    setState: state => act(() => options.onStateChange?.(state)),
  };
}

function invalidation(scope: 'sales' | 'operations' | 'day_close'): RealtimeEvent {
  return {
    type: 'companion.invalidated',
    data: { scope, changedAt: '2026-08-28T18:01:00.000Z' },
  };
}

function setOnline(online: boolean) {
  Object.defineProperty(window.navigator, 'onLine', { configurable: true, value: online });
}

beforeEach(() => {
  vi.clearAllMocks();
  auth.role = 'viewer';
  owner.invalidate.mockResolvedValue(undefined);
  setOnline(true);
  snapshotInvalidate.mockResolvedValue(undefined);
  snapshotReset.mockResolvedValue(undefined);
  snapshotUseQuery.mockReturnValue({
    data: SNAPSHOT,
    isPending: false,
    isError: false,
  });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('CompanionHome', () => {
  it('loads one minimal snapshot and subscribes only to Companion invalidations', () => {
    render(home());
    expect(channelSpy).toHaveBeenCalledWith(
      expect.objectContaining({ collection: 'companion', enabled: true })
    );
    expect(snapshotUseQuery).toHaveBeenCalledWith(
      { date: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/) },
      expect.objectContaining({ refetchInterval: 30_000 })
    );
    expect(screen.getByTestId('companion-revenue')).toHaveTextContent('1');
    expect(screen.getByTestId('companion-ticker')).toHaveTextContent('VTA-000001');
    expect(screen.getByTestId('companion-day-close-pending')).toBeInTheDocument();
  });

  it('surfaces attention read-only without action controls', () => {
    snapshotUseQuery.mockReturnValue({
      data: {
        ...SNAPSHOT,
        attention: {
          areas: [{ area: 'fiscal', severity: 'danger', count: 2 }],
          totalCount: 2,
          highestSeverity: 'danger',
        },
      },
      isPending: false,
      isError: false,
    });
    render(home());
    expect(screen.getByTestId('companion-attention-list')).toHaveTextContent(
      'attention.areas.fiscal'
    );
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('renders verified signed-close metadata from the snapshot', () => {
    snapshotUseQuery.mockReturnValue({
      data: {
        ...SNAPSHOT,
        dayClose: {
          date: '2026-08-28',
          reportHash: 'a'.repeat(64),
          signedAt: '2026-08-28T23:10:00.000Z',
          signedBy: { id: 'u-1', name: 'Marta Ruiz' },
        },
      },
      isPending: false,
      isError: false,
    });
    render(home());
    expect(screen.getByTestId('companion-day-close-signed')).toHaveTextContent('dayClose.signed');
    expect(screen.queryByTestId('companion-day-close-pending')).not.toBeInTheDocument();
  });

  it('coalesces sale bursts but refreshes day-close invalidations immediately', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-28T18:00:00.000Z'));
    render(home());
    const channel = captureChannel();

    channel.emit(invalidation('sales'));
    channel.emit(invalidation('sales'));
    expect(snapshotInvalidate).toHaveBeenCalledTimes(1);

    channel.emit(invalidation('day_close'));
    expect(snapshotInvalidate).toHaveBeenCalledTimes(2);

    act(() => vi.advanceTimersByTime(10_000));
    expect(snapshotInvalidate).toHaveBeenCalledTimes(2);
    await act(async () => undefined);
  });

  it('marks a replay gap stale until a verified refetch succeeds', async () => {
    let finishRefresh: (() => void) | undefined;
    snapshotInvalidate.mockImplementationOnce(
      () =>
        new Promise<void>(resolve => {
          finishRefresh = resolve;
        })
    );
    render(home());
    const channel = captureChannel();
    channel.setState('open');
    channel.emit({ type: 'realtime.replay_gap', data: {} });

    expect(screen.getByTestId('companion-connection')).toHaveTextContent('connection.stale');
    expect(snapshotInvalidate).toHaveBeenCalledTimes(1);

    await act(async () => finishRefresh?.());
    expect(screen.getByTestId('companion-connection')).toHaveTextContent('connection.open');
  });

  it('ignores unrelated events and malformed invalidations', () => {
    render(home());
    const channel = captureChannel();
    channel.emit({ type: 'sales.completed', data: { saleId: 'secret-detail' } });
    channel.emit({ type: 'companion.invalidated', data: { scope: 'sales' } });
    channel.emit({ type: 'companion.invalidated', data: { scope: 'inventory', changedAt: 'x' } });
    expect(snapshotInvalidate).not.toHaveBeenCalled();
  });

  it('hides cached operational data while offline and resumes from the network', () => {
    render(home());
    expect(screen.getByTestId('companion-ticker')).toBeInTheDocument();

    setOnline(false);
    act(() => window.dispatchEvent(new Event('offline')));
    expect(screen.getByTestId('companion-offline')).toBeInTheDocument();
    expect(screen.queryByTestId('companion-ticker')).not.toBeInTheDocument();
    expect(screen.queryByTestId('companion-revenue')).not.toBeInTheDocument();
    expect(channelSpy).toHaveBeenLastCalledWith(expect.objectContaining({ enabled: false }));
    expect(snapshotReset).toHaveBeenCalledWith(
      expect.objectContaining({ date: expect.any(String) })
    );

    setOnline(true);
    act(() => window.dispatchEvent(new Event('online')));
    expect(screen.queryByTestId('companion-offline')).not.toBeInTheDocument();
    expect(screen.getByTestId('companion-ticker')).toBeInTheDocument();
  });

  it('does not invent zero totals while the current snapshot is pending or failed', () => {
    snapshotUseQuery.mockReturnValueOnce({ data: undefined, isPending: true, isError: false });
    const view = render(home());
    expect(screen.getByText('snapshot.loading')).toBeInTheDocument();
    expect(screen.queryByTestId('companion-revenue')).not.toBeInTheDocument();

    snapshotUseQuery.mockReturnValue({ data: undefined, isPending: false, isError: true });
    view.rerender(home());
    expect(screen.getByText('snapshot.unavailable')).toBeInTheDocument();
    expect(screen.queryByTestId('companion-revenue')).not.toBeInTheDocument();
  });

  it('gives admins and managers the owner screens and refreshes what they show', async () => {
    auth.role = 'manager';
    render(home('/c/?view=registers'));
    expect(await screen.findByTestId('owner-stub')).toHaveTextContent('registers');
    expect(snapshotUseQuery).not.toHaveBeenCalled();

    captureChannel().emit(invalidation('day_close'));
    expect(owner.invalidate).toHaveBeenCalledTimes(4);
    expect(snapshotInvalidate).not.toHaveBeenCalled();
    await act(async () => undefined);
  });

  it('refreshes only what an approval or a sale changes for the owner', async () => {
    auth.role = 'admin';
    render(home());
    await screen.findByTestId('owner-stub');
    const channel = captureChannel();
    channel.emit(invalidation('sales'));
    // Hoy and today's open checklist.
    expect(owner.invalidate).toHaveBeenCalledTimes(2);
    channel.emit(invalidation('operations'));
    // Hoy and the approvals queue, never the signed day.
    expect(owner.invalidate).toHaveBeenCalledTimes(4);
    await act(async () => undefined);
  });

  it('keeps viewers on the read-only pulse even when a link names an owner tab', () => {
    render(home('/c/?view=day'));
    expect(screen.getByTestId('companion-home')).toBeInTheDocument();
    expect(screen.queryByTestId('owner-stub')).not.toBeInTheDocument();
  });

  it('opens the phone settings on the more tab, also offline', () => {
    setOnline(false);
    render(home('/c/?view=more'));
    expect(screen.getByTestId('more-stub')).toBeInTheDocument();
    expect(screen.queryByTestId('companion-offline')).not.toBeInTheDocument();
  });

  it('asks every refetch to fail loudly so a broken read keeps the gap visible', async () => {
    render(home());
    captureChannel().emit(invalidation('day_close'));
    expect(snapshotInvalidate).toHaveBeenCalledWith({ date: expect.any(String) }, undefined, {
      throwOnError: true,
    });
    await act(async () => undefined);
  });

  it('lets only a full refresh close a replay gap, and keeps a queued sales refresh', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-28T18:00:00.000Z'));
    auth.role = 'manager';
    render(home());
    await act(async () => {
      await vi.dynamicImportSettled();
    });
    const channel = captureChannel();
    channel.setState('open');

    owner.invalidate.mockRejectedValueOnce(new Error('offline'));
    channel.emit({ type: 'realtime.replay_gap', data: {} });
    await act(async () => undefined);
    expect(screen.getByTestId('owner-stub')).toBeInTheDocument();
    owner.invalidate.mockClear();

    // An approval during the gap refetches everything: Hoy, curve, queue and the day close.
    channel.emit(invalidation('operations'));
    expect(owner.invalidate).toHaveBeenCalledTimes(4);
    await act(async () => undefined);
    act(() => vi.advanceTimersByTime(10_000));
    owner.invalidate.mockClear();

    channel.emit(invalidation('sales'));
    expect(owner.invalidate).toHaveBeenCalledTimes(2);
    channel.emit(invalidation('sales'));
    channel.emit(invalidation('operations'));
    // The approval refreshes Hoy and the queue without swallowing the queued sale.
    expect(owner.invalidate).toHaveBeenCalledTimes(4);
    owner.invalidate.mockClear();
    // The throttled sale still refreshes once its window ends.
    act(() => vi.advanceTimersByTime(10_000));
    expect(owner.invalidate).toHaveBeenCalledTimes(2);
    await act(async () => undefined);
  });
});
