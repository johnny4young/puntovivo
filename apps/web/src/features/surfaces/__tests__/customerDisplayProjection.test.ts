import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SaleCartItem } from '@/features/sales/saleCart';
import {
  buildCustomerDisplayProjection,
  clearAllCustomerDisplayProjections,
  CustomerDisplayBus,
  CUSTOMER_DISPLAY_MAX_LINES,
  CUSTOMER_DISPLAY_STORAGE_PREFIX,
  customerDisplayStorageKey,
  getOrCreateCustomerDisplayAccessId,
  isCustomerDisplayAccessId,
  parseCustomerDisplayProjection,
  type CustomerDisplayProjection,
  type CustomerDisplayScope,
} from '../customerDisplayProjection';

const scope: CustomerDisplayScope = {
  accessId: '11111111-1111-4111-8111-111111111111',
  tenantId: 'tenant-1',
  siteId: 'site-1',
  cashSessionId: 'session-1',
};

function cartItem(overrides: Partial<SaleCartItem> = {}): SaleCartItem {
  return {
    key: 'product-1:unit-1',
    productId: 'product-1',
    productName: 'Café molido',
    productSku: 'SECRET-SKU',
    unitId: 'unit-1',
    unitName: 'Bolsa',
    unitEquivalence: 1,
    quantity: 2,
    unitPrice: 10,
    discount: 10,
    taxRate: 19,
    availableStock: 100,
    tracksStock: true,
    sellByFraction: false,
    serialIds: ['SECRET-SERIAL'],
    ...overrides,
  };
}

type ProjectionInput = Parameters<typeof buildCustomerDisplayProjection>[0];

function projection(overrides: Partial<ProjectionInput> = {}): CustomerDisplayProjection {
  return buildCustomerDisplayProjection({
    scope,
    revision: 7,
    publishedAt: '2026-09-04T18:00:00.000Z',
    registerName: 'Caja principal',
    currency: 'cop',
    items: [cartItem()],
    summary: { itemCount: 2, subtotal: 18, taxAmount: 3.42, total: 21.42 },
    priceIncludesTax: false,
    ...overrides,
  });
}

beforeEach(() => {
  window.localStorage.clear();
  vi.stubGlobal('BroadcastChannel', undefined);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Customer Display projection boundary', () => {
  it('publishes only customer-safe line fields and normalized totals', () => {
    const result = projection();

    expect(result.currency).toBe('COP');
    expect(result.items).toEqual([
      {
        name: 'Café molido',
        unitName: 'Bolsa',
        quantity: 2,
        unitPrice: 10,
        discountPercent: 10,
        total: 21.42,
      },
    ]);
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain('product-1:unit-1');
    expect(serialized).not.toContain('SECRET-SKU');
    expect(serialized).not.toContain('SECRET-SERIAL');
    expect(serialized).not.toContain('availableStock');
    expect(serialized).not.toContain('taxRate');
    expect(serialized).not.toContain('productId');
  });

  it('bounds line count, strings, discounts, quantities and negative money', () => {
    const items = Array.from({ length: CUSTOMER_DISPLAY_MAX_LINES + 1 }, (_, index) =>
      cartItem({
        key: `internal-product-${index}`,
        productName: 'x'.repeat(200),
        unitName: 'y'.repeat(100),
        quantity: Number.NaN,
        unitPrice: -1,
        discount: 900,
      })
    );
    const result = projection({
      items,
      summary: { itemCount: -4, subtotal: -1, taxAmount: Number.NaN, total: -2 },
    });

    expect(result.items).toHaveLength(CUSTOMER_DISPLAY_MAX_LINES);
    expect(result.items[0]).toMatchObject({
      quantity: 0,
      unitPrice: 0,
      discountPercent: 100,
      total: 0,
    });
    expect(result.items[0]?.name).toHaveLength(160);
    expect(result.items[0]?.unitName).toHaveLength(80);
    expect(result.summary).toEqual({ itemCount: 0, subtotal: 0, taxAmount: 0, total: 0 });
  });

  it.each([
    ['unknown schema', { schemaVersion: 2 }],
    ['invalid pairing capability', { accessId: 'tenant-1' }],
    ['zero revision', { revision: 0 }],
    ['fractional revision', { revision: 1.5 }],
    ['unsafe revision', { revision: Number.MAX_SAFE_INTEGER + 1 }],
    ['non-canonical timestamp', { publishedAt: '2026-09-04 18:00:00Z' }],
    ['invalid timestamp', { publishedAt: 'not-a-date' }],
    ['oversized register', { registerName: 'r'.repeat(81) }],
    ['invalid currency', { currency: 'COPX' }],
    ['non-alphabetic currency', { currency: '12$' }],
    ['negative summary', { summary: { itemCount: 1, subtotal: -1, taxAmount: 0, total: 1 } }],
  ])('rejects %s', (_label, change) => {
    expect(parseCustomerDisplayProjection({ ...projection(), ...change })).toBeNull();
  });

  it('rejects malformed, oversized and economically invalid lines', () => {
    const valid = projection();
    expect(
      parseCustomerDisplayProjection({
        ...valid,
        items: Array.from({ length: CUSTOMER_DISPLAY_MAX_LINES + 1 }, () => valid.items[0]),
      })
    ).toBeNull();
    expect(
      parseCustomerDisplayProjection({
        ...valid,
        items: [{ ...valid.items[0], discountPercent: 101 }],
      })
    ).toBeNull();
    expect(
      parseCustomerDisplayProjection({
        ...valid,
        items: [{ ...valid.items[0], total: Number.POSITIVE_INFINITY }],
      })
    ).toBeNull();
  });
});

