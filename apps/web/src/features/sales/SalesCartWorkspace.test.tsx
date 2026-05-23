/**
 * ENG-105d — Cart toolbar coverage focused on the undo affordance.
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

describe('SalesCartWorkspace — ENG-105d undo button', () => {
  const baseProps = {
    items: [] as never[],
    selectedItemKey: null,
    itemCount: 0,
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

  // ENG-134d — the disabled-but-visible affordance was retired
  // because `disabled:opacity-45` on the btn primitive collapsed the
  // text contrast below WCAG AA. The discoverability of `Mod+Z`
  // moved to the CommandPalette catalogue (Mod+K), which renders
  // every shortcut chip on its own listing without an opacity gate.
  // The toolbar button now follows the cleaner UX rule: "do not
  // render affordances that have nothing to act on".
  it('does not render the undo button when canUndo is false', () => {
    const onUndo = vi.fn();
    render(
      <SalesCartWorkspace {...baseProps} canUndo={false} onUndo={onUndo} />
    );
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
  });

  it('fires onUndo on click when canUndo is true', () => {
    const onUndo = vi.fn();
    render(
      <SalesCartWorkspace {...baseProps} canUndo onUndo={onUndo} />
    );
    const button = screen.getByTestId('sales-cart-undo');
    expect(button).not.toBeDisabled();
    fireEvent.click(button);
    expect(onUndo).toHaveBeenCalledTimes(1);
  });
});
