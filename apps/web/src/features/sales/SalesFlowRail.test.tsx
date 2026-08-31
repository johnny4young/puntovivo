import { describe, expect, it, vi } from 'vitest';
import userEvent from '@testing-library/user-event';
import { render, screen } from '@/test/utils';
import { SalesFlowRail } from './SalesFlowRail';

const baseProps = {
  itemCount: 0,
  total: 0,
  hasCashSession: false,
  canOpenCashSession: true,
  canCharge: false,
  onOpenCashSession: vi.fn(),
  onOpenSearch: vi.fn(),
  onCharge: vi.fn(),
};

describe('SalesFlowRail', () => {
  it('shows only the next valid step for a closed register', async () => {
    const user = userEvent.setup();
    const onOpenCashSession = vi.fn();
    render(<SalesFlowRail {...baseProps} onOpenCashSession={onOpenCashSession} />);

    expect(screen.getByText('Open the register to begin')).toBeInTheDocument();
    expect(screen.getByText('Register closed')).toBeInTheDocument();
    const action = screen.getByTestId('checkout-primary-action');
    expect(action).toHaveAttribute('aria-keyshortcuts', 'Alt+A');
    await user.click(action);
    expect(onOpenCashSession).toHaveBeenCalledOnce();
  });

  it('moves an open empty sale directly toward product capture', async () => {
    const user = userEvent.setup();
    const onOpenSearch = vi.fn();
    render(
      <SalesFlowRail
        {...baseProps}
        hasCashSession
        canOpenCashSession={false}
        onOpenSearch={onOpenSearch}
      />
    );

    expect(screen.getByText('Scan or choose a product')).toBeInTheDocument();
    const action = screen.getByTestId('checkout-primary-action');
    expect(action).toHaveAttribute('aria-keyshortcuts', 'F5');
    await user.click(action);
    expect(onOpenSearch).toHaveBeenCalledOnce();
  });

  it('keeps product capture inert when the active workspace is immutable', () => {
    render(
      <SalesFlowRail
        {...baseProps}
        hasCashSession
        canOpenCashSession={false}
        canOpenSearch={false}
      />
    );

    const action = screen.getByTestId('checkout-primary-action');
    expect(action).toBeDisabled();
    expect(action).not.toHaveAttribute('aria-keyshortcuts');
  });

  it('surfaces total and charge as the one dominant action', async () => {
    const user = userEvent.setup();
    const onCharge = vi.fn();
    render(
      <SalesFlowRail
        {...baseProps}
        itemCount={3}
        total={284.9}
        hasCashSession
        canCharge
        onCharge={onCharge}
      />
    );

    expect(screen.getByText('Review and charge')).toBeInTheDocument();
    expect(screen.getByText('3 items')).toBeInTheDocument();
    expect(screen.getByText(/\$284\.90/)).toBeInTheDocument();
    const action = screen.getByTestId('checkout-primary-action');
    expect(action).toHaveAttribute('aria-keyshortcuts', 'F1');
    await user.click(action);
    expect(onCharge).toHaveBeenCalledOnce();
  });

  it('prioritizes a blocker over charge and dispatches its recovery', async () => {
    const user = userEvent.setup();
    const onRecover = vi.fn();
    render(
      <SalesFlowRail
        {...baseProps}
        itemCount={1}
        total={10}
        hasCashSession
        canCharge
        preflightItems={[
          {
            id: 'insufficient_stock',
            severity: 'blocker',
            messageKey: 'preflight.items.insufficient_stock.message',
            messageValues: { count: 1, product: 'Coffee', otherCount: 0 },
            recoveryAction: {
              labelKey: 'preflight.items.insufficient_stock.recovery',
              onClick: onRecover,
            },
          },
        ]}
      />
    );

    expect(screen.getByText('Review this item before charging')).toBeInTheDocument();
    const action = screen.getByTestId('checkout-primary-action');
    expect(action).not.toHaveAttribute('aria-keyshortcuts');
    await user.click(action);
    expect(onRecover).toHaveBeenCalledOnce();
  });

  it('keeps optional setup behind an explicit disclosure', async () => {
    const user = userEvent.setup();
    render(
      <SalesFlowRail
        {...baseProps}
        hasCashSession
        preflightItems={[
          {
            id: 'receipt_hardware_missing',
            severity: 'warning',
            messageKey: 'preflight.items.receipt_hardware_missing.message',
          },
        ]}
      />
    );

    const disclosure = screen.getByText('You can keep selling. One setup item is pending.');
    expect(screen.getByText(/No receipt printer is set up/)).not.toBeVisible();
    await user.click(disclosure);
    expect(screen.getByText(/No receipt printer is set up/)).toBeVisible();
  });

  it('makes hub recovery the highest-priority state and protects the cart', () => {
    render(
      <SalesFlowRail
        {...baseProps}
        itemCount={2}
        total={42}
        hasCashSession
        canCharge
        hubReachable={false}
      />
    );

    expect(screen.getByText('The sale cannot be completed right now')).toBeInTheDocument();
    expect(
      screen.getByText('Your cart is safe. Restore the connection to continue.')
    ).toBeInTheDocument();
    expect(screen.getByTestId('checkout-primary-action')).toBeDisabled();
  });
});
