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

  it('lays each line out as a table row under one header', () => {
    render(
      <SaleCartTable
        items={[
          createCartItem({ discount: 0 }),
          createCartItem({
            key: 'product-2:unit-2',
            productId: 'product-2',
            productName: 'Olive Oil',
            productSku: 'SKU-002',
            unitName: 'Box',
            discount: 0,
          }),
        ]}
        selectedItemKey="product-2:unit-2"
        onQuantityChange={vi.fn()}
        onDiscountChange={vi.fn()}
        onRemove={vi.fn()}
        onSelectItem={vi.fn()}
        quantityInputRefFor={quantityInputRefFor}
        discountInputRefFor={discountInputRefFor}
        headerActions={<button type="button">Clear cart</button>}
      />
    );

    const head = within(screen.getByTestId('sales-ticket-head'));
    for (const label of ['#', 'Product', 'Quantity', 'Unit', 'Price', 'Total']) {
      expect(head.getByText(label)).toBeInTheDocument();
    }
    expect(head.getByRole('button', { name: 'Clear cart' })).toBeInTheDocument();

    const first = screen.getByTestId('sale-cart-item-SKU-001');
    expect(first).toHaveAttribute('data-selected', 'false');
    expect(within(first).getByText('1')).toHaveClass('sales-ticket-index');
    expect(first.querySelector('.sales-ticket-unit')).toHaveTextContent('Bottle');
    expect(first.querySelector('.sales-ticket-price')).toHaveTextContent('5.5');
    expect(first.querySelector('.sales-ticket-total')).toHaveTextContent('11');

    const second = screen.getByTestId('sale-cart-item-SKU-002');
    expect(second).toHaveAttribute('data-selected', 'true');
    expect(second.querySelector('.sales-ticket-unit')).toHaveTextContent('Box');
  });

  it('brings a newly selected line into view, but leaves a restored ticket alone', () => {
    const scrollIntoView = vi.fn();
    const original = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = scrollIntoView;
    try {
      const props = {
        items: [
          createCartItem(),
          createCartItem({
            key: 'product-2:unit-2',
            productId: 'product-2',
            productSku: 'SKU-002',
          }),
        ],
        onQuantityChange: vi.fn(),
        onDiscountChange: vi.fn(),
        onRemove: vi.fn(),
        onSelectItem: vi.fn(),
        quantityInputRefFor,
        discountInputRefFor,
      };
      const { rerender } = render(<SaleCartTable {...props} selectedItemKey="product-1:unit-1" />);
      expect(scrollIntoView).not.toHaveBeenCalled();

      rerender(<SaleCartTable {...props} selectedItemKey="product-2:unit-2" />);
      expect(scrollIntoView).toHaveBeenCalledExactlyOnceWith({ block: 'nearest' });
      expect(scrollIntoView.mock.contexts[0]).toBe(screen.getByTestId('sale-cart-item-SKU-002'));
    } finally {
      Element.prototype.scrollIntoView = original;
    }
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
    expect(within(mobileList).getByText(/Stock 18/)).toBeInTheDocument();
    expect(within(mobileList).getByText('Line total')).toBeInTheDocument();
  });

  it('omits the stock figure when the line has no finite count', () => {
    render(
      <SaleCartTable
        items={[createCartItem({ availableStock: Number.POSITIVE_INFINITY })]}
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
    expect(within(mobileList).queryByText(/Stock/)).not.toBeInTheDocument();
  });

  it('opens discount and base quantity only on the selected line', () => {
    render(
      <SaleCartTable
        items={[
          createCartItem(),
          createCartItem({
            key: 'product-2:unit-1',
            productId: 'product-2',
            productName: 'Still Water',
            productSku: 'SKU-002',
            discount: 10,
          }),
        ]}
        selectedItemKey="product-1:unit-1"
        onQuantityChange={vi.fn()}
        onDiscountChange={vi.fn()}
        onRemove={vi.fn()}
        onSelectItem={vi.fn()}
        quantityInputRefFor={quantityInputRefFor}
        discountInputRefFor={discountInputRefFor}
      />
    );

    expect(screen.getByTestId('sale-cart-line-details-SKU-001')).toBeVisible();
    expect(screen.getByTestId('sale-cart-line-details-SKU-002')).not.toBeVisible();
    // A collapsed line must still say it carries a discount.
    expect(screen.getByTestId('cart-line-discount-SKU-002')).toHaveTextContent('10%');
    expect(screen.queryByTestId('cart-line-discount-SKU-001')).not.toBeInTheDocument();
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

  it('labels a packaging unit so the cashier can see what is being sold', () => {
    render(
      <SaleCartTable
        items={[createCartItem({ unitName: 'Pack', unitEquivalence: 12 })]}
        selectedItemKey={null}
        onQuantityChange={vi.fn()}
        onDiscountChange={vi.fn()}
        onRemove={vi.fn()}
        onSelectItem={vi.fn()}
        quantityInputRefFor={quantityInputRefFor}
        discountInputRefFor={discountInputRefFor}
      />
    );

    expect(screen.getByTestId('cart-unit-presentation-SKU-001')).toHaveTextContent('Pack × 12');
  });

  it('does not label the base unit as a packaging presentation', () => {
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

    expect(screen.queryByTestId('cart-unit-presentation-SKU-001')).not.toBeInTheDocument();
  });
});
