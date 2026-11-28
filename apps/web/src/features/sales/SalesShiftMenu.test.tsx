import type { ComponentProps } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, within } from '@testing-library/react';
import { render } from '@/test/utils';
import type { CashSession } from '@/types';
import { SalesShiftMenu } from './SalesShiftMenu';

vi.mock('@/features/sales/useCashierPace', () => ({
  useCashierPace: () => ({ enabled: false, toggle: vi.fn(), pace: null }),
}));

const CASH_SESSION = {
  id: 'cash-1',
  registerName: 'Register A',
  openedAt: new Date().toISOString(),
} as unknown as CashSession;

function renderMenu(overrides: Partial<ComponentProps<typeof SalesShiftMenu>> = {}) {
  return render(
    <SalesShiftMenu
      cashSession={CASH_SESSION}
      canCloseCashSession
      onOpenMovement={vi.fn()}
      onCloseCashSession={vi.fn()}
      {...overrides}
    />
  );
}

describe('SalesShiftMenu', () => {
  it('opens the shift popover with cashier blind vs supervised guidance', () => {
    const cashier = renderMenu({ userRole: 'cashier' });
    fireEvent.click(screen.getByTestId('sales-shift-menu'));
    expect(screen.getByText(/blind close keeps/i)).toBeInTheDocument();
    expect(screen.queryByText(/supervised close shows/i)).not.toBeInTheDocument();
    cashier.unmount();

    renderMenu({ userRole: 'manager' });
    fireEvent.click(screen.getByTestId('sales-shift-menu'));
    expect(screen.getByText(/supervised close shows/i)).toBeInTheDocument();
    expect(screen.queryByText(/blind close keeps/i)).not.toBeInTheDocument();
  });

  it('invokes movement, drawer kick, hand-over, and close actions and closes the menu', () => {
    const onOpenMovement = vi.fn();
    const onKickCashDrawer = vi.fn();
    const onHandOver = vi.fn();
    const onCloseCashSession = vi.fn();
    renderMenu({ onOpenMovement, onKickCashDrawer, onHandOver, onCloseCashSession });

    fireEvent.click(screen.getByTestId('sales-shift-menu'));
    const menu = screen.getByTestId('sales-shift-popover');
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Record movement' }));
    expect(onOpenMovement).toHaveBeenCalledOnce();
    expect(screen.queryByTestId('sales-shift-popover')).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId('sales-shift-menu'));
    fireEvent.click(screen.getByTestId('sales-kick-drawer'));
    expect(onKickCashDrawer).toHaveBeenCalledOnce();

    fireEvent.click(screen.getByTestId('sales-shift-menu'));
    fireEvent.click(screen.getByTestId('sales-hand-over'));
    expect(onHandOver).toHaveBeenCalledOnce();

    fireEvent.click(screen.getByTestId('sales-shift-menu'));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Close cash session' }));
    expect(onCloseCashSession).toHaveBeenCalledOnce();
  });

  it('disables closing the cash session while the hub is unreachable and closes on Escape', () => {
    renderMenu({ hubReachable: false });
    fireEvent.click(screen.getByTestId('sales-shift-menu'));
    expect(screen.getByRole('menuitem', { name: 'Close cash session' })).toBeDisabled();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByTestId('sales-shift-popover')).not.toBeInTheDocument();
  });
});
