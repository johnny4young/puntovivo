import { act } from 'react';
import { renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SaleCartItem, SaleCartSummary } from '@/features/sales/saleCart';
import {
  buildCustomerDisplayProjection,
  CustomerDisplayBus,
  CUSTOMER_DISPLAY_MAX_FUTURE_SKEW_MS,
  CUSTOMER_DISPLAY_STALE_AFTER_MS,
  customerDisplayStorageKey,
  type CustomerDisplayScope,
} from '../customerDisplayProjection';
import { useCustomerDisplayFeed } from '../useCustomerDisplayFeed';
import {
  useCustomerDisplayPublisher,
  type CustomerDisplayPublisherInput,
} from '../useCustomerDisplayPublisher';

class FakeBroadcastChannel {
  static instances = new Set<FakeBroadcastChannel>();
  static created = 0;

  private readonly listeners = new Set<(event: MessageEvent<unknown>) => void>();

  constructor(readonly name: string) {
    FakeBroadcastChannel.created += 1;
    FakeBroadcastChannel.instances.add(this);
  }

  addEventListener(_type: 'message', listener: (event: MessageEvent<unknown>) => void) {
    this.listeners.add(listener);
  }

  removeEventListener(_type: 'message', listener: (event: MessageEvent<unknown>) => void) {
    this.listeners.delete(listener);
  }

  postMessage(data: unknown) {
    for (const instance of FakeBroadcastChannel.instances) {
      if (instance === this || instance.name !== this.name) continue;
      for (const listener of instance.listeners) listener({ data } as MessageEvent<unknown>);
    }
  }

  close() {
    FakeBroadcastChannel.instances.delete(this);
    this.listeners.clear();
  }

  static reset() {
    for (const instance of [...FakeBroadcastChannel.instances]) instance.close();
    FakeBroadcastChannel.created = 0;
  }
}

const scope: CustomerDisplayScope = {
  accessId: '11111111-1111-4111-8111-111111111111',
  tenantId: 'tenant-1',
  siteId: 'site-1',
  cashSessionId: 'session-1',
};

function setOnline(value: boolean) {
  Object.defineProperty(window.navigator, 'onLine', { configurable: true, value });
}

function projection(publishedAt = new Date().toISOString()) {
  return buildCustomerDisplayProjection({
    scope,
    revision: Date.now(),
    publishedAt,
    registerName: 'Caja principal',
    currency: 'COP',
    items: [],
    summary: { itemCount: 0, subtotal: 0, taxAmount: 0, total: 0 },
    priceIncludesTax: false,
  });
}

function cartItem(): SaleCartItem {
  return {
    key: 'product-1:unit-1',
    productId: 'product-1',
    productName: 'Pan',
    productSku: 'PAN-1',
    unitId: 'unit-1',
    unitName: 'Unidad',
    unitEquivalence: 1,
    quantity: 1,
    unitPrice: 2_000,
    discount: 0,
    taxRate: 0,
    availableStock: 20,
    tracksStock: true,
    sellByFraction: false,
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-09-04T18:00:00.000Z'));
  window.localStorage.clear();
  setOnline(true);
  FakeBroadcastChannel.reset();
  vi.stubGlobal('BroadcastChannel', FakeBroadcastChannel as unknown as typeof BroadcastChannel);
});

