import type { ComponentProps } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import { render } from '@/test/utils';
import { SalesHeaderSection } from '@/features/sales/SalesHeaderSection';

const zones = vi.hoisted(() => ({ quote: true }));
vi.mock('@/features/modules/useRegisterZone', () => ({
  useRegisterZone: (zone: string) => zone !== 'quote-delivery' || zones.quote,
}));

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
  beforeEach(() => {
    zones.quote = true;
  });

  it('leaves out the parked-sales key when the register does not park sales', () => {
    renderHeader({ onOpenSuspended: undefined });
    expect(screen.queryByTestId('sales-open-suspended')).not.toBeInTheDocument();
    expect(screen.getByTestId('sales-open-history')).toBeInTheDocument();
  });

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
    expect(screen.getByTestId('sales-register-state')).toHaveTextContent('Register closed');
    expect(screen.getByTestId('sales-register-state')).not.toHaveClass('is-open');
  });

  it('gives phones a register state pill that keeps the register name as its title', () => {
    renderHeader();
    const pill = screen.getByTestId('sales-register-state');
    expect(pill).toHaveTextContent('Register open');
    expect(pill).toHaveClass('is-open', 'md:hidden');
    expect(pill).toHaveAttribute('title', 'Register 2');
    expect(screen.getByTestId('sales-register-identity')).toHaveClass('max-md:hidden');
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

  const quotationWorkspace = (overrides: Record<string, unknown> = {}) =>
    ({
      sourceQuotationNumber: 'COT-000042',
      sourceQuotationValidUntil: null,
      items: [],
      ...overrides,
    }) as never;

  it('shows the accepted-quotation lock', () => {
    renderHeader({ activeWorkspace: quotationWorkspace() });
    const banner = screen.getByTestId('quotation-cart-banner');
    expect(banner).toHaveTextContent('From quotation COT-000042 · prices and terms locked');
    // No end date, no serial lines: nothing else to say.
    expect(screen.queryByTestId('quotation-cart-expiry')).not.toBeInTheDocument();
    expect(banner).not.toHaveTextContent('serials');
  });

  it('says how many days the quotation still holds, and asks for serials only when needed', () => {
    const validUntil = new Date();
    validUntil.setDate(validUntil.getDate() + 4);
    renderHeader({
      activeWorkspace: quotationWorkspace({
        sourceQuotationValidUntil: validUntil.toISOString(),
        items: [{ tracksSerials: true }],
      }),
    });
    expect(screen.getByTestId('quotation-cart-expiry')).toHaveTextContent('expires in 4 days');
    expect(screen.getByTestId('quotation-cart-banner')).toHaveTextContent(
      'Select the required serials before charging.'
    );
  });

  it('marks a quotation past its last day as expired', () => {
    const validUntil = new Date();
    validUntil.setDate(validUntil.getDate() - 1);
    renderHeader({
      activeWorkspace: quotationWorkspace({ sourceQuotationValidUntil: validUntil.toISOString() }),
    });
    expect(screen.getByTestId('quotation-cart-expiry')).toHaveTextContent('expired');
  });

  it('leaves out the quotation banner while the quotation zone is off', () => {
    zones.quote = false;
    renderHeader({ activeWorkspace: quotationWorkspace() });
    expect(screen.queryByTestId('quotation-cart-banner')).not.toBeInTheDocument();
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
