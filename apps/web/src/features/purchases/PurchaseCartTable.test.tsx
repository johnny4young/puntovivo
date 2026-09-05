import { fireEvent, screen } from '@testing-library/react';
import i18next from 'i18next';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import { render } from '@/test/utils';
import type { PurchaseCartItem } from './purchaseCart';
import { PurchaseCartTable } from './PurchaseCartTable';

beforeAll(async () => {
  await i18next.changeLanguage('en');
});

const ITEM: PurchaseCartItem = {
  key: 'product-1:unit-kg',
  productId: 'product-1',
  productName: 'Weighted cut',
  productSku: 'CUT-001',
  unitId: 'unit-kg',
  unitName: 'Kilogram',
  unitEquivalence: 1,
  quantity: 1,
  costPerUnit: 20_000,
  currentStock: 5,
  tracksSerials: false,
  serialNumbers: '',
};

describe('PurchaseCartTable', () => {
  it('accepts the 0.001 operational quantity from purchase receipt entry', () => {
    const onQuantityChange = vi.fn();
    render(
      <PurchaseCartTable
        items={[ITEM]}
        onQuantityChange={onQuantityChange}
        onCostChange={vi.fn()}
        onSerialNumbersChange={vi.fn()}
        onRemove={vi.fn()}
      />
    );

    const input = screen.getByLabelText('Quantity for Weighted cut');
    expect(input).toHaveAttribute('min', '0.001');
    fireEvent.change(input, { target: { value: '0.001' } });

    expect(onQuantityChange).toHaveBeenCalledWith(ITEM.key, 0.001);
  });
});
