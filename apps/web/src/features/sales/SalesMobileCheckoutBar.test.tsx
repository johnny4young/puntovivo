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
  it('renders the draft summary and actions in Spanish', async () => {
    await i18next.changeLanguage('es');
    const expectedTotal = formatCurrency(23.8).replace(/\s+/g, ' ');

    render(
      <SalesMobileCheckoutBar
        draftSummary={{ itemCount: 3, subtotal: 20, taxAmount: 3.8, total: 23.8 }}
        cashSession={activeCashSession}
        canCharge
        canOpenCashSession={false}
        canCloseCashSession
        onOpenSearch={vi.fn()}
        onCharge={vi.fn()}
        onOpenCashSession={vi.fn()}
        onCloseCashSession={vi.fn()}
      />
    );

    expect(screen.getByText('Total borrador')).toBeInTheDocument();
    expect(
      screen.getByText(content => content.replace(/\s+/g, ' ') === expectedTotal)
    ).toBeInTheDocument();
    expect(screen.getByText('3 artículos')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Buscar' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cobrar venta' })).toBeEnabled();
  });

  it('shows the close action when the register is open but the cart is empty', async () => {
    await i18next.changeLanguage('es');

    const user = userEvent.setup();
    const onOpenSearch = vi.fn();
    const onCloseCashSession = vi.fn();

    render(
      <SalesMobileCheckoutBar
        draftSummary={{ itemCount: 0, subtotal: 0, taxAmount: 0, total: 0 }}
        cashSession={activeCashSession}
        canCharge={false}
        canOpenCashSession={false}
        canCloseCashSession
        onOpenSearch={onOpenSearch}
        onCharge={vi.fn()}
        onOpenCashSession={vi.fn()}
        onCloseCashSession={onCloseCashSession}
      />
    );

    await user.click(screen.getByRole('button', { name: 'Buscar' }));
    expect(onOpenSearch).toHaveBeenCalledTimes(1);

    const closeButton = screen.getByRole('button', { name: 'Cerrar caja' });
    expect(closeButton).toBeEnabled();

    await user.click(closeButton);
    expect(onCloseCashSession).toHaveBeenCalledTimes(1);
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
        canCloseCashSession={false}
        onOpenSearch={vi.fn()}
        onCharge={onCharge}
        onOpenCashSession={onOpenCashSession}
        onCloseCashSession={vi.fn()}
      />
    );

    expect(screen.queryByRole('button', { name: 'Cobrar venta' })).not.toBeInTheDocument();
    const openButton = screen.getByRole('button', { name: 'Abrir caja' });
    expect(openButton).toBeEnabled();

    await user.click(openButton);
    expect(onOpenCashSession).toHaveBeenCalledTimes(1);
    expect(onCharge).not.toHaveBeenCalled();
  });

});
