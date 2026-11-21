import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import i18next from 'i18next';
import { SalesMobileCheckoutBar } from '@/features/sales/SalesMobileCheckoutBar';
import { formatCurrency } from '@/lib/utils';
import { render } from '@/test/utils';

const activeCashSession = {
  id: 'cash-session-1',
  tenantId: 'tenant-1',
  siteId: 'site-1',
  cashierId: 'cashier-1',
  registerName: 'Front register',
  openingFloat: 100,
  openingCountDenominations: [{ value: 50, count: 2 }],
  expectedBalance: 100,
  status: 'open' as const,
  openedAt: new Date().toISOString(),
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

describe('SalesMobileCheckoutBar', () => {
  it('reserves the measured fixed-bar footprint and releases its observer on unmount', () => {
    const observe = vi.fn();
    const disconnect = vi.fn();
    let resize = () => {};
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(callback: () => void) {
          resize = callback;
        }
        observe = observe;
        disconnect = disconnect;
      }
    );
    const height = vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(180);
    try {
      const { unmount } = render(
        <SalesMobileCheckoutBar
          draftSummary={{ itemCount: 0, subtotal: 0, taxAmount: 0, total: 0 }}
          cashSession={null}
          canCharge={false}
          canOpenCashSession
          onCharge={vi.fn()}
          onOpenCashSession={vi.fn()}
        />
      );
      expect(observe).toHaveBeenCalledWith(screen.getByTestId('mobile-checkout-bar'), {
        box: 'border-box',
      });
      expect(height).not.toHaveBeenCalled();
      resize();
      expect(screen.getByTestId('mobile-checkout-footprint')).toHaveStyle({ height: '180px' });
      height.mockReturnValue(244);
      resize();
      expect(screen.getByTestId('mobile-checkout-footprint')).toHaveStyle({ height: '244px' });
      height.mockReturnValue(0);
      resize();
      expect(screen.getByTestId('mobile-checkout-footprint')).toHaveStyle({ height: '0px' });
      unmount();
      expect(disconnect).toHaveBeenCalledOnce();
    } finally {
      height.mockRestore();
      vi.unstubAllGlobals();
    }
  });

  it('shows the total with its item count, Cobrar and the park row in Spanish', async () => {
    await i18next.changeLanguage('es');
    const expectedTotal = formatCurrency(23.8).replace(/\s+/g, ' ');

    render(
      <SalesMobileCheckoutBar
        draftSummary={{ itemCount: 3, subtotal: 20, taxAmount: 3.8, total: 23.8 }}
        cashSession={activeCashSession}
        canCharge
        canOpenCashSession={false}
        onCharge={vi.fn()}
        onOpenCashSession={vi.fn()}
      />
    );

    expect(screen.getByTestId('mobile-checkout-caption')).toHaveTextContent('Total · 3 artículos');
    expect(screen.getByTestId('mobile-checkout-total').textContent?.replace(/\s+/g, ' ')).toBe(
      expectedTotal
    );
    expect(screen.getByRole('button', { name: 'Cobrar venta' })).toHaveAttribute(
      'aria-keyshortcuts',
      'F1'
    );
    expect(screen.getByRole('button', { name: 'Suspender' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Fiar' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Suspendidas' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Buscar' })).not.toBeInTheDocument();
  });

  it('keeps Cobrar in place but disabled while the ticket cannot be charged', async () => {
    await i18next.changeLanguage('en');
    render(
      <SalesMobileCheckoutBar
        draftSummary={{ itemCount: 0, subtotal: 0, taxAmount: 0, total: 0 }}
        cashSession={activeCashSession}
        canCharge={false}
        canOpenCashSession={false}
        onCharge={vi.fn()}
        onOpenCashSession={vi.fn()}
      />
    );

    expect(screen.getByTestId('mobile-checkout-primary')).toBeDisabled();
    expect(screen.getByTestId('mobile-checkout-caption')).toHaveTextContent('Total · 0 items');
    expect(screen.queryByRole('button', { name: 'Close cash session' })).not.toBeInTheDocument();
  });

  it('blocks charge and credit while the hub is unreachable', async () => {
    await i18next.changeLanguage('en');
    render(
      <SalesMobileCheckoutBar
        draftSummary={{ itemCount: 1, subtotal: 10, taxAmount: 0, total: 10 }}
        cashSession={activeCashSession}
        canCharge
        canOpenCashSession={false}
        onCharge={vi.fn()}
        onCredit={vi.fn()}
        onOpenCashSession={vi.fn()}
        hubReachable={false}
      />
    );

    expect(screen.getByTestId('mobile-checkout-primary')).toBeDisabled();
    expect(screen.getByTestId('mobile-checkout-credit')).toBeDisabled();
  });

  it('shows "Abrir caja" instead of charge when no cash session is open', async () => {
    await i18next.changeLanguage('es');

    const user = userEvent.setup();
    const onOpenCashSession = vi.fn();
    const onCharge = vi.fn();

    render(
      <SalesMobileCheckoutBar
        draftSummary={{ itemCount: 1, subtotal: 10, taxAmount: 0, total: 10 }}
        cashSession={null}
        canCharge={false}
        canOpenCashSession
        onCharge={onCharge}
        onOpenCashSession={onOpenCashSession}
      />
    );

    expect(screen.queryByRole('button', { name: 'Cobrar venta' })).not.toBeInTheDocument();
    const openButton = screen.getByRole('button', { name: 'Abrir caja' });
    expect(openButton).toBeEnabled();
    expect(openButton).toHaveAttribute('aria-keyshortcuts', 'Alt+A');

    await user.click(openButton);
    expect(onOpenCashSession).toHaveBeenCalledTimes(1);
    expect(onCharge).not.toHaveBeenCalled();
  });

  it('runs suspend, credit and the suspended panel from the park row', async () => {
    await i18next.changeLanguage('es');

    const user = userEvent.setup();
    const onSuspend = vi.fn();
    const onCredit = vi.fn();
    const onToggleSuspendedPanel = vi.fn();

    render(
      <SalesMobileCheckoutBar
        draftSummary={{ itemCount: 1, subtotal: 10, taxAmount: 0, total: 10 }}
        cashSession={activeCashSession}
        canCharge
        canOpenCashSession={false}
        onCharge={vi.fn()}
        onOpenCashSession={vi.fn()}
        canSuspend
        onSuspend={onSuspend}
        onCredit={onCredit}
        suspendedDraftsCount={2}
        onToggleSuspendedPanel={onToggleSuspendedPanel}
      />
    );

    await user.click(screen.getByRole('button', { name: 'Suspender' }));
    await user.click(screen.getByRole('button', { name: 'Fiar' }));
    await user.click(screen.getByRole('button', { name: 'Suspendidas 2' }));

    expect(onSuspend).toHaveBeenCalledTimes(1);
    expect(onCredit).toHaveBeenCalledTimes(1);
    expect(onToggleSuspendedPanel).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('mobile-checkout-suspend')).toHaveAttribute('aria-keyshortcuts');
    expect(screen.getByTestId('mobile-checkout-open-suspended-panel')).toHaveAttribute(
      'aria-keyshortcuts'
    );
  });

  it('keeps Suspend visible but disabled when the ticket cannot be parked', async () => {
    await i18next.changeLanguage('es');

    render(
      <SalesMobileCheckoutBar
        draftSummary={{ itemCount: 1, subtotal: 10, taxAmount: 0, total: 10 }}
        cashSession={activeCashSession}
        canCharge
        canOpenCashSession={false}
        onCharge={vi.fn()}
        onOpenCashSession={vi.fn()}
        canSuspend={false}
        onSuspend={vi.fn()}
      />
    );

    const suspend = screen.getByTestId('mobile-checkout-suspend');
    expect(suspend).toBeDisabled();
    expect(suspend).not.toHaveAttribute('aria-keyshortcuts');
  });

  it('does not advertise the suspended-sales shortcut when there are no drafts', async () => {
    await i18next.changeLanguage('es');

    render(
      <SalesMobileCheckoutBar
        draftSummary={{ itemCount: 1, subtotal: 10, taxAmount: 0, total: 10 }}
        cashSession={activeCashSession}
        canCharge
        canOpenCashSession={false}
        onCharge={vi.fn()}
        onOpenCashSession={vi.fn()}
        suspendedDraftsCount={0}
        onToggleSuspendedPanel={vi.fn()}
      />
    );

    expect(screen.getByTestId('mobile-checkout-open-suspended-panel')).not.toHaveAttribute(
      'aria-keyshortcuts'
    );
  });
});