describe('CustomerDisplayBus storage lifecycle', () => {
  it('round-trips only the exact scoped projection and clears it', () => {
    const bus = new CustomerDisplayBus();
    const current = projection();
    bus.publish(current);

    expect(bus.read(scope)).toEqual(current);
    expect(bus.read({ ...scope, cashSessionId: 'different-session' })).toBeNull();
    expect(bus.readAccess(scope.accessId)).toEqual([current]);
    expect(bus.readAccess('22222222-2222-4222-8222-222222222222')).toEqual([]);

    bus.clear(scope);
    expect(bus.read(scope)).toBeNull();
    bus.close();
  });

  it('creates a stable random pairing per tenant and site', () => {
    const first = getOrCreateCustomerDisplayAccessId(scope.tenantId, scope.siteId);
    const repeated = getOrCreateCustomerDisplayAccessId(scope.tenantId, scope.siteId);
    const otherSite = getOrCreateCustomerDisplayAccessId(scope.tenantId, 'site-2');

    expect(isCustomerDisplayAccessId(first)).toBe(true);
    expect(repeated).toBe(first);
    expect(otherSite).not.toBe(first);
  });

  it('clears all display projections without removing unrelated storage', () => {
    getOrCreateCustomerDisplayAccessId(scope.tenantId, scope.siteId);
    window.localStorage.setItem(customerDisplayStorageKey(scope), JSON.stringify(projection()));
    window.localStorage.setItem(
      `${CUSTOMER_DISPLAY_STORAGE_PREFIX}another:site:session`,
      JSON.stringify(projection())
    );
    window.localStorage.setItem('puntovivo:unrelated', 'keep');

    clearAllCustomerDisplayProjections();

    expect(window.localStorage.getItem(customerDisplayStorageKey(scope))).toBeNull();
    expect(
      window.localStorage.getItem(`${CUSTOMER_DISPLAY_STORAGE_PREFIX}another:site:session`)
    ).toBeNull();
    expect(window.localStorage.getItem('puntovivo:unrelated')).toBe('keep');
    expect(
      Object.keys(window.localStorage).some(key =>
        key.startsWith('puntovivo:customer-display-access:v1:')
      )
    ).toBe(false);
  });

  it('keeps checkout and logout safe when BroadcastChannel is blocked', () => {
    vi.stubGlobal(
      'BroadcastChannel',
      class {
        constructor() {
          throw new DOMException('Blocked by browser policy', 'SecurityError');
        }
      }
    );

    expect(() => {
      const bus = new CustomerDisplayBus();
      bus.publish(projection());
      expect(bus.read(scope)).not.toBeNull();
      bus.close();
      clearAllCustomerDisplayProjections();
    }).not.toThrow();
  });

  it('falls back to storage when an existing channel rejects messages', () => {
    vi.stubGlobal(
      'BroadcastChannel',
      class {
        addEventListener() {}
        removeEventListener() {}
        postMessage() {
          throw new DOMException('Channel closed', 'InvalidStateError');
        }
        close() {}
      }
    );

    const bus = new CustomerDisplayBus();
    expect(() => bus.publish(projection())).not.toThrow();
    expect(bus.read(scope)).not.toBeNull();
    expect(() => bus.request(scope)).not.toThrow();
    expect(() => bus.clear(scope)).not.toThrow();
    expect(() => bus.close()).not.toThrow();
  });
});
