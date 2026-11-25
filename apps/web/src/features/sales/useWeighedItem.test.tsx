import { describe, expect, it, vi } from 'vitest';
import type { ReactElement } from 'react';
import { act, renderHook } from '@testing-library/react';
import { getCartItemKey, type SaleCartItem } from '@/features/sales/saleCart';
import { useWeighedItem } from '@/features/sales/useWeighedItem';
import type { ProductSearchSelection } from '@/types';

const zone = vi.hoisted(() => ({ on: true }));
vi.mock('@/features/modules/useRegisterZone', () => ({ useRegisterZone: () => zone.on }));

const selection = {
  product: { id: 'p-kg', name: 'Queso', sku: 'Q', price: 24000, stock: 1, sellByFraction: true },
  unit: {
    id: 'ua',
    unitId: 'u-kg',
    equivalence: 1,
    price: 24000,
    isBase: true,
    unitDimension: 'mass',
    unitReferenceFactor: 1000,
  },
  price: 24000,
} as unknown as ProductSearchSelection;
const line = { key: getCartItemKey('p-kg', 'u-kg'), unitPrice: 24000 } as SaleCartItem;

interface Props {
  cartItems: SaleCartItem[];
  scope?: string | null;
  locked?: boolean;
  priceTier?: 1 | 2 | 3;
}

function setup(initial: Props) {
  return renderHook((props: Props) => useWeighedItem({ setCartItems: vi.fn(), ...props }), {
    initialProps: initial,
  });
}

describe('useWeighedItem', () => {
  it('opens only for by-weight products while the zone is on and the ticket is open', () => {
    zone.on = true;
    const { result, rerender } = setup({ cartItems: [], scope: 'w-1' });
    const unitOnly = { ...selection, product: { ...selection.product, sellByFraction: false } };
    let opened = true;
    act(() => {
      opened = result.current.open(unitOnly as ProductSearchSelection);
    });
    expect(opened).toBe(false);
    act(() => {
      opened = result.current.open(selection);
    });
    expect(opened).toBe(true);
    expect(result.current.panel).toBeDefined();
    expect(result.current.weighingProductId).toBe('p-kg');

    rerender({ cartItems: [], scope: 'w-1', locked: true });
    act(() => {
      opened = result.current.open(selection);
    });
    expect(opened).toBe(false);

    zone.on = false;
    rerender({ cartItems: [], scope: 'w-1' });
    act(() => {
      opened = result.current.open(selection);
    });
    expect(opened).toBe(false);
    zone.on = true;
  });

  it('ends on another ticket or when the ticket locks', () => {
    const { result, rerender } = setup({ cartItems: [], scope: 'w-1' });
    act(() => {
      result.current.open(selection);
    });
    rerender({ cartItems: [], scope: 'w-2' });
    expect(result.current.panel).toBeUndefined();
    rerender({ cartItems: [], scope: 'w-1' });
    expect(result.current.panel).toBeUndefined();

    act(() => {
      result.current.open(selection);
    });
    rerender({ cartItems: [line], scope: 'w-1', locked: true });
    expect(result.current.panel).toBeUndefined();
    expect(result.current.weighingProductId).toBeNull();
  });

  it('previews a line not yet on the ticket at the ticket tier', () => {
    zone.on = true;
    const tiered = {
      ...selection,
      product: { ...selection.product, price2: 20000, price3: 18000 },
      unit: { ...selection.unit, price2: 20000, price3: 18000 },
    } as ProductSearchSelection;
    const { result } = setup({ cartItems: [], scope: null, priceTier: 2 });
    act(() => {
      result.current.open(tiered);
    });
    const suspense = result.current.panel as ReactElement<{
      children: ReactElement<{ line: SaleCartItem }>;
    }>;
    expect(suspense.props.children.props.line.unitPrice).toBe(20000);
  });
});
