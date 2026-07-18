/**
 * ENG-090 — SalePaymentModal credit-sale branch.
 *
 * Pins the role + customer gating on the credit method, the V10
 * customer card rendering (Saldo / Cupo / Saldo proyectado with
 * the warning pill flip), and the admin-only override checkbox.
 *
 * The trpc client is mocked so the credit-balance useQuery is a
 * pure render assertion — no real network or query lifecycle is
 * exercised. The mock pattern mirrors `PeripheralsPage.test.tsx`
 * and `CustomerLedgerModal.test.tsx`.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import userEvent from '@testing-library/user-event';
import i18next from '@/i18n';
import { render, screen, waitFor } from '@/test/utils';
import type { Customer } from '@/types';
import { SalePaymentModal, type SalePaymentValues } from './SalePaymentModal';

let mockBalance = 0;
// ENG-218 — flip these to simulate an unresolved or failed balance read.
let mockBalanceLoading = false;
let mockBalanceError = false;
const refetchBalanceMock = vi.fn();

vi.mock('@/lib/trpc', () => ({
  trpc: {
    customerLedger: {
      getBalance: {
        useQuery: () => ({
          data: mockBalanceError || mockBalanceLoading ? undefined : { balance: mockBalance },
          isLoading: mockBalanceLoading,
          isError: mockBalanceError,
          error: mockBalanceError ? new Error('offline') : null,
          refetch: refetchBalanceMock,
        }),
      },
    },
    // ENG-213 — the drawer mounts CustomerLoyaltyChip, which reads this.
    // Zero points keeps the chip silent so the credit assertions below see
    // the same surface they did before loyalty existed.
    loyalty: {
      forCustomer: {
        useQuery: () => ({ data: { points: 0, movements: [] }, isLoading: false, error: null }),
      },
    },
  },
}));

// ENG-105c2 — stub the toast pipeline so SalePaymentModal mounts
// without needing ToastProvider in the credit-branch test wrappers.
vi.mock('@/components/feedback/ToastProvider', () => ({
  useToast: () => ({
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
  }),
}));

function makeCustomer(overrides: Partial<Customer> = {}): Customer {
  return {
    id: 'cust-1',
    tenantId: 'tenant-1',
    name: 'Cliente Crédito',
    taxId: 'NIT 900',
    isActive: true,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    creditLimit: 0,
    ...overrides,
  } as Customer;
}

function renderModal(overrides: Partial<React.ComponentProps<typeof SalePaymentModal>> = {}) {
  return render(
    <SalePaymentModal
      isOpen
      total={100}
      customers={[makeCustomer()]}
      isSaving={false}
      error={null}
      onClose={vi.fn()}
      onSubmit={vi.fn(async () => undefined) as (v: SalePaymentValues) => Promise<void>}
      {...overrides}
    />
  );
}

describe('SalePaymentModal (ENG-090 credit branch)', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    await i18next.changeLanguage('en');
    mockBalance = 0;
    mockBalanceLoading = false;
    mockBalanceError = false;
  });

  it('hides the credit option when no customer is selected', () => {
    renderModal({ userRole: 'manager' });
    expect(screen.queryByTestId('sale-payment-method-credit-option')).not.toBeInTheDocument();
  });

  it('hides the credit option for cashier role even with a customer attached', async () => {
    const user = userEvent.setup();
    renderModal({ userRole: 'cashier' });
    // Walk-in is selected by default; pick a real customer first.
    await user.selectOptions(screen.getByLabelText('Customer'), 'cust-1');
    expect(screen.queryByTestId('sale-payment-method-credit-option')).not.toBeInTheDocument();
  });

  it('surfaces the credit option when a customer is selected and role is manager', async () => {
    const user = userEvent.setup();
    renderModal({ userRole: 'manager' });
    await user.selectOptions(screen.getByLabelText('Customer'), 'cust-1');
    expect(screen.getByTestId('sale-payment-method-credit-option')).toBeInTheDocument();
  });

  it('renders the V10 customer card when credit is the active method', async () => {
    const user = userEvent.setup();
    mockBalance = 50;
    renderModal({
      userRole: 'admin',
      customers: [makeCustomer({ creditLimit: 200 })],
    });
    await user.selectOptions(screen.getByLabelText('Customer'), 'cust-1');
    await user.selectOptions(screen.getByTestId('sale-payment-method-select'), 'credit');

    expect(screen.getByTestId('credit-sale-customer-card')).toBeInTheDocument();
    expect(screen.getByTestId('credit-sale-current-balance')).toHaveTextContent('50');
    expect(screen.getByTestId('credit-sale-cupo')).toHaveTextContent('200');
    // Projected = 50 + 100 = 150 < 200 cupo → no warning.
    expect(screen.queryByTestId('credit-sale-warning')).not.toBeInTheDocument();
  });

  it('flips the projected pill to warning when balance exceeds cupo', async () => {
    const user = userEvent.setup();
    mockBalance = 150;
    renderModal({
      userRole: 'admin',
      customers: [makeCustomer({ creditLimit: 200 })],
    });
    await user.selectOptions(screen.getByLabelText('Customer'), 'cust-1');
    await user.selectOptions(screen.getByTestId('sale-payment-method-select'), 'credit');

    // Projected = 150 + 100 = 250 > 200 cupo → warning pill + override row.
    expect(screen.getByTestId('credit-sale-warning')).toBeInTheDocument();
    expect(screen.getByTestId('credit-sale-override-toggle')).toBeInTheDocument();
    const projected = screen.getByTestId('credit-sale-projected');
    expect(projected.className).toMatch(/warning/);
  });

  it('disables the override checkbox for manager role (admin-only)', async () => {
    const user = userEvent.setup();
    mockBalance = 250;
    renderModal({
      userRole: 'manager',
      customers: [makeCustomer({ creditLimit: 100 })],
    });
    await user.selectOptions(screen.getByLabelText('Customer'), 'cust-1');
    await user.selectOptions(screen.getByTestId('sale-payment-method-select'), 'credit');

    const toggle = screen.getByTestId('credit-sale-override-toggle') as HTMLInputElement;
    expect(toggle).toBeDisabled();
  });

  it('submits the credit payload with creditOverride=true when admin opts in', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn(async () => undefined);
    mockBalance = 250;
    renderModal({
      userRole: 'admin',
      customers: [makeCustomer({ creditLimit: 100 })],
      onSubmit,
    });
    await user.selectOptions(screen.getByLabelText('Customer'), 'cust-1');
    await user.selectOptions(screen.getByTestId('sale-payment-method-select'), 'credit');
    await user.click(screen.getByTestId('credit-sale-override-toggle'));
    await user.click(screen.getByRole('button', { name: /Confirm Sale/i }));

    expect(onSubmit).toHaveBeenCalledTimes(1);
    const submitted = onSubmit.mock.calls.at(0)?.at(0) as unknown as SalePaymentValues;
    expect(submitted.paymentMethod).toBe('credit');
    expect(submitted.creditOverride).toBe(true);
    expect(submitted.customerId).toBe('cust-1');
  });

  it('strips creditOverride=true when the payment method is not credit', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn(async () => undefined);
    mockBalance = 0;
    renderModal({
      userRole: 'admin',
      customers: [makeCustomer({ creditLimit: 50 })],
      onSubmit,
    });
    // No credit picked — submit defaults to cash; override must be
    // sanitized to false even if the form state somehow carried a
    // true (defense-in-depth before the server router gate).
    await user.click(screen.getByRole('button', { name: /Confirm Sale/i }));

    const submitted = onSubmit.mock.calls.at(0)?.at(0) as unknown as SalePaymentValues;
    expect(submitted.paymentMethod).toBe('cash');
    expect(submitted.creditOverride).toBe(false);
  });

  it('resets the stale credit method when the selected customer is cleared', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn(async () => undefined);
    renderModal({
      userRole: 'admin',
      customers: [makeCustomer({ creditLimit: 100 })],
      onSubmit,
    });
    await user.selectOptions(screen.getByLabelText('Customer'), 'cust-1');
    await user.selectOptions(screen.getByTestId('sale-payment-method-select'), 'credit');
    await user.selectOptions(screen.getByLabelText('Customer'), '');

    await waitFor(() =>
      expect(screen.getByTestId('sale-payment-method-select')).toHaveValue('cash')
    );
    expect(screen.queryByTestId('credit-sale-customer-card')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Confirm Sale/i }));
    const submitted = onSubmit.mock.calls.at(0)?.at(0) as unknown as SalePaymentValues;
    expect(submitted.paymentMethod).toBe('cash');
    expect(submitted.customerId).toBe('');
  });

  // ============================================================
  // ENG-014 — split-credit ("apartado") cases
  // ============================================================

  it('ENG-014: cashier cannot pick credit inside split tender (gate matches single-tender)', async () => {
    const user = userEvent.setup();
    renderModal({ userRole: 'cashier' });
    await user.selectOptions(screen.getByLabelText('Customer'), 'cust-1');
    // Enable split mode and inspect the tender method select. The
    // 'credit' option must not be present for cashier.
    await user.click(screen.getByRole('button', { name: /Split payment across tenders/i }));
    expect(screen.queryByTestId('split-tender-credit-option-0')).not.toBeInTheDocument();
  });

  it('ENG-014: split tender exposes credit option when admin + customer attached', async () => {
    const user = userEvent.setup();
    renderModal({
      userRole: 'admin',
      customers: [makeCustomer({ creditLimit: 200 })],
    });
    await user.selectOptions(screen.getByLabelText('Customer'), 'cust-1');
    await user.click(screen.getByRole('button', { name: /Split payment across tenders/i }));
    expect(screen.getByTestId('split-tender-credit-option-0')).toBeInTheDocument();
  });

  it('ENG-014: V10 customer card surfaces in split mode when a tender is credit, sized to the credit portion only', async () => {
    const user = userEvent.setup();
    mockBalance = 0;
    renderModal({
      userRole: 'admin',
      total: 200,
      customers: [makeCustomer({ creditLimit: 500 })],
    });
    await user.selectOptions(screen.getByLabelText('Customer'), 'cust-1');
    await user.click(screen.getByRole('button', { name: /Split payment across tenders/i }));
    // Default first tender row is cash $200 — flip it to $50.
    const amountInput = screen.getByLabelText(/Amount for tender 1/i);
    await user.clear(amountInput);
    await user.type(amountInput, '50');
    // Add a second tender row — defaults to card; flip to credit $150.
    await user.click(screen.getByRole('button', { name: /Add payment method/i }));
    const secondMethod = screen.getByLabelText(/Method for tender 2/i);
    await user.selectOptions(secondMethod, 'credit');
    const secondAmount = screen.getByLabelText(/Amount for tender 2/i);
    await user.clear(secondAmount);
    await user.type(secondAmount, '150');

    // V10 card appears with projection sized to the credit portion (150),
    // not the grand total (200): 0 currentBalance + 150 = 150 ≤ 500 cupo.
    await waitFor(() =>
      expect(screen.getByTestId('credit-sale-customer-card')).toBeInTheDocument()
    );
    expect(screen.getByTestId('credit-sale-projected')).toHaveTextContent('150');
    expect(screen.queryByTestId('credit-sale-warning')).not.toBeInTheDocument();
    // Partial-credit summary line shows the breakdown.
    expect(screen.getByTestId('credit-sale-partial-summary')).toBeInTheDocument();
  });

  it('ENG-014: submits split payload carrying cash + credit tenders', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn(async () => undefined);
    mockBalance = 0;
    renderModal({
      userRole: 'admin',
      total: 200,
      customers: [makeCustomer({ creditLimit: 500 })],
      onSubmit,
    });
    await user.selectOptions(screen.getByLabelText('Customer'), 'cust-1');
    await user.click(screen.getByRole('button', { name: /Split payment across tenders/i }));
    const firstAmount = screen.getByLabelText(/Amount for tender 1/i);
    await user.clear(firstAmount);
    await user.type(firstAmount, '50');
    await user.click(screen.getByRole('button', { name: /Add payment method/i }));
    await user.selectOptions(screen.getByLabelText(/Method for tender 2/i), 'credit');
    const secondAmount = screen.getByLabelText(/Amount for tender 2/i);
    await user.clear(secondAmount);
    await user.type(secondAmount, '150');
    await user.click(screen.getByRole('button', { name: /Confirm Sale/i }));

    expect(onSubmit).toHaveBeenCalledTimes(1);
    const submitted = onSubmit.mock.calls.at(0)?.at(0) as unknown as SalePaymentValues;
    expect(submitted.tenders).toHaveLength(2);
    const cashRow = submitted.tenders.find(t => t.method === 'cash');
    const creditRow = submitted.tenders.find(t => t.method === 'credit');
    expect(cashRow?.amount).toBe(50);
    expect(creditRow?.amount).toBe(150);
    // Customer is required for the split-credit payload.
    expect(submitted.customerId).toBe('cust-1');
  });
});

/**
 * ENG-218 — a failed balance read must not masquerade as a zero balance.
 *
 * `data` is undefined on both a fresh error and a genuine zero, so the card
 * used to draw "$0 owed / full cupo free" for a customer who might be at
 * their limit. The cashier confirmed against that, and only the server —
 * which re-reads the ledger — said no. Nothing was corrupted, but the
 * cashier was shown a number that was not true.
 */
