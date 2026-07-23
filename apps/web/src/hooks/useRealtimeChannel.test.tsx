import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useRealtimeChannel, type RealtimeEvent } from './useRealtimeChannel';
import type { RealtimeConnector, RealtimeConnectorInput } from '@/lib/realtimeTransport';

interface ControlledCall {
  input: RealtimeConnectorInput;
  resolve: () => void;
  reject: (error: Error) => void;
}

function controlledConnector(): { connector: RealtimeConnector; calls: ControlledCall[] } {
  const calls: ControlledCall[] = [];
  return {
    calls,
    connector: input =>
      new Promise<void>((resolve, reject) => {
        calls.push({ input, resolve, reject });
      }),
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('useRealtimeChannel', () => {
  it('opens through the authenticated connector and reports state', async () => {
    const controlled = controlledConnector();
    const states: string[] = [];
    renderHook(() =>
      useRealtimeChannel({
        collection: 'kds',
        connector: controlled.connector,
        onEvent: () => {},
        onStateChange: state => states.push(state),
      })
    );

    await waitFor(() => expect(controlled.calls).toHaveLength(1));
    expect(controlled.calls[0]?.input.collections).toBe('kds');
    expect(controlled.calls[0]?.input.lastEventId).toBeNull();
    act(() => controlled.calls[0]?.input.onOpen());
    expect(states).toEqual(['connecting', 'open']);
  });

  it('parses event JSON and preserves plain text payloads', async () => {
    const controlled = controlledConnector();
    const received: RealtimeEvent[] = [];
    renderHook(() =>
      useRealtimeChannel({
        collection: 'kds',
        connector: controlled.connector,
        onEvent: event => received.push(event),
      })
    );
    await waitFor(() => expect(controlled.calls).toHaveLength(1));

    act(() => {
      controlled.calls[0]?.input.onEvent({
        event: 'kds.order.created',
        data: '{"saleId":"sale-1"}',
        id: '7',
      });
      controlled.calls[0]?.input.onEvent({ event: 'kds.order.updated', data: 'plain' });
    });

    expect(received).toEqual([
      { type: 'kds.order.created', data: { saleId: 'sale-1' }, id: '7' },
      { type: 'kds.order.updated', data: 'plain', id: undefined },
    ]);
  });

  it('ignores connection housekeeping events', async () => {
    const controlled = controlledConnector();
    const onEvent = vi.fn();
    renderHook(() =>
      useRealtimeChannel({ collection: 'kds', connector: controlled.connector, onEvent })
    );
    await waitFor(() => expect(controlled.calls).toHaveLength(1));

    act(() => {
      controlled.calls[0]?.input.onEvent({ event: 'connected', data: '{}' });
      controlled.calls[0]?.input.onEvent({ event: 'heartbeat', data: '{}' });
    });

    expect(onEvent).not.toHaveBeenCalled();
  });

  it('reconnects with the last cursor after a bounded delay', async () => {
    vi.useFakeTimers();
    const controlled = controlledConnector();
    const { unmount } = renderHook(() =>
      useRealtimeChannel({
        collection: 'kds',
        connector: controlled.connector,
        onEvent: () => {},
      })
    );
    await act(async () => Promise.resolve());
    act(() => {
      controlled.calls[0]?.input.onEvent({ event: 'kds.order.created', data: '{}', id: '37' });
      controlled.calls[0]?.resolve();
    });
    await act(async () => vi.advanceTimersByTimeAsync(5_000));

    expect(controlled.calls).toHaveLength(2);
    expect(controlled.calls[1]?.input.lastEventId).toBe('37');
    unmount();
  });

  it('aborts the active connector on unmount', async () => {
    const controlled = controlledConnector();
    const { unmount } = renderHook(() =>
      useRealtimeChannel({
        collection: 'kds',
        connector: controlled.connector,
        onEvent: () => {},
      })
    );
    await waitFor(() => expect(controlled.calls).toHaveLength(1));
    const signal = controlled.calls[0]!.input.signal;

    unmount();

    expect(signal.aborted).toBe(true);
  });

  it('skips initialization when disabled', () => {
    const controlled = controlledConnector();
    renderHook(() =>
      useRealtimeChannel({
        collection: 'kds',
        connector: controlled.connector,
        onEvent: () => {},
        enabled: false,
      })
    );
    expect(controlled.calls).toHaveLength(0);
  });
});