afterEach(() => {
  FakeBroadcastChannel.reset();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('useCustomerDisplayFeed', () => {
  it('accepts only the paired access id and expires stale projections', () => {
    const foreignBus = new CustomerDisplayBus();
    const { result } = renderHook(() => useCustomerDisplayFeed(scope.accessId, null));

    act(() => {
      foreignBus.publish({
        ...projection(),
        accessId: '22222222-2222-4222-8222-222222222222',
        cashSessionId: 'foreign-session',
      });
    });
    expect(result.current.projection).toBeNull();
    expect(result.current.projections).toEqual([]);

    act(() => foreignBus.publish(projection()));
    expect(result.current.connection).toBe('live');

    act(() => vi.advanceTimersByTime(CUSTOMER_DISPLAY_STALE_AFTER_MS + 1_000));
    expect(result.current.connection).toBe('waiting');
    expect(result.current.projection).toBeNull();
    expect(result.current.projections).toHaveLength(1);
    foreignBus.close();
  });

  it('rejects a far-future snapshot and hides all data immediately when offline', () => {
    const publisher = new CustomerDisplayBus();
    publisher.publish(
      projection(new Date(Date.now() + CUSTOMER_DISPLAY_MAX_FUTURE_SKEW_MS + 1_000).toISOString())
    );
    const { result } = renderHook(() => useCustomerDisplayFeed(scope.accessId, null));
    expect(result.current.connection).toBe('waiting');

    act(() => publisher.publish(projection()));
    expect(result.current.connection).toBe('live');

    setOnline(false);
    act(() => window.dispatchEvent(new Event('offline')));
    expect(result.current.connection).toBe('offline');
    expect(result.current.projection).toBeNull();
    publisher.close();
  });

  it('re-reads scoped storage when the operator reconnects', () => {
    const current = projection();
    window.localStorage.setItem(customerDisplayStorageKey(scope), JSON.stringify(current));
    const { result } = renderHook(() => useCustomerDisplayFeed(scope.accessId, null));
    expect(result.current.projection).toEqual(current);

    act(() => result.current.reconnect());
    expect(result.current.projection).toEqual(current);
  });

  it('switches explicitly between paired register projections', () => {
    const publisher = new CustomerDisplayBus();
    const otherScope = { ...scope, cashSessionId: 'session-2' };
    const { result, rerender } = renderHook(
      ({ value }: { value: string | null }) => useCustomerDisplayFeed(scope.accessId, value),
      { initialProps: { value: null as string | null } }
    );

    act(() => publisher.publish(projection()));
    expect(result.current.connection).toBe('live');

    act(() =>
      publisher.publish({
        ...projection(),
        ...otherScope,
        registerName: 'Caja secundaria',
        revision: Date.now() + 1,
      })
    );
    rerender({ value: otherScope.cashSessionId });
    expect(result.current.connection).toBe('live');
    expect(result.current.projection?.cashSessionId).toBe('session-2');
    publisher.close();
  });

  it('hides the previous pairing immediately when the URL capability changes', () => {
    const publisher = new CustomerDisplayBus();
    const { result, rerender } = renderHook(
      ({ accessId }: { accessId: string | null }) => useCustomerDisplayFeed(accessId, null),
      { initialProps: { accessId: scope.accessId as string | null } }
    );

    act(() => publisher.publish(projection()));
    expect(result.current.connection).toBe('live');

    rerender({ accessId: '22222222-2222-4222-8222-222222222222' });
    expect(result.current.projections).toEqual([]);
    expect(result.current.projection).toBeNull();
    expect(result.current.connection).toBe('waiting');
    publisher.close();
  });
});

describe('useCustomerDisplayPublisher', () => {
  it('reuses one channel, emits relevant updates and clears the scoped snapshot on teardown', () => {
    const items = [cartItem()];
    const summary: SaleCartSummary = {
      itemCount: 1,
      subtotal: 2_000,
      taxAmount: 0,
      total: 2_000,
    };
    const input: CustomerDisplayPublisherInput = {
      ...scope,
      registerName: 'Caja principal',
      currency: 'COP',
      items,
      summary,
      priceIncludesTax: false,
    };
    const { rerender, unmount } = renderHook(
      ({ value }: { value: CustomerDisplayPublisherInput | null }) =>
        useCustomerDisplayPublisher(value),
      { initialProps: { value: input } }
    );
    const initialRaw = window.localStorage.getItem(customerDisplayStorageKey(scope));
    expect(initialRaw).not.toBeNull();
    expect(FakeBroadcastChannel.created).toBe(1);

    rerender({ value: { ...input } });
    expect(FakeBroadcastChannel.created).toBe(1);
    expect(window.localStorage.getItem(customerDisplayStorageKey(scope))).toBe(initialRaw);

    rerender({
      value: {
        ...input,
        summary: { ...summary, total: 2_500 },
      },
    });
    const updatedRaw = window.localStorage.getItem(customerDisplayStorageKey(scope));
    expect(updatedRaw).not.toBe(initialRaw);
    expect(JSON.parse(updatedRaw ?? '{}')).toMatchObject({ summary: { total: 2_500 } });
    expect(FakeBroadcastChannel.created).toBe(1);

    unmount();
    expect(window.localStorage.getItem(customerDisplayStorageKey(scope))).toBeNull();
  });
});
