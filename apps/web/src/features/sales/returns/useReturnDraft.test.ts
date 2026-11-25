import { describe, expect, it } from 'vitest';
import type { SaleItem } from '@/types';
import { lineName } from './useReturnDraft';

function line(overrides: Partial<SaleItem>): SaleItem {
  return {
    id: 'line-1',
    saleId: 'sale-1',
    productId: 'product-1',
    productNameSnapshot: 'Gaseosa Cola 400ml',
    quantity: 1,
    unitPrice: 2500,
    unitId: 'unit-base',
    unitName: 'Unidad',
    unitEquivalence: 1,
    discount: 0,
    ...overrides,
  } as SaleItem;
}

describe('lineName', () => {
  it('tells apart the unit and pack lines of one product', () => {
    const unit = line({});
    const pack = line({ id: 'line-2', unitId: 'unit-pack', unitName: 'Paca', unitEquivalence: 6 });

    expect(lineName(unit, [unit, pack])).toBe('Gaseosa Cola 400ml (Unidad)');
    expect(lineName(pack, [unit, pack])).toBe('Gaseosa Cola 400ml (Paca)');
    expect(lineName(unit, [unit])).toBe('Gaseosa Cola 400ml');
  });
});
