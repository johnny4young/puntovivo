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
      canCloseCashSession
      onCharge={vi.fn()}
      onOpenCashSession={vi.fn()}
      onCloseCashSession={vi.fn()}
      onOpenMovement={vi.fn()}
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
        canCloseCashSession={false}
        onCharge={vi.fn()}
        onOpenCashSession={onOpenCashSession}
        onCloseCashSession={vi.fn()}
        onOpenMovement={vi.fn()}
        onRegisterAssignmentChange={vi.fn()}
        receiveHandoff={{ registerName: 'Caja 2', isSelectedRegister: false, open }}
      />
    );
    expect(screen.getByTestId('checkout-primary-action')).toHaveAccessibleName(
      'Open cash session'
    );
    fireEvent.click(screen.getByTestId('sales-receive-handoff'));
    expect(open).toHaveBeenCalledTimes(2);
  });

  it('hands the open register over next to closing it', () => {
    const onHandOver = vi.fn();
    renderDock({ onHandOver });
    fireEvent.click(screen.getByTestId('sales-hand-over'));
    expect(onHandOver).toHaveBeenCalledOnce();
  });

  it('offers no hand-over when it cannot run', () => {
    renderDock();
    expect(screen.queryByTestId('sales-hand-over')).not.toBeInTheDocument();
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

  it('keeps the last sale one touch from its receipt', () => {
    const onOpenLastSale = vi.fn();
    renderDock({
      lastSale: { id: 'sale-1', saleNumber: 'V-000912', total: 41_300, change: 0 },
      onOpenLastSale,
    });

    const card = within(screen.getByTestId('checkout-last-sale'));
    expect(card.getByText('V-000912')).toBeInTheDocument();
    expect(card.getByText(formatCurrency(41_300))).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('sales-open-last-receipt'));
    expect(onOpenLastSale).toHaveBeenCalledOnce();
  });

  it('names the newest sale on hold and resumes from the card', () => {
    const onToggleSuspendedPanel = vi.fn();
    renderDock({
      suspendedDraftsCount: 1,
      firstSuspendedDraft: { label: 'Table 5', total: 23_400 },
      onToggleSuspendedPanel,
    });

    const card = within(screen.getByTestId('checkout-parked'));
    expect(card.getByText('Table 5')).toBeInTheDocument();
    expect(card.getByText(formatCurrency(23_400))).toBeInTheDocument();
    expect(screen.getByTestId('suspended-drafts-badge')).toHaveTextContent('1');
    fireEvent.click(card.getByRole('button', { name: 'Resume' }));
    expect(onToggleSuspendedPanel).toHaveBeenCalledOnce();
  });

  it('starts a return from the sales history', () => {
    const onOpenReturns = vi.fn();
    renderDock({ onOpenReturns });

    fireEvent.click(screen.getByRole('button', { name: 'Return' }));
    expect(onOpenReturns).toHaveBeenCalledOnce();
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
