import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SalesMobileCheckoutBar } from '@/features/sales/SalesMobileCheckoutBar';
import { render } from '@/test/utils';

describe('SalesMobileCheckoutBar', () => {
  it('renders the draft summary and actions', () => {
    render(
      <SalesMobileCheckoutBar
        draftSummary={{ itemCount: 3, subtotal: 20, taxAmount: 3.8, total: 23.8 }}
        canCharge
        onOpenSearch={vi.fn()}
        onCharge={vi.fn()}
      />
    );

    expect(screen.getByText('Draft total')).toBeInTheDocument();
    expect(screen.getByText('$23.80')).toBeInTheDocument();
    expect(screen.getByText('3 items')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Search' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Charge' })).toBeEnabled();
  });

  it('disables charge and wires the action callbacks', async () => {
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

    await user.click(screen.getByRole('button', { name: 'Search' }));
    expect(onOpenSearch).toHaveBeenCalledTimes(1);

    expect(screen.getByRole('button', { name: 'Charge' })).toBeDisabled();
    expect(onCharge).not.toHaveBeenCalled();
  });
});