describe('SalePaymentModal credit balance failure (ENG-218)', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    await i18next.changeLanguage('en');
    mockBalance = 0;
    mockBalanceLoading = false;
    mockBalanceError = true;
  });

  /** ModalButton forwards `id`, not `data-testid`. */
  const confirmButton = () =>
    document.getElementById('sale-payment-confirm') as HTMLButtonElement | null;

  async function openCreditCard(user: ReturnType<typeof userEvent.setup>) {
    renderModal({ userRole: 'admin', customers: [makeCustomer({ creditLimit: 200 })] });
    await user.selectOptions(screen.getByLabelText('Customer'), 'cust-1');
    await user.selectOptions(screen.getByTestId('sale-payment-method-select'), 'credit');
  }

  it('says the balance is unavailable instead of drawing a zero', async () => {
    const user = userEvent.setup();
    await openCreditCard(user);

    expect(screen.getByTestId('credit-balance-error')).toBeInTheDocument();
    // The em dash is the whole point: not "$0", which reads as "owes nothing".
    expect(screen.getByTestId('credit-sale-current-balance')).toHaveTextContent('—');
    expect(screen.getByTestId('credit-sale-projected')).toHaveTextContent('—');
  });

  it('blocks Confirm while the projection is unknowable', async () => {
    const user = userEvent.setup();
    await openCreditCard(user);

    expect(confirmButton()).toBeDisabled();
  });

  it('blocks Confirm and both balance figures while the first read is loading', async () => {
    const user = userEvent.setup();
    mockBalanceError = false;
    mockBalanceLoading = true;
    renderModal({
      userRole: 'admin',
      customers: [makeCustomer({ creditLimit: 50 })],
    });
    await user.selectOptions(screen.getByLabelText('Customer'), 'cust-1');
    await user.selectOptions(screen.getByTestId('sale-payment-method-select'), 'credit');

    expect(screen.getByTestId('credit-sale-customer-card')).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByTestId('credit-sale-current-balance')).toHaveTextContent('…');
    expect(screen.getByTestId('credit-sale-projected')).toHaveTextContent('…');
    expect(screen.queryByTestId('credit-sale-warning')).not.toBeInTheDocument();
    expect(screen.queryByTestId('credit-sale-override-toggle')).not.toBeInTheDocument();
    expect(confirmButton()).toBeDisabled();
  });

  it('offers a retry that re-reads the balance', async () => {
    const user = userEvent.setup();
    await openCreditCard(user);

    await user.click(screen.getByTestId('credit-balance-retry'));
    expect(refetchBalanceMock).toHaveBeenCalled();
  });

  it('leaves a cash checkout alone (the query never runs)', async () => {
    const user = userEvent.setup();
    renderModal({ userRole: 'admin', customers: [makeCustomer({ creditLimit: 200 })] });
    await user.selectOptions(screen.getByLabelText('Customer'), 'cust-1');

    // Cash is the default method: no credit portion, so a failing ledger read
    // is irrelevant and must not block the register.
    expect(screen.queryByTestId('credit-balance-error')).not.toBeInTheDocument();
    expect(confirmButton()).not.toBeDisabled();
  });

  it('recovers once the read succeeds', async () => {
    const user = userEvent.setup();
    mockBalanceError = false;
    mockBalance = 50;
    await openCreditCard(user);

    expect(screen.queryByTestId('credit-balance-error')).not.toBeInTheDocument();
    expect(screen.getByTestId('credit-sale-current-balance')).toHaveTextContent('50');
    expect(confirmButton()).not.toBeDisabled();
  });
});
