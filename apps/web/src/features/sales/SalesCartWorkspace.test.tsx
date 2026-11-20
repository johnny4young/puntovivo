/**
 * Cart toolbar coverage focused on the undo affordance.
 *
 * The component is otherwise a thin shell around `SaleCartTable`;
 * the row-level table behaviour is exercised in
 * `SaleCartTable.test.tsx`. This file pins the contract of the
 * new "Deshacer" toolbar button + its disabled / shortcut chip
 * surfaces.
 */
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import { SalesCartWorkspace } from '@/features/sales/SalesCartWorkspace';
import { render } from '@/test/utils';

// the inner SaleCartTable reads the expiry-discount suggestions
// through this hook (a trpc query underneath); mock it so this shell suite
// stays network-free.
vi.mock('@/features/sales/useDiscountSuggestions', () => ({
  useDiscountSuggestions: () => new Map<string, number>(),
}));

describe('SalesCartWorkspace —  undo button', () => {
  const baseProps = {
    items: [] as never[],
    selectedItemKey: null,
    saleError: null,
    onQuantityChange: vi.fn(),
    onDiscountChange: vi.fn(),
    onRemove: vi.fn(),
    onSelectItem: vi.fn(),
    onClearCart: vi.fn(),
    quantityInputRefFor: () => () => {},
    discountInputRefFor: () => () => {},
  };

  it('hides the undo button entirely when onUndo is not provided', () => {
    render(<SalesCartWorkspace {...baseProps} />);
    expect(screen.queryByTestId('sales-cart-undo')).toBeNull();
  });

  // the disabled-but-visible affordance was retired
  // because `disabled:opacity-45` on the btn primitive collapsed the
  // text contrast below WCAG AA. The discoverability of `Mod+Z`
  // moved to the CommandPalette catalogue (Mod+K), which renders
  // every shortcut chip on its own listing without an opacity gate.
  // The toolbar button now follows the cleaner UX rule: "do not
  // render affordances that have nothing to act on".
  it('does not render the undo button when canUndo is false', () => {
    const onUndo = vi.fn();
    render(<SalesCartWorkspace {...baseProps} canUndo={false} onUndo={onUndo} />);
    expect(screen.queryByTestId('sales-cart-undo')).toBeNull();
  });

  it('renders the undo button with the shortcut chip when canUndo is true', () => {
    const onUndo = vi.fn();
    render(<SalesCartWorkspace {...baseProps} canUndo onUndo={onUndo} />);
    const button = screen.getByTestId('sales-cart-undo');
    expect(button).not.toBeDisabled();
    // The shortcut chip still renders next to the label so the
    // cashier sees the keybinding when the button is reachable.
    expect(button).toHaveAttribute('aria-keyshortcuts');
    expect(button.getAttribute('aria-keyshortcuts')).toMatch(/\+Z$/);
    // Narrow tickets hide the label, so the name cannot depend on it.
    expect(button).toHaveAttribute('aria-label', 'Undo');
  });

  it('lays the command input, the last read and the one-touch keys around the ticket', () => {
    render(
      <SalesCartWorkspace
        {...baseProps}
        searchBar={<div data-testid="slot-search" />}
        banner={<div data-testid="slot-banner" />}
        quickAccess={<div data-testid="slot-quick" />}
      />
    );
    const order = ['slot-search', 'slot-banner', 'sales-cart-empty', 'slot-quick'].map(id =>
      screen.getByTestId(id)
    );
    for (let index = 1; index < order.length; index += 1) {
      expect(
        order[index - 1]!.compareDocumentPosition(order[index]!) & Node.DOCUMENT_POSITION_FOLLOWING
      ).toBeTruthy();
    }
    expect(screen.getByRole('heading', { name: 'Active ticket' })).toBeInTheDocument();
  });

  it('announces a sale error', () => {
    render(<SalesCartWorkspace {...baseProps} saleError="Insufficient stock" />);
    expect(screen.getByRole('alert')).toHaveTextContent('Insufficient stock');
  });

  it('fires onUndo on click when canUndo is true', () => {
    const onUndo = vi.fn();
    render(<SalesCartWorkspace {...baseProps} canUndo onUndo={onUndo} />);
    const button = screen.getByTestId('sales-cart-undo');
    expect(button).not.toBeDisabled();
    fireEvent.click(button);
    expect(onUndo).toHaveBeenCalledTimes(1);
  });
});
