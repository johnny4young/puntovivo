import type { ComponentProps } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, within } from '@testing-library/react';
import { render } from '@/test/utils';
import { formatCurrency } from '@/lib/utils';
import type { CashSession } from '@/types';
import { SalesCheckoutPanel } from './SalesCheckoutPanel';

vi.mock('@/features/sales/useCashierPace', () => ({
  useCashierPace: () => ({ enabled: false, toggle: vi.fn(), pace: null }),
}));

const CASH_SESSION = {
  id: 'cash-1',
  registerName: 'Register A',
  openedAt: new Date().toISOString(),
} as unknown as CashSession;

function renderDock(overrides: Partial<ComponentProps<typeof SalesCheckoutPanel>> = {}) {
  return render(
    <SalesCheckoutPanel
      currentSite={null}
      cashSession={CASH_SESSION}
      registerAssignments={[]}
      selectedRegisterAssignment={null}
      isCashSessionLoading={false}
      draftSummary={{ itemCount: 12, subtotal: 89_380, taxAmount: 6_214, total: 87_420 }}
      lineCount={7}
      canCharge
      canOpenCashSession={false}
      onCharge={vi.fn()}
      onOpenCashSession={vi.fn()}
      onRegisterAssignmentChange={vi.fn()}
      {...overrides}
    />
  );
}

