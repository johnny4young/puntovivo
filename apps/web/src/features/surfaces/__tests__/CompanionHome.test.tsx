import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { RealtimeEvent } from '@/hooks/useRealtimeChannel';

const { snapshotUseQuery, snapshotInvalidate, snapshotReset, channelSpy } = vi.hoisted(() => ({
  snapshotUseQuery: vi.fn(),
  snapshotInvalidate: vi.fn(),
  snapshotReset: vi.fn(),
  channelSpy: vi.fn(),
}));

vi.mock('@/lib/trpc', () => ({
  trpc: {
    companion: { snapshot: { useQuery: snapshotUseQuery } },
    useUtils: () => ({
      companion: { snapshot: { invalidate: snapshotInvalidate, reset: snapshotReset } },
    }),
  },
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

function invalidation(scope: 'sales' | 'day_close'): RealtimeEvent {
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
    render(<CompanionHome />);
    expect(channelSpy).toHaveBeenCalledWith(
      expect.objectContaining({ collection: 'companion', enabled: true })
    );
    expect(snapshotUseQuery).toHaveBeenCalledWith(
      { date: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/) },
      expect.objectContaining({ enabled: true, refetchInterval: 30_000 })
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
    render(<CompanionHome />);
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
    render(<CompanionHome />);
    expect(screen.getByTestId('companion-day-close-signed')).toHaveTextContent('dayClose.signed');
    expect(screen.queryByTestId('companion-day-close-pending')).not.toBeInTheDocument();
  });

  it('coalesces sale bursts but refreshes day-close invalidations immediately', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-28T18:00:00.000Z'));
    render(<CompanionHome />);
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
    render(<CompanionHome />);
    const channel = captureChannel();
    channel.setState('open');
    channel.emit({ type: 'realtime.replay_gap', data: {} });

    expect(screen.getByTestId('companion-connection')).toHaveTextContent('connection.stale');
    expect(snapshotInvalidate).toHaveBeenCalledTimes(1);

    await act(async () => finishRefresh?.());
    expect(screen.getByTestId('companion-connection')).toHaveTextContent('connection.open');
  });

  it('ignores unrelated events and malformed invalidations', () => {
    render(<CompanionHome />);
    const channel = captureChannel();
    channel.emit({ type: 'sales.completed', data: { saleId: 'secret-detail' } });
    channel.emit({ type: 'companion.invalidated', data: { scope: 'sales' } });
    channel.emit({ type: 'companion.invalidated', data: { scope: 'inventory', changedAt: 'x' } });
    expect(snapshotInvalidate).not.toHaveBeenCalled();
  });

  it('hides cached operational data while offline and resumes from the network', () => {
    render(<CompanionHome />);
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
    const view = render(<CompanionHome />);
    expect(screen.getByText('snapshot.loading')).toBeInTheDocument();
    expect(screen.queryByTestId('companion-revenue')).not.toBeInTheDocument();

    snapshotUseQuery.mockReturnValue({ data: undefined, isPending: false, isError: true });
    view.rerender(<CompanionHome />);
    expect(screen.getByText('snapshot.unavailable')).toBeInTheDocument();
    expect(screen.queryByTestId('companion-revenue')).not.toBeInTheDocument();
  });
});
