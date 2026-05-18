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
import {
  SalePaymentModal,
  type SalePaymentValues,
} from './SalePaymentModal';

let mockBalance = 0;

vi.mock('@/lib/trpc', () => ({
  trpc: {
    customerLedger: {
      getBalance: {
        useQuery: () => ({
          data: { balance: mockBalance },
          isLoading: false,
          error: null,
        }),
      },
    },
  },
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

function renderModal(
  overrides: Partial<React.ComponentProps<typeof SalePaymentModal>> = {}
) {
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
  });

  it('hides the credit option when no customer is selected', () => {
    renderModal({ userRole: 'manager' });
    expect(
      screen.queryByTestId('sale-payment-method-credit-option')
    ).not.toBeInTheDocument();
  });

  it('hides the credit option for cashier role even with a customer attached', async () => {
    const user = userEvent.setup();
    renderModal({ userRole: 'cashier' });
    // Walk-in is selected by default; pick a real customer first.
    await user.selectOptions(screen.getByLabelText('Customer'), 'cust-1');
    expect(
      screen.queryByTestId('sale-payment-method-credit-option')
    ).not.toBeInTheDocument();
  });

  it('surfaces the credit option when a customer is selected and role is manager', async () => {
    const user = userEvent.setup();
    renderModal({ userRole: 'manager' });
    await user.selectOptions(screen.getByLabelText('Customer'), 'cust-1');
    expect(
      screen.getByTestId('sale-payment-method-credit-option')
    ).toBeInTheDocument();
  });

  it('renders the V10 customer card when credit is the active method', async () => {
    const user = userEvent.setup();
    mockBalance = 50;
    renderModal({
      userRole: 'admin',
      customers: [makeCustomer({ creditLimit: 200 })],
    });
    await user.selectOptions(screen.getByLabelText('Customer'), 'cust-1');
    await user.selectOptions(
      screen.getByTestId('sale-payment-method-select'),
      'credit'
    );

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
    await user.selectOptions(
      screen.getByTestId('sale-payment-method-select'),
      'credit'
    );

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
    await user.selectOptions(
      screen.getByTestId('sale-payment-method-select'),
      'credit'
    );

    const toggle = screen.getByTestId(
      'credit-sale-override-toggle'
    ) as HTMLInputElement;
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
    await user.selectOptions(
      screen.getByTestId('sale-payment-method-select'),
      'credit'
    );
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
    await user.selectOptions(
      screen.getByTestId('sale-payment-method-select'),
      'credit'
    );
    await user.selectOptions(screen.getByLabelText('Customer'), '');

    await waitFor(() =>
      expect(screen.getByTestId('sale-payment-method-select')).toHaveValue('cash')
    );
    expect(
      screen.queryByTestId('credit-sale-customer-card')
    ).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Confirm Sale/i }));
    const submitted = onSubmit.mock.calls.at(0)?.at(0) as unknown as SalePaymentValues;
    expect(submitted.paymentMethod).toBe('cash');
    expect(submitted.customerId).toBe('');
  });
});
