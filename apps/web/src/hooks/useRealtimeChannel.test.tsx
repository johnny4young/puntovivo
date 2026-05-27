/**
 * ENG-098 — `useRealtimeChannel` unit tests.
 *
 * Covered:
 * - Constructs an EventSource against the resolved API base URL.
 * - Routes named events through `onEvent` with parsed JSON data.
 * - Tears the EventSource down on unmount.
 * - Skips `heartbeat` + `connected` housekeeping events.
 * - Refreshes the realtime token when the server asks for rotation.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import {
  useRealtimeChannel,
  type RealtimeEvent,
} from './useRealtimeChannel';

type Listener = (ev: MessageEvent) => void;

class FakeEventSource {
  static instances: FakeEventSource[] = [];
  url: string;
  init?: EventSourceInit;
  readyState = 0;
  listeners = new Map<string, Listener[]>();
  closed = false;
  constructor(url: string, init?: EventSourceInit) {
    this.url = url;
    this.init = init;
    FakeEventSource.instances.push(this);
  }
  addEventListener(type: string, listener: Listener): void {
    const arr = this.listeners.get(type) ?? [];
    arr.push(listener);
    this.listeners.set(type, arr);
  }
  removeEventListener(type: string, listener: Listener): void {
    const arr = this.listeners.get(type) ?? [];
    this.listeners.set(
      type,
      arr.filter(item => item !== listener)
    );
  }
  emit(type: string, data: string, lastEventId = ''): void {
    const arr = this.listeners.get(type) ?? [];
    for (const listener of arr) {
      listener(new MessageEvent(type, { data, lastEventId }));
    }
  }
  close(): void {
    this.closed = true;
    this.readyState = 2;
  }
}
(FakeEventSource as unknown as { CLOSED: number }).CLOSED = 2;

const RealEventSource = globalThis.EventSource;

beforeEach(() => {
  FakeEventSource.instances = [];
  // @ts-expect-error - jsdom does not implement EventSource by default.
  globalThis.EventSource = FakeEventSource;
});

afterEach(() => {
  if (RealEventSource) {
    globalThis.EventSource = RealEventSource;
  } else {
    // @ts-expect-error - remove the polyfill we set above.
    delete globalThis.EventSource;
  }
});

describe('useRealtimeChannel', () => {
  it('opens an EventSource at the authenticated collection URL', async () => {
    renderHook(() =>
      useRealtimeChannel({
        collection: 'kds',
        onEvent: () => {},
        apiBaseUrl: 'http://test-host',
        authorize: async () => {},
      })
    );
    await waitFor(() => expect(FakeEventSource.instances).toHaveLength(1));
    expect(FakeEventSource.instances[0].url).toBe(
      'http://test-host/api/realtime/subscribe?collections=kds'
    );
    expect(FakeEventSource.instances[0].init).toMatchObject({ withCredentials: true });
  });

  it('routes a named event with parsed JSON data through onEvent', async () => {
    const received: RealtimeEvent[] = [];
    renderHook(() =>
      useRealtimeChannel({
        collection: 'kds',
        onEvent: (ev: RealtimeEvent) => received.push(ev),
        apiBaseUrl: 'http://test-host',
        authorize: async () => {},
      })
    );
    await waitFor(() => expect(FakeEventSource.instances).toHaveLength(1));
    const source = FakeEventSource.instances[0];
    source.emit('kds.order.created', '{"saleId":"sale-1"}', 'evt-1');
    expect(received).toHaveLength(1);
    expect(received[0]).toMatchObject({
      type: 'kds.order.created',
      id: 'evt-1',
    });
    expect((received[0].data as { saleId: string }).saleId).toBe('sale-1');
  });

  it('does not fire onEvent for heartbeat or connected events', async () => {
    const received: RealtimeEvent[] = [];
    renderHook(() =>
      useRealtimeChannel({
        collection: 'kds',
        onEvent: (ev: RealtimeEvent) => received.push(ev),
        apiBaseUrl: 'http://test-host',
        authorize: async () => {},
      })
    );
    await waitFor(() => expect(FakeEventSource.instances).toHaveLength(1));
    const source = FakeEventSource.instances[0];
    source.emit('heartbeat', '{"ts":1}');
    source.emit('connected', '{"clientId":"x"}');
    expect(received).toHaveLength(0);
  });

  it('refreshes the realtime token when token-refresh-needed arrives', async () => {
    const authorize = vi.fn(async () => undefined);
    renderHook(() =>
      useRealtimeChannel({
        collection: 'kds',
        onEvent: () => {},
        apiBaseUrl: 'http://test-host',
        authorize,
      })
    );
    await waitFor(() => expect(FakeEventSource.instances).toHaveLength(1));
    expect(authorize).toHaveBeenCalledTimes(1);

    FakeEventSource.instances[0].emit('token-refresh-needed', '{"timestamp":"2026-05-26T00:00:00.000Z"}');

    await waitFor(() => expect(authorize).toHaveBeenCalledTimes(2));
  });

  it('closes the EventSource on unmount', async () => {
    const { unmount } = renderHook(() =>
      useRealtimeChannel({
        collection: 'kds',
        onEvent: () => {},
        apiBaseUrl: 'http://test-host',
        authorize: async () => {},
      })
    );
    await waitFor(() => expect(FakeEventSource.instances).toHaveLength(1));
    const source = FakeEventSource.instances[0];
    unmount();
    expect(source.closed).toBe(true);
  });

  it('skips initialization when disabled', () => {
    renderHook(() =>
      useRealtimeChannel({
        collection: 'kds',
        onEvent: () => {},
        apiBaseUrl: 'http://test-host',
        enabled: false,
      })
    );
    expect(FakeEventSource.instances).toHaveLength(0);
  });
});
