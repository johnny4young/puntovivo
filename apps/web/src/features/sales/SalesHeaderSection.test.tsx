import type { ComponentProps } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import { render } from '@/test/utils';
import { SalesHeaderSection } from '@/features/sales/SalesHeaderSection';

vi.mock('@/features/sales/PaceToggleButton', () => ({
  PaceToggleButton: () => null,
}));

vi.mock('@/features/sales/SoundToggleButton', () => ({
  SoundToggleButton: () => null,
}));

function renderHeader(overrides: Partial<ComponentProps<typeof SalesHeaderSection>> = {}) {
  return render(
    <SalesHeaderSection
      registerName="Register 2"
      cashierName="Test Cashier"
      siteName="North Site"
      onOpenHistory={vi.fn()}
      onOpenSuspended={vi.fn()}
      suspendedDraftsCount={0}
      customerDisplayEnabled={false}
      onOpenCustomerDisplay={vi.fn()}
      isResumedCart={false}
      activeWorkspace={null}
      {...overrides}
    />
  );
}

describe('SalesHeaderSection', () => {
  it('names the register, the cashier and the site', () => {
    renderHeader({ status: <span data-testid="status-slot" /> });

    const identity = screen.getByTestId('sales-register-identity');
    expect(identity).toHaveTextContent('Register 2');
    expect(identity).toHaveTextContent('Test Cashier · North Site');
    expect(screen.getByTestId('sales-command-bar')).toContainElement(
      screen.getByTestId('status-slot')
    );
  });

  it('says so when no register is open', () => {
    renderHeader({ registerName: null });
    expect(screen.getByTestId('sales-register-identity')).toHaveTextContent('No open cash session');
  });

  it('advertises the suspended-sales shortcut only when a draft can be opened', () => {
    const empty = renderHeader();
    expect(screen.getByTestId('sales-open-suspended')).not.toHaveAttribute('aria-keyshortcuts');
    expect(screen.queryByTestId('sales-suspended-count')).not.toBeInTheDocument();
    empty.unmount();

    renderHeader({ suspendedDraftsCount: 2 });
    expect(screen.getByTestId('sales-open-suspended')).toHaveAttribute('aria-keyshortcuts');
    expect(screen.getByTestId('sales-suspended-count')).toHaveTextContent('2');
  });

  it('prices the ticket by tier, and hides the tiers on a locked ticket', () => {
    const onPriceTierChange = vi.fn();
    const editable = renderHeader({ priceTier: 1, onPriceTierChange });

    expect(screen.getByTestId('sales-price-tier-1')).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByTestId('sales-price-tier-3'));
    expect(onPriceTierChange).toHaveBeenCalledWith(3);
    editable.unmount();

    renderHeader({ priceTier: 1 });
    expect(screen.queryByTestId('sales-price-tier')).not.toBeInTheDocument();
  });

  it('shows the accepted-quotation lock', () => {
    renderHeader({ activeWorkspace: { sourceQuotationNumber: 'COT-000042' } as never });
    expect(screen.getByTestId('quotation-cart-banner')).toHaveTextContent('COT-000042');
  });

  it('offers the customer display action only when the module is active', () => {
    const onOpenCustomerDisplay = vi.fn();
    const hidden = renderHeader();
    expect(screen.queryByTestId('sales-open-customer-display')).not.toBeInTheDocument();
    hidden.unmount();

    renderHeader({ customerDisplayEnabled: true, onOpenCustomerDisplay });
    const customerDisplayAction = screen.getByTestId('sales-open-customer-display');
    expect(customerDisplayAction).toHaveAccessibleName('Customer display');
    fireEvent.click(customerDisplayAction);
    expect(onOpenCustomerDisplay).toHaveBeenCalledOnce();
  });
});