describe('SalesCheckoutPanel dock', () => {
  it('leads with the total, its count and its breakdown', () => {
    renderDock({ discountAmount: 1_960 });

    const total = within(screen.getByTestId('checkout-total'));
    expect(total.getByText('Total to charge')).toBeInTheDocument();
    expect(total.getByText(formatCurrency(87_420))).toBeInTheDocument();
    expect(total.getByText('12 items · 7 lines')).toBeInTheDocument();
    expect(total.getByText(formatCurrency(89_380))).toBeInTheDocument();
    expect(screen.getByTestId('checkout-savings')).toHaveTextContent(`−${formatCurrency(1_960)}`);
  });

  it('counts prescription lines in place of the line count', () => {
    renderDock({ prescriptionLineCount: 1 });
    const total = within(screen.getByTestId('checkout-total'));
    expect(total.getByTestId('checkout-prescription-count')).toHaveTextContent(
      '1 with prescription'
    );
    expect(total.queryByText(/7 lines/)).not.toBeInTheDocument();
  });

  it('names the impoconsumo apart from VAT inside the tax', () => {
    renderDock({
      draftSummary: {
        itemCount: 2,
        subtotal: 20_000,
        taxAmount: 2_700,
        consumptionTaxAmount: 800,
        total: 22_700,
      },
    });
    expect(screen.getByText('Tax included').nextElementSibling).toHaveTextContent(
      formatCurrency(1_900)
    );
    expect(screen.getByTestId('checkout-consumption-tax')).toHaveTextContent(
      `Consumption tax included${formatCurrency(800)}`
    );
  });

  it('leaves discounts out of the breakdown when there are none', () => {
    renderDock();
    expect(screen.queryByTestId('checkout-savings')).not.toBeInTheDocument();
  });

  it('says the sale is ready only with nothing left to review', () => {
    const ready = renderDock();
    expect(screen.getByTestId('checkout-ready')).toHaveTextContent('Ready to charge');
    ready.unmount();

    const warned = renderDock({
      preflightItems: [
        {
          id: 'insufficient_stock',
          severity: 'warning',
          messageKey: 'preflight.items.insufficient_stock.message',
          messageValues: { product: 'Oil 1L', count: 1 },
        },
      ],
    });
    expect(screen.queryByTestId('checkout-ready')).not.toBeInTheDocument();
    expect(screen.getByTestId('checkout-preflight-panel')).toBeInTheDocument();
    warned.unmount();

    renderDock({ canCharge: false });
    expect(screen.queryByTestId('checkout-ready')).not.toBeInTheDocument();
  });

  it('leaves the missing printer to the device pill', () => {
    renderDock({
      preflightItems: [
        {
          id: 'receipt_hardware_missing',
          severity: 'warning',
          messageKey: 'preflight.items.receipt_hardware_missing.message',
        },
      ],
    });
    expect(screen.queryByTestId('checkout-preflight-panel')).not.toBeInTheDocument();
    expect(screen.getByTestId('checkout-ready')).toBeInTheDocument();
  });

  it('charges with the single orange key', () => {
    const onCharge = vi.fn();
    renderDock({ onCharge });

    const charge = screen.getByTestId('checkout-primary-action');
    expect(charge).toHaveClass('btn-charge');
    expect(document.querySelectorAll('.btn-charge')).toHaveLength(1);
    fireEvent.click(charge);
    expect(onCharge).toHaveBeenCalledOnce();
  });

  it('opens the register with a plain key while it is closed', () => {
    const onOpenCashSession = vi.fn();
    renderDock({ cashSession: null, canOpenCashSession: true, onOpenCashSession });

    const open = screen.getByTestId('checkout-primary-action');
    expect(open).toHaveAccessibleName('Open cash session');
    expect(open).not.toHaveClass('btn-charge');
    expect(screen.queryByTestId('sales-tender-picker')).not.toBeInTheDocument();
    fireEvent.click(open);
    expect(onOpenCashSession).toHaveBeenCalledOnce();
  });

  it('receives a register handed over for the selected one instead of opening it', () => {
    const open = vi.fn();
    const onOpenCashSession = vi.fn();
    const { rerender } = renderDock({
      cashSession: null,
      canOpenCashSession: false,
      onOpenCashSession,
      receiveHandoff: { registerName: 'Caja 2', isSelectedRegister: true, open },
    });

    const primary = screen.getByTestId('checkout-primary-action');
    expect(primary).toHaveAccessibleName('Receive Caja 2');
    expect(primary).toBeEnabled();
    fireEvent.click(primary);
    expect(open).toHaveBeenCalledOnce();
    expect(onOpenCashSession).not.toHaveBeenCalled();
    expect(screen.queryByTestId('sales-receive-handoff')).not.toBeInTheDocument();

    rerender(
      <SalesCheckoutPanel
        currentSite={null}
        cashSession={null}
        registerAssignments={[]}
        selectedRegisterAssignment={null}
        isCashSessionLoading={false}
        draftSummary={{ itemCount: 0, subtotal: 0, taxAmount: 0, total: 0 }}
        lineCount={0}
        canCharge={false}
        canOpenCashSession
        onCharge={vi.fn()}
        onOpenCashSession={onOpenCashSession}
        onRegisterAssignmentChange={vi.fn()}
        receiveHandoff={{ registerName: 'Caja 2', isSelectedRegister: false, open }}
      />
    );
    expect(screen.getByTestId('checkout-primary-action')).toHaveAccessibleName('Open cash session');
    fireEvent.click(screen.getByTestId('sales-receive-handoff'));
    expect(open).toHaveBeenCalledTimes(2);
  });

  it('keeps shift management out of the checkout dock while the register is open', () => {
    renderDock();
    expect(screen.queryByTestId('checkout-register')).not.toBeInTheDocument();
    expect(screen.queryByTestId('checkout-last-sale')).not.toBeInTheDocument();
    expect(screen.queryByTestId('checkout-parked')).not.toBeInTheDocument();
  });

  it('surfaces an inline Abonar action beside the customer when they have a payable balance', () => {
    const onPayCustomerAccount = vi.fn();
    renderDock({ customerName: 'María', onPayCustomerAccount });
    fireEvent.click(screen.getByTestId('checkout-customer-pay'));
    expect(onPayCustomerAccount).toHaveBeenCalledOnce();
  });

  it('remembers the tender and prices one-touch cash against what is due', () => {
    const onTenderChange = vi.fn();
    const onFastCash = vi.fn();
    renderDock({ tender: 'cash', onTenderChange, onFastCash, cashDue: 96_162 });

    expect(screen.getByTestId('checkout-fast-cash')).toHaveTextContent(formatCurrency(96_162));
    fireEvent.click(screen.getByTestId('sales-cash-key-100000'));
    expect(onFastCash).toHaveBeenCalledWith(100_000);
    fireEvent.click(screen.getByTestId('sales-tender-card'));
    expect(onTenderChange).toHaveBeenCalledWith('card');
  });

  it('shows the walk-in customer and opens the charge drawer on its fields', () => {
    const onPickCustomer = vi.fn();
    const onRequestInvoice = vi.fn();
    renderDock({ onPickCustomer, onRequestInvoice });

    expect(screen.getByTestId('checkout-customer')).toHaveTextContent('Walk-in customer');
    fireEvent.click(screen.getByRole('button', { name: 'Customer' }));
    expect(onPickCustomer).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole('button', { name: 'Electronic invoice' }));
    expect(onRequestInvoice).toHaveBeenCalledOnce();
  });

  it('names a frozen customer and offers no invoice where the site cannot invoice', () => {
    renderDock({ customerName: 'Acme Ltd', onPickCustomer: undefined });

    expect(screen.getByTestId('checkout-customer')).toHaveTextContent('Acme Ltd');
    expect(screen.queryByTestId('checkout-pick-customer')).not.toBeInTheDocument();
    expect(screen.queryByTestId('checkout-request-invoice')).not.toBeInTheDocument();
  });

  it('starts a return from the sales history', () => {
    const onOpenReturns = vi.fn();
    renderDock({ onOpenReturns });

    fireEvent.click(screen.getByRole('button', { name: 'Return' }));
    expect(onOpenReturns).toHaveBeenCalledOnce();
  });

  it('opens the incident sheet from the F9 key between Suspend and Return', () => {
    const onOpenIncident = vi.fn();
    renderDock({ onOpenIncident, onOpenReturns: vi.fn(), canSuspend: true, onSuspend: vi.fn() });

    const keys = within(screen.getByTestId('checkout-park-controls')).getAllByRole('button');
    expect(keys.map(key => key.dataset.testid)).toEqual([
      'checkout-suspend',
      'checkout-incident',
      'checkout-returns',
    ]);
    const incident = screen.getByTestId('checkout-incident');
    expect(incident).toHaveAccessibleName('Incident');
    expect(incident).toHaveAttribute('aria-keyshortcuts', 'F9');
    expect(incident).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(incident);
    expect(onOpenIncident).toHaveBeenCalledOnce();
  });

  it('puts Fiar beside Cobrar with what the account would come to', () => {
    const onCredit = vi.fn();
    renderDock({
      showsCreditKey: true,
      onCredit,
      customerName: 'Juan Pérez',
      creditProjectedBalance: 171_720,
      creditLimit: 150_000,
    });

    expect(screen.getByTestId('checkout-customer')).toHaveTextContent('Juan Pérez');
    expect(screen.getByText('JP')).toBeInTheDocument();
    expect(screen.queryByTestId('sales-tender-credit')).not.toBeInTheDocument();
    expect(screen.getByTestId('checkout-credit-projection')).toHaveTextContent(
      `would owe ${formatCurrency(171_720)}`
    );
    expect(screen.getByTestId('checkout-credit-projection')).toHaveAttribute('data-over', 'true');
    fireEvent.click(screen.getByTestId('checkout-credit'));
    expect(onCredit).toHaveBeenCalledTimes(1);
  });

  it('puts Entregar en obra in the charge row as a toggle for the ticket', () => {
    const onDelivery = vi.fn();
    const { rerender } = renderDock({ showsCreditKey: true, showsDeliveryKey: true, onDelivery });
    const key = screen.getByTestId('checkout-delivery');
    expect(key).toHaveAccessibleName('Deliver to job site');
    expect(key).toHaveAttribute('aria-pressed', 'false');
    expect(key.parentElement).toContainElement(screen.getByTestId('checkout-credit'));
    fireEvent.click(key);
    expect(onDelivery).toHaveBeenCalledOnce();

    rerender(
      <SalesCheckoutPanel
        currentSite={null}
        cashSession={CASH_SESSION}
        registerAssignments={[]}
        selectedRegisterAssignment={null}
        isCashSessionLoading={false}
        draftSummary={{ itemCount: 0, subtotal: 0, taxAmount: 0, total: 0 }}
        canCharge={false}
        canOpenCashSession={false}
        onCharge={vi.fn()}
        onOpenCashSession={vi.fn()}
        onRegisterAssignmentChange={vi.fn()}
        showsDeliveryKey
        deliveryActive
      />
    );
    expect(screen.getByTestId('checkout-delivery')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('checkout-delivery')).toBeDisabled();
  });

  it('shows no delivery key without the zone or with the register closed', () => {
    const off = renderDock({ showsDeliveryKey: false, onDelivery: vi.fn() });
    expect(screen.queryByTestId('checkout-delivery')).not.toBeInTheDocument();
    off.unmount();
    renderDock({ showsDeliveryKey: true, cashSession: null, onDelivery: vi.fn() });
    expect(screen.queryByTestId('checkout-delivery')).not.toBeInTheDocument();
  });

  it('shows no Fiar key while the register does not sell on credit', () => {
    renderDock({ showsCreditKey: false });
    expect(screen.queryByTestId('checkout-credit')).not.toBeInTheDocument();
  });

  it('disables Fiar while the ticket cannot be charged and hides it with the register closed', () => {
    const open = renderDock({ showsCreditKey: true });
    expect(screen.getByTestId('checkout-credit')).toBeDisabled();
    expect(screen.queryByTestId('checkout-credit-projection')).not.toBeInTheDocument();
    open.unmount();

    renderDock({ showsCreditKey: true, cashSession: null, onCredit: vi.fn() });
    expect(screen.queryByTestId('checkout-credit')).not.toBeInTheDocument();
  });

  it('disables Fiar with Cobrar while a preflight blocker stands', () => {
    renderDock({
      showsCreditKey: true,
      onCredit: vi.fn(),
      preflightItems: [
        {
          id: 'cash_session_required',
          severity: 'blocker',
          messageKey: 'preflight.items.cash_session_required.message',
        },
      ],
    });
    expect(screen.getByTestId('checkout-primary-action')).toBeDisabled();
    expect(screen.getByTestId('checkout-credit')).toBeDisabled();
  });
});
