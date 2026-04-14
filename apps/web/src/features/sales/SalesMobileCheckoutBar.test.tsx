import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import i18next from 'i18next';
import { SalesMobileCheckoutBar } from '@/features/sales/SalesMobileCheckoutBar';
import { formatCurrency } from '@/lib/utils';
import { render } from '@/test/utils';

describe('SalesMobileCheckoutBar', () => {
  it('renders the draft summary and actions in Spanish', async () => {
    await i18next.changeLanguage('es');
    const expectedTotal = formatCurrency(23.8).replace(/\s+/g, ' ');

    render(
      <SalesMobileCheckoutBar
        draftSummary={{ itemCount: 3, subtotal: 20, taxAmount: 3.8, total: 23.8 }}
        canCharge
        onOpenSearch={vi.fn()}
        onCharge={vi.fn()}
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

  it('disables charge and wires the action callbacks in Spanish', async () => {
    await i18next.changeLanguage('es');

    const user = userEvent.setup();
    const onOpenSearch = vi.fn();
    const onCharge = vi.fn();

    render(
      <SalesMobileCheckoutBar
        draftSummary={{ itemCount: 0, subtotal: 0, taxAmount: 0, total: 0 }}
        canCharge={false}
        onOpenSearch={onOpenSearch}
        onCharge={onCharge}
      />
    );

    await user.click(screen.getByRole('button', { name: 'Buscar' }));
    expect(onOpenSearch).toHaveBeenCalledTimes(1);

    expect(screen.getByRole('button', { name: 'Cobrar venta' })).toBeDisabled();
    expect(onCharge).not.toHaveBeenCalled();
  });
});
