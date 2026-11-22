import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SaleCartTable } from '@/features/sales/SaleCartTable';
import { render } from '@/test/utils';
import type { SaleCartItem } from '@/features/sales/saleCart';
import type { PharmacyLineHint } from '@/features/sales/pharmacyRegister';

// the cart lines read the expiry-radar suggestions through this
// hook (a trpc query underneath); mock it so the suite stays network-free.
let mockDiscountSuggestions = new Map<string, number>();
vi.mock('@/features/sales/useDiscountSuggestions', () => ({
  useDiscountSuggestions: () => mockDiscountSuggestions,
}));
const phone = vi.hoisted(() => ({ layout: false }));
vi.mock('@/features/sales/usePhoneLayout', () => ({ usePhoneLayout: () => phone.layout }));

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
    phone.layout = false;
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

  it('opens a line for its keys only when it is tapped, and closes it on a second tap', async () => {
    phone.layout = true;
    const user = userEvent.setup();
    const onSelectItem = vi.fn();
    const props = {
      items: [createCartItem({ discount: 0 })],
      onQuantityChange: vi.fn(),
      onDiscountChange: vi.fn(),
      onRemove: vi.fn(),
      onSelectItem,
      quantityInputRefFor,
      discountInputRefFor,
    };
    const { rerender } = render(<SaleCartTable {...props} selectedItemKey="product-1:unit-1" />);
    const line = screen.getByTestId('sale-cart-item-SKU-001');
    const name = line.querySelector<HTMLButtonElement>('.sales-ticket-name > button')!;
    expect(line).toHaveAttribute('data-open', 'false');

    await user.click(name);
    expect(onSelectItem).toHaveBeenCalledWith('product-1:unit-1');
    expect(line).toHaveAttribute('data-open', 'true');
    expect(name).toHaveAttribute('aria-expanded', 'true');

    await user.click(name);
    expect(line).toHaveAttribute('data-open', 'false');

    await user.click(name);
    rerender(<SaleCartTable {...props} selectedItemKey={null} />);
    expect(line).toHaveAttribute('data-open', 'false');

    // A scan back onto the line selects it without reopening its keys.
    rerender(<SaleCartTable {...props} selectedItemKey="product-1:unit-1" />);
    expect(line).toHaveAttribute('data-open', 'false');
  });

  it('leaves aria-expanded off the desktop line, whose keys always show', async () => {
    const user = userEvent.setup();
    render(
      <SaleCartTable
        items={[createCartItem({ discount: 0 })]}
        selectedItemKey="product-1:unit-1"
        onQuantityChange={vi.fn()}
        onDiscountChange={vi.fn()}
        onRemove={vi.fn()}
        onSelectItem={vi.fn()}
        quantityInputRefFor={quantityInputRefFor}
        discountInputRefFor={discountInputRefFor}
      />
    );
    const name = screen
      .getByTestId('sale-cart-item-SKU-001')
      .querySelector<HTMLButtonElement>('.sales-ticket-name > button')!;
    await user.click(name);
    expect(name).not.toHaveAttribute('aria-expanded');
  });

  it('gives phones a compact quantity: a count for units, the amount and unit otherwise', () => {
    render(
      <SaleCartTable
        items={[
          createCartItem({ discount: 0, quantity: 6 }),
          createCartItem({
            key: 'product-2:unit-2',
            productId: 'product-2',
            productName: 'Cheese',
            productSku: 'SKU-002',
            unitName: 'kg',
            quantity: 0.25,
            discount: 0,
          }),
          createCartItem({
            key: 'product-3:unit-3',
            productId: 'product-3',
            productName: 'Rice',
            productSku: 'SKU-003',
            unitName: 'kg',
            quantity: 2,
            discount: 0,
            sellByFraction: true,
            fractionStep: 0.25,
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

    const units = screen.getByTestId('sale-cart-item-SKU-001');
    expect(units.querySelector('.sales-ticket-qty-compact')).toHaveTextContent('× 6');
    // The phone reading still names the quantity for screen readers.
    expect(units.querySelector('.sales-ticket-qty-compact .sr-only')).toHaveTextContent(
      'Quantity 6 Bottle'
    );
    expect(
      screen.getByTestId('sale-cart-item-SKU-002').querySelector('.sales-ticket-qty-compact')
    ).toHaveTextContent('0.25 kg');
    expect(
      screen.getByTestId('sale-cart-item-SKU-003').querySelector('.sales-ticket-qty-compact')
    ).toHaveTextContent('2 kg');
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
  it('labels a non-base unit even when its equivalence is 1', () => {
    render(
      <SaleCartTable
        items={[createCartItem({ unitName: 'Kilo', unitEquivalence: 1, isBaseUnit: false })]}
        selectedItemKey={null}
        onQuantityChange={vi.fn()}
        onDiscountChange={vi.fn()}
        onRemove={vi.fn()}
        onSelectItem={vi.fn()}
        quantityInputRefFor={quantityInputRefFor}
        discountInputRefFor={discountInputRefFor}
      />
    );

    expect(screen.getByTestId('cart-unit-presentation-SKU-001')).toHaveTextContent('Kilo × 1');
    expect(screen.getByRole('button', { name: /Kilo × 1/ })).toBeInTheDocument();
  });
});

describe('SaleCartTable pharmacy lines', () => {
  const lot = { lotNumber: 'L2311', expiresAt: '2027-08-20', daysToExpiry: 270, nearExpiry: false };

  function renderLines(pharmacyLines: Map<string, PharmacyLineHint>) {
    render(
      <SaleCartTable
        items={[
          createCartItem({ productId: 'amox', productSku: 'AMOX', key: 'amox:u', discount: 0 }),
          createCartItem({ productId: 'lora', productSku: 'LORA', key: 'lora:u', discount: 0 }),
          createCartItem({ productId: 'clona', productSku: 'CLONA', key: 'clona:u', discount: 0 }),
          createCartItem({ productId: 'water', productSku: 'WATER', key: 'water:u', discount: 0 }),
        ]}
        pharmacyLines={pharmacyLines}
        selectedItemKey={null}
        onQuantityChange={vi.fn()}
        onDiscountChange={vi.fn()}
        onRemove={vi.fn()}
        onSelectItem={vi.fn()}
        quantityInputRefFor={() => () => {}}
        discountInputRefFor={() => () => {}}
      />
    );
  }

  it('shows the next lot, the class and the prescription state of each medicine', () => {
    renderLines(
      new Map<string, PharmacyLineHint>([
        [
          'amox',
          {
            classification: 'prescription',
            nextLot: lot,
            status: { kind: 'ready', approverName: 'Daniela Ortiz' },
          },
        ],
        [
          'lora',
          {
            classification: 'otc',
            nextLot: { ...lot, lotNumber: 'L2402', daysToExpiry: 12, nearExpiry: true },
            status: null,
          },
        ],
        ['clona', { classification: 'controlled', nextLot: null, status: null }],
      ])
    );

    expect(screen.getByTestId('cart-pharmacy-lot-AMOX')).toHaveTextContent(
      'Lot L2311 · expires Aug 2027'
    );
    expect(screen.getByTestId('cart-pharmacy-class-AMOX')).toHaveTextContent('Prescription');
    expect(screen.getByTestId('cart-pharmacy-status-AMOX')).toHaveTextContent(
      'Prescription on file · approved by Daniela Ortiz'
    );
    expect(screen.getByTestId('cart-pharmacy-lot-LORA')).toHaveTextContent(
      'Expires in 12 days · sell this lot first'
    );
    expect(screen.queryByTestId('cart-pharmacy-status-LORA')).not.toBeInTheDocument();
    // A controlled line says so once, in its class.
    expect(screen.getByTestId('cart-pharmacy-class-CLONA')).toHaveTextContent('Controlled');
    expect(screen.queryByTestId('cart-pharmacy-status-CLONA')).not.toBeInTheDocument();
    expect(screen.queryByTestId('cart-pharmacy-WATER')).not.toBeInTheDocument();
  });

  it('warns when a prescription line has no prescription yet', () => {
    renderLines(
      new Map<string, PharmacyLineHint>([
        ['amox', { classification: 'prescription', nextLot: null, status: { kind: 'missing' } }],
      ])
    );
    expect(screen.getByTestId('cart-pharmacy-status-AMOX')).toHaveTextContent(
      'Prescription missing'
    );
    expect(screen.queryByTestId('cart-pharmacy-lot-AMOX')).not.toBeInTheDocument();
  });
  describe('hardware lines', () => {
    const quantityInputRefFor = () => () => {};
    const discountInputRefFor = () => () => {};
    const units = [
      { unitId: 'm', unitName: 'Metre', equivalence: 1, price: 2150, isBase: true },
      { unitId: 'roll', unitName: 'Roll', equivalence: 100, price: 198000, isBase: false },
    ];
    const baseProps = {
      selectedItemKey: null,
      onQuantityChange: vi.fn(),
      onDiscountChange: vi.fn(),
      onRemove: vi.fn(),
      onSelectItem: vi.fn(),
      quantityInputRefFor,
      discountInputRefFor,
    };
    const cable = (overrides?: Partial<SaleCartItem>) =>
      createCartItem({
        key: 'cable:m',
        productId: 'cable',
        productName: 'THHN cable',
        productSku: 'CAB-12',
        unitId: 'm',
        unitName: 'Metre',
        unitDimension: 'length',
        sellByFraction: true,
        fractionStep: 0.1,
        quantity: 37.5,
        unitPrice: 2150,
        discount: 0,
        unitOptions: units,
        ...overrides,
      });

    it('lets a line with several units switch unit in place, cut to measure', async () => {
      const user = userEvent.setup();
      const onUnitChange = vi.fn();
      const onSelectItem = vi.fn();
      render(
        <SaleCartTable
          {...baseProps}
          items={[cable()]}
          onSelectItem={onSelectItem}
          onUnitChange={onUnitChange}
        />
      );
      const picker = screen.getByRole('combobox', { name: 'Unit for THHN cable' });
      expect(
        within(picker)
          .getAllByRole('option')
          .map(option => option.textContent)
      ).toEqual(['Metre', 'Roll × 100']);
      await user.selectOptions(picker, 'roll');
      expect(onUnitChange).toHaveBeenCalledWith('cable:m', 'roll');
      // Picking a unit is not a tap on the line.
      expect(onSelectItem).not.toHaveBeenCalled();
      expect(screen.getByTestId('cart-cut-to-measure-CAB-12')).toHaveTextContent('cut to measure');
    });

    it('shows no picker while the ticket is locked, for one-unit products or without the zone', () => {
      const { rerender } = render(
        <SaleCartTable {...baseProps} items={[cable()]} onUnitChange={vi.fn()} itemsLocked />
      );
      expect(screen.queryByTestId('cart-unit-select-CAB-12')).not.toBeInTheDocument();
      rerender(
        <SaleCartTable
          {...baseProps}
          items={[cable({ unitOptions: undefined })]}
          onUnitChange={vi.fn()}
        />
      );
      expect(screen.queryByTestId('cart-unit-select-CAB-12')).not.toBeInTheDocument();
      rerender(<SaleCartTable {...baseProps} items={[cable()]} />);
      expect(screen.queryByTestId('cart-unit-select-CAB-12')).not.toBeInTheDocument();
    });

    it('strikes the list price beside a cheaper tier price and names service lines', () => {
      render(
        <SaleCartTable
          {...baseProps}
          priceTier={2}
          items={[
            createCartItem({
              key: 'cement:bag',
              productSku: 'CEM-50',
              productName: 'Cement',
              unitPrice: 31500,
              catalogUnitPrice: 33900,
              isBaseUnit: true,
              tierPrices: { price: 33900, price2: 31500, price3: 30500 },
              discount: 0,
            }),
            createCartItem({
              key: 'cut:u',
              productId: 'cut',
              productSku: 'SRV-CUT',
              productName: 'Pipe cut',
              tracksStock: false,
              discount: 0,
            }),
          ]}
        />
      );
      const listPrice = screen.getByTestId('cart-list-price-CEM-50');
      expect(listPrice.querySelector('s')).toHaveTextContent('$33,900.00');
      expect(listPrice).toHaveTextContent('List price');
      expect(screen.getByTestId('sale-cart-item-CEM-50')).toHaveTextContent('Price 2');
      expect(screen.getByTestId('cart-service-SRV-CUT')).toHaveTextContent('Service');
      expect(screen.queryByTestId('cart-list-price-SRV-CUT')).not.toBeInTheDocument();
    });
  });
});
