import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SaleCartTable } from '@/features/sales/SaleCartTable';
import { render } from '@/test/utils';
import type { SaleCartItem } from '@/features/sales/saleCart';

// the cart lines read the expiry-radar suggestions through this
// hook (a trpc query underneath); mock it so the suite stays network-free.
let mockDiscountSuggestions = new Map<string, number>();
vi.mock('@/features/sales/useDiscountSuggestions', () => ({
  useDiscountSuggestions: () => mockDiscountSuggestions,
}));

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
    sellByFraction: false,
    fractionStep: null,
    fractionMinimum: null,
    ...overrides,
  };
}

describe('SaleCartTable', () => {
  const quantityInputRefFor = () => () => {};
  const discountInputRefFor = () => () => {};

  beforeEach(() => {
    mockDiscountSuggestions = new Map();
  });

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
        items={[
          createCartItem(),
          createCartItem({
            key: 'product-2:unit-1',
            productId: 'product-2',
            productName: 'Still Water',
            productSku: 'SKU-002',
          }),
        ]}
        selectedItemKey="product-1:unit-1"
        onQuantityChange={onQuantityChange}
        onDiscountChange={onDiscountChange}
        onRemove={onRemove}
        onSelectItem={onSelectItem}
        quantityInputRefFor={quantityInputRefFor}
        discountInputRefFor={discountInputRefFor}
      />
    );

    const cartItem = screen.getByTestId('sale-cart-item-SKU-001');

    await user.click(within(cartItem).getByRole('button', { name: 'Select Sparkling Water' }));
    expect(onSelectItem).toHaveBeenCalledWith('product-1:unit-1');

    const quantityInput = within(cartItem).getByLabelText('Quantity for Sparkling Water');
    expect(quantityInput).toHaveAttribute('aria-keyshortcuts', 'Alt+C');
    fireEvent.change(quantityInput, { target: { value: '4' } });
    expect(onQuantityChange).toHaveBeenLastCalledWith('product-1:unit-1', 4);

    const discountInput = within(cartItem).getByLabelText('Discount for Sparkling Water');
    expect(discountInput).toHaveAttribute('aria-keyshortcuts', 'Alt+D');
    fireEvent.change(discountInput, { target: { value: '15' } });
    expect(onDiscountChange).toHaveBeenLastCalledWith('product-1:unit-1', 15);

    const removeButton = within(cartItem).getByRole('button', { name: 'Remove Sparkling Water' });
    expect(removeButton).toHaveAttribute('aria-keyshortcuts', 'Delete');
    await user.click(removeButton);
    expect(onRemove).toHaveBeenCalledWith('product-1:unit-1');

    const unselectedItem = screen.getByTestId('sale-cart-item-SKU-002');
    expect(within(unselectedItem).getByLabelText('Quantity for Still Water')).not.toHaveAttribute(
      'aria-keyshortcuts'
    );
    expect(within(unselectedItem).getByLabelText('Discount for Still Water')).not.toHaveAttribute(
      'aria-keyshortcuts'
    );
    expect(
      within(unselectedItem).getByRole('button', { name: 'Remove Still Water' })
    ).not.toHaveAttribute('aria-keyshortcuts');
  });

  // cart lines badge the product when the expiry radar has an
  // active suggestion for it; silent otherwise.
  it('renders the discount-suggestion badge only for suggested products', () => {
    mockDiscountSuggestions = new Map([['product-1', 20]]);
    render(
      <SaleCartTable
        items={[
          createCartItem(),
          createCartItem({
            key: 'product-2:unit-1',
            productId: 'product-2',
            productName: 'Still Water',
            productSku: 'SKU-002',
          }),
        ]}
        selectedItemKey={null}
        onQuantityChange={vi.fn()}
        onDiscountChange={vi.fn()}
        onRemove={vi.fn()}
        onSelectItem={vi.fn()}
        quantityInputRefFor={quantityInputRefFor}
        discountInputRefFor={discountInputRefFor}
      />
    );

    const badge = screen.getByTestId('cart-discount-suggestion-SKU-001');
    expect(badge).toHaveTextContent('Suggested -20%');
    expect(screen.queryByTestId('cart-discount-suggestion-SKU-002')).not.toBeInTheDocument();
  });

  it('locks accepted quotation terms while keeping the line visible', () => {
    render(
      <SaleCartTable
        items={[createCartItem()]}
        itemsLocked
        selectedItemKey="product-1:unit-1"
        onQuantityChange={vi.fn()}
        onDiscountChange={vi.fn()}
        onRemove={vi.fn()}
        onSelectItem={vi.fn()}
        quantityInputRefFor={quantityInputRefFor}
        discountInputRefFor={discountInputRefFor}
      />
    );

    const cartItem = screen.getByTestId('sale-cart-item-SKU-001');
    expect(within(cartItem).getByLabelText('Quantity for Sparkling Water')).toBeDisabled();
    expect(within(cartItem).getByLabelText('Discount for Sparkling Water')).toBeDisabled();
    expect(
      within(cartItem).getByRole('button', { name: 'Add one Sparkling Water' })
    ).toBeDisabled();
    expect(
      within(cartItem).queryByRole('button', { name: 'Remove Sparkling Water' })
    ).not.toBeInTheDocument();
  });
});
