/**
 * Companion behaviour tests.
 *
 * The companion's whole value is that it is LIVE and READ-ONLY, so the
 * cases worth pinning are: a sale arriving over the channel appears
 * without a refetch, a replayed event after a reconnect does not
 * double-count it, the seeded backfill and the live entries merge
 * without duplicates, and a dropped channel says so instead of
 * presenting stale data as current.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { act } from 'react';
import type { RealtimeEvent } from '@/hooks/useRealtimeChannel';

const { summaryUseQuery, attentionUseQuery, channelSpy, summaryInvalidate } = vi.hoisted(() => ({
  summaryUseQuery: vi.fn(),
  attentionUseQuery: vi.fn(),
  channelSpy: vi.fn(),
  summaryInvalidate: vi.fn(),
}));

vi.mock('@/lib/trpc', () => ({
  trpc: {
    dashboard: { summary: { useQuery: summaryUseQuery } },
    operations: { needsAttention: { useQuery: attentionUseQuery } },
    useUtils: () => ({ dashboard: { summary: { invalidate: summaryInvalidate } } }),
  },
}));

vi.mock('@/hooks/useRealtimeChannel', () => ({
  useRealtimeChannel: (options: unknown) => channelSpy(options),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

import { CompanionHome } from '../CompanionHome';

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

function saleEvent(saleId: string, saleNumber: string, total: number): RealtimeEvent {
  return {
    type: 'sales.completed',
    data: { saleId, saleNumber, total, completedAt: '2026-08-24T15:00:00.000Z' },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  summaryInvalidate.mockResolvedValue(undefined);
  summaryUseQuery.mockReturnValue({
    data: {
      stats: { todayRevenue: { value: 1000 }, todayOrders: { value: 3 } },
      recentSales: [
        {
          id: 'seed-1',
          saleNumber: 'VTA-000001',
          total: 500,
          createdAt: '2026-08-24T14:00:00.000Z',
        },
      ],
    },
  });
  attentionUseQuery.mockReturnValue({ data: { areas: [], totalCount: 0, highestSeverity: null } });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('CompanionHome', () => {
  it('subscribes to the sales collection', () => {
    render(<CompanionHome />);
    expect(channelSpy).toHaveBeenCalledWith(expect.objectContaining({ collection: 'sales' }));
  });

  it('shows a sale that arrives over the channel without refetching', () => {
    render(<CompanionHome />);
    const channel = captureChannel();
    channel.emit(saleEvent('live-1', 'VTA-000002', 900));

    const ticker = screen.getByTestId('companion-ticker');
    expect(ticker).toHaveTextContent('VTA-000002');
    // The seeded backfill is still there, merged below the live entry.
    expect(ticker).toHaveTextContent('VTA-000001');
    // No extra query was issued for the live update.
    expect(summaryUseQuery).toHaveBeenCalledTimes(2);
  });

  it('does not double-count a replayed event after a reconnect', () => {
    render(<CompanionHome />);
    const channel = captureChannel();
    channel.emit(saleEvent('live-1', 'VTA-000002', 900));
    channel.emit(saleEvent('live-1', 'VTA-000002', 900));

    const rows = screen.getByTestId('companion-ticker').querySelectorAll('li');
    // live + seed, not live + live + seed.
    expect(rows).toHaveLength(2);
  });

  it('never duplicates a sale present in both the seed and the channel', () => {
    render(<CompanionHome />);
    const channel = captureChannel();
    // The same sale the backfill already carried.
    channel.emit(saleEvent('seed-1', 'VTA-000001', 500));

    const rows = screen.getByTestId('companion-ticker').querySelectorAll('li');
    expect(rows).toHaveLength(1);
  });

  it('ignores events of other types and malformed payloads', () => {
    render(<CompanionHome />);
    const channel = captureChannel();
    channel.emit({ type: 'kds.order.created', data: { saleId: 'x' } });
    channel.emit({ type: 'sales.completed', data: { saleId: 42 } });

    const rows = screen.getByTestId('companion-ticker').querySelectorAll('li');
    expect(rows).toHaveLength(1);
  });

  it('says the view is not live when the channel drops', () => {
    render(<CompanionHome />);
    const channel = captureChannel();
    channel.setState('open');
    expect(screen.getByTestId('companion-connection')).toHaveTextContent('connection.open');
    channel.setState('closed');
    expect(screen.getByTestId('companion-connection')).toHaveTextContent('connection.closed');
  });

  it('retracts a sale that was voided or returned', () => {
    render(<CompanionHome />);
    const channel = captureChannel();
    channel.emit(saleEvent('live-1', 'VTA-000002', 900));
    expect(screen.getByTestId('companion-ticker')).toHaveTextContent('VTA-000002');

    channel.emit({ type: 'sales.retracted', data: { saleId: 'live-1', reason: 'voided' } });
    // The register gave the money back: it must leave the ticker.
    expect(screen.getByTestId('companion-ticker')).not.toHaveTextContent('VTA-000002');
  });

  it('retracts a seeded sale too, not only a live one', () => {
    render(<CompanionHome />);
    const channel = captureChannel();
    channel.emit({ type: 'sales.retracted', data: { saleId: 'seed-1', reason: 'returned' } });
    expect(screen.queryByTestId('companion-ticker')).toBeNull();
  });

  it('stays stale and clears local overlays until a replay gap is reseeded', async () => {
    let finishReseed: (() => void) | undefined;
    render(<CompanionHome />);
    const channel = captureChannel();
    channel.setState('open');
    expect(screen.getByTestId('companion-connection')).toHaveTextContent('connection.open');
    channel.emit(saleEvent('live-1', 'VTA-000002', 900));
    expect(screen.getByTestId('companion-ticker')).toHaveTextContent('VTA-000002');
    summaryInvalidate.mockImplementationOnce(
      () =>
        new Promise<void>(resolve => {
          finishReseed = resolve;
        })
    );

    // The channel dropped events we will never receive: the ticker is
    // knowingly incomplete, so the header must say so.
    channel.emit({ type: 'realtime.replay_gap', data: {} });
    expect(screen.getByTestId('companion-connection')).toHaveTextContent('connection.stale');
    expect(summaryInvalidate).toHaveBeenCalled();
    expect(screen.getByTestId('companion-ticker')).not.toHaveTextContent('VTA-000002');

    await act(async () => finishReseed?.());
    expect(screen.getByTestId('companion-connection')).toHaveTextContent('connection.open');
  });

  it('recovers a failed replay-gap seed after a later event refresh succeeds', async () => {
    summaryInvalidate.mockRejectedValueOnce(new Error('offline'));
    render(<CompanionHome />);
    const channel = captureChannel();
    channel.setState('open');

    channel.emit({ type: 'realtime.replay_gap', data: {} });
    await act(async () => undefined);
    expect(screen.getByTestId('companion-connection')).toHaveTextContent('connection.stale');

    channel.emit(saleEvent('live-after-gap', 'VTA-000004', 700));
    await act(async () => undefined);
    expect(summaryInvalidate).toHaveBeenCalledTimes(2);
    expect(screen.getByTestId('companion-connection')).toHaveTextContent('connection.open');
  });

  it('refreshes the pulse when a sale arrives so it cannot drift below the ticker', () => {
    render(<CompanionHome />);
    const channel = captureChannel();
    channel.emit(saleEvent('live-1', 'VTA-000002', 900));
    expect(summaryInvalidate).toHaveBeenCalledTimes(1);
  });

  it('coalesces a burst but still runs a trailing pulse refresh', () => {
    vi.useFakeTimers();
    render(<CompanionHome />);
    const channel = captureChannel();
    channel.emit(saleEvent('live-1', 'VTA-000002', 900));
    channel.emit(saleEvent('live-2', 'VTA-000003', 500));
    expect(summaryInvalidate).toHaveBeenCalledTimes(1);

    act(() => vi.advanceTimersByTime(10_000));
    expect(summaryInvalidate).toHaveBeenCalledTimes(2);
  });

  it('surfaces attention areas read-only', () => {
    attentionUseQuery.mockReturnValue({
      data: {
        areas: [{ area: 'fiscal', severity: 'danger', count: 2 }],
        totalCount: 2,
        highestSeverity: 'danger',
      },
    });
    render(<CompanionHome />);
    const list = screen.getByTestId('companion-attention-list');
    expect(list).toHaveTextContent('attention.areas.fiscal');
    expect(list).toHaveTextContent('2');
    // No action controls: the companion never mutates.
    expect(screen.queryByRole('button')).toBeNull();
  });
});
