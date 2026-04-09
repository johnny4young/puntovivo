import { describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SaleCartTable } from '@/features/sales/SaleCartTable';
import { render } from '@/test/utils';
import type { SaleCartItem } from '@/features/sales/saleCart';

function createCartItem(overrides?: Partial<SaleCartItem>): SaleCartItem {
  return {
    key: 'product-1:unit-1',
    productId: 'product-1',
    productName: 'Sparkling Water',
    productSku: 'SKU-001',
    unitId: 'unit-1',
    unitName: 'Bottle',
    unitEquivalence: 1,
    quantity: 2,
    unitPrice: 5.5,
    discount: 10,
    taxRate: 19,
    availableStock: 18,
    ...overrides,
  };
}

describe('SaleCartTable', () => {
  const quantityInputRefFor = () => () => {};
  const discountInputRefFor = () => () => {};

  it('renders the empty state when there are no items', () => {
    render(
      <SaleCartTable
        items={[]}
        selectedItemKey={null}
        onQuantityChange={vi.fn()}
        onDiscountChange={vi.fn()}
        onRemove={vi.fn()}
        onSelectItem={vi.fn()}
        quantityInputRefFor={quantityInputRefFor}
        discountInputRefFor={discountInputRefFor}
      />
    );

    expect(screen.getByText('Search and add products to start a sale.')).toBeInTheDocument();
  });

  it('renders the responsive cart card list for narrow layouts', () => {
    render(
      <SaleCartTable
        items={[createCartItem()]}
        selectedItemKey={null}
        onQuantityChange={vi.fn()}
        onDiscountChange={vi.fn()}
        onRemove={vi.fn()}
        onSelectItem={vi.fn()}
        quantityInputRefFor={quantityInputRefFor}
        discountInputRefFor={discountInputRefFor}
      />
    );

    const mobileList = screen.getByRole('list', { name: 'Cart items' });
    expect(within(mobileList).getByText('Sparkling Water')).toBeInTheDocument();
    expect(within(mobileList).getByText('Stock 18')).toBeInTheDocument();
    expect(within(mobileList).getByText('Line total')).toBeInTheDocument();
  });

  it('updates quantity, discount, selection, and removal from the card layout', async () => {
    const user = userEvent.setup();
    const onQuantityChange = vi.fn();
    const onDiscountChange = vi.fn();
    const onRemove = vi.fn();
    const onSelectItem = vi.fn();

    render(
      <SaleCartTable
        items={[createCartItem()]}
        selectedItemKey={null}
        onQuantityChange={onQuantityChange}
        onDiscountChange={onDiscountChange}
        onRemove={onRemove}
        onSelectItem={onSelectItem}
        quantityInputRefFor={quantityInputRefFor}
        discountInputRefFor={discountInputRefFor}
      />
    );

    const mobileList = screen.getByRole('list', { name: 'Cart items' });
    const cartItem = within(mobileList).getByRole('listitem');

    await user.click(within(cartItem).getByRole('button', { name: 'Select Sparkling Water' }));
    expect(onSelectItem).toHaveBeenCalledWith('product-1:unit-1');

    const quantityInput = within(cartItem).getByLabelText('Quantity for Sparkling Water');
    fireEvent.change(quantityInput, { target: { value: '4' } });
    expect(onQuantityChange).toHaveBeenLastCalledWith('product-1:unit-1', 4);

    const discountInput = within(cartItem).getByLabelText('Discount for Sparkling Water');
    fireEvent.change(discountInput, { target: { value: '15' } });
    expect(onDiscountChange).toHaveBeenLastCalledWith('product-1:unit-1', 15);

    await user.click(within(cartItem).getByRole('button', { name: 'Remove Sparkling Water' }));
    expect(onRemove).toHaveBeenCalledWith('product-1:unit-1');
  });
});
