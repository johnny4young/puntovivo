/**
 * ENG-090 — SalePaymentModal credit-sale branch.
 *
 * Pins the role + customer gating on the credit method, the V10
 * customer card rendering (Saldo / Cupo / Saldo proyectado with
 * the warning pill flip), and role-aware checkout approvals.
 *
 * The trpc client is mocked so the credit-balance useQuery is a
 * pure render assertion — no real network or query lifecycle is
 * exercised. The mock pattern mirrors `PeripheralsPage.test.tsx`
 * and `CustomerLedgerModal.test.tsx`.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import userEvent from '@testing-library/user-event';
import { act, fireEvent } from '@testing-library/react';
import i18next from '@/i18n';
import { render, screen, waitFor } from '@/test/utils';
import type { Customer } from '@/types';
import { SalePaymentModal, type SalePaymentValues } from './SalePaymentModal';
import { hashCheckoutApprovalContext } from './checkoutApprovals';

let mockBalance = 0;
let mockApprovalRows: Array<Record<string, unknown>> = [];
const mockApprovalRefetch = vi.fn();
const mockApprovalInvalidate = vi.fn();
const mockApprovalMutation = { mutate: vi.fn(), isPending: false };
let mockLossPreventionActions: Array<'sale_discount' | 'sale_after_hours'> | null = null;
let mockLossPreventionFetching = false;
let mockLossPreventionError: Error | null = null;
const mockLossPreventionRefetch = vi.fn();
type ApprovalOnSuccess = (
  request: Record<string, unknown>,
  variables: Record<string, unknown>
) => Promise<void> | void;
let mockApprovalOnSuccess: ApprovalOnSuccess | undefined;

vi.mock('@/lib/trpc', () => ({
  trpc: {
    useUtils: () => ({
      managerApprovals: { mine: { invalidate: mockApprovalInvalidate } },
    }),
    customerLedger: {
      getBalance: {
        useQuery: () => ({
          data: { balance: mockBalance },
          isLoading: false,
          error: null,
        }),
      },
    },
    lossPrevention: {
      evaluateCheckout: {
        useQuery: (input: { discountAmount: number }) => ({
          data: {
            requiredActions:
              mockLossPreventionActions ?? (input.discountAmount > 0 ? ['sale_discount'] : []),
            violations: [],
          },
          isLoading: false,
          isFetching: mockLossPreventionFetching,
          error: mockLossPreventionError,
          refetch: mockLossPreventionRefetch,
        }),
      },
    },
    managerApprovals: {
      mine: {
        useQuery: () => ({
          data: mockApprovalRows,
          isLoading: false,
          error: null,
          refetch: mockApprovalRefetch,
        }),
      },
    },
  },
}));

vi.mock('@/lib/useCriticalMutation', () => ({
  useCriticalMutation: (_path: string, options?: { onSuccess?: ApprovalOnSuccess }) => {
    mockApprovalOnSuccess = options?.onSuccess;
    return mockApprovalMutation;
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

function buildModal(overrides: Partial<React.ComponentProps<typeof SalePaymentModal>> = {}) {
  return (
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

function renderModal(overrides: Partial<React.ComponentProps<typeof SalePaymentModal>> = {}) {
  return render(buildModal(overrides));
}

describe('SalePaymentModal (ENG-090 credit branch)', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    let uuidCounter = 0;
    vi.mocked(crypto.randomUUID).mockImplementation(() => {
      uuidCounter += 1;
      return `00000000-0000-4000-8000-${String(uuidCounter).padStart(12, '0')}`;
    });
    await i18next.changeLanguage('en');
    mockBalance = 0;
    mockApprovalRows = [];
    mockApprovalRefetch.mockReset();
    mockApprovalInvalidate.mockReset();
    mockApprovalMutation.mutate.mockReset();
    mockApprovalMutation.isPending = false;
    mockApprovalOnSuccess = undefined;
    mockLossPreventionActions = null;
    mockLossPreventionFetching = false;
    mockLossPreventionError = null;
    mockLossPreventionRefetch.mockReset();
  });

  it('hides the credit option when no customer is selected', () => {
    renderModal({ userRole: 'manager' });
    expect(screen.queryByTestId('sale-payment-method-credit-option')).not.toBeInTheDocument();
  });

  it('shows credit to a cashier with a customer and requires approval', async () => {
    const user = userEvent.setup();
    renderModal({ userRole: 'cashier' });
    // Walk-in is selected by default; pick a real customer first.
    await user.selectOptions(screen.getByLabelText('Customer'), 'cust-1');
    expect(screen.getByTestId('sale-payment-method-credit-option')).toBeInTheDocument();
    await user.selectOptions(screen.getByTestId('sale-payment-method-select'), 'credit');
    expect(await screen.findByTestId('checkout-approval-credit_sale')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Confirm Sale/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /Confirm Sale/i })).toHaveClass(
      'disabled:bg-secondary-200',
      'disabled:text-secondary-500'
    );
  });

  it('surfaces the server-owned blocked-hours approval and fails closed', async () => {
    mockLossPreventionActions = ['sale_after_hours'];
    renderModal({
      userRole: 'cashier',
      approvalItems: [
        {
          productId: 'product-1',
          unitId: 'unit-1',
          quantity: 1,
          unitPrice: 100,
          discount: 0,
        },
      ],
    });

    expect(await screen.findByTestId('checkout-approval-sale_after_hours')).toBeInTheDocument();
    expect(screen.getByText('Checkout during blocked hours')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Confirm Sale/i })).toBeDisabled();
  });

  it('keeps checkout locked while the current policy is being refreshed', () => {
    mockLossPreventionFetching = true;
    renderModal({
      userRole: 'cashier',
      approvalItems: [
        {
          productId: 'product-1',
          unitId: 'unit-1',
          quantity: 1,
          unitPrice: 100,
          discount: 0,
        },
      ],
    });

    expect(screen.getByText('Checking the current checkout policy…')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Confirm Sale/i })).toBeDisabled();
  });

  it('rejects direct form submit while policy or exact approval gates are outstanding', () => {
    const onSubmit = vi.fn(async () => undefined);
    const approvalItems = [
      {
        productId: 'product-1',
        unitId: 'unit-1',
        quantity: 1,
        unitPrice: 100,
        discount: 0,
      },
    ];
    const props = { userRole: 'cashier' as const, approvalItems, onSubmit };
    mockLossPreventionFetching = true;
    const { rerender } = renderModal(props);
    const form = document.getElementById('sale-payment-form');
    if (!form) throw new Error('Expected sale payment form');

    fireEvent.submit(form);
    expect(onSubmit).not.toHaveBeenCalled();

    mockLossPreventionFetching = false;
    mockLossPreventionActions = ['sale_after_hours'];
    rerender(buildModal(props));
    fireEvent.submit(form);

    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('restores fast-cash focus after the fail-closed policy refresh completes', async () => {
    const approvalItems = [
      {
        productId: 'product-1',
        unitId: 'unit-1',
        quantity: 1,
        unitPrice: 100,
        discount: 0,
      },
    ];
    const props = {
      userRole: 'cashier' as const,
      approvalItems,
      fastCashTrigger: 1,
    };
    mockLossPreventionFetching = true;
    const { rerender } = renderModal(props);
    const confirm = screen.getByRole('button', { name: /Confirm Sale/i });

    await waitFor(() => expect(confirm).toBeDisabled());
    expect(confirm).not.toHaveFocus();

    mockLossPreventionFetching = false;
    rerender(buildModal(props));

    await waitFor(() => expect(confirm).toBeEnabled());
    await waitFor(() => expect(confirm).toHaveFocus());
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

  it('offers an admin approval request instead of an override checkbox to managers', async () => {
    const user = userEvent.setup();
    mockBalance = 250;
    renderModal({
      userRole: 'manager',
      customers: [makeCustomer({ creditLimit: 100 })],
    });
    await user.selectOptions(screen.getByLabelText('Customer'), 'cust-1');
    await user.selectOptions(screen.getByTestId('sale-payment-method-select'), 'credit');

    expect(screen.queryByTestId('credit-sale-override-toggle')).not.toBeInTheDocument();
    expect(await screen.findByTestId('checkout-approval-credit_override')).toBeInTheDocument();
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

  it('submits an exact approved discount request and invalidates it when payment data changes', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn(async () => undefined);
    const approvalItems = [
      {
        productId: 'product-discount',
        unitId: 'unit-1',
        quantity: 1,
        unitPrice: 100,
        discount: 10,
      },
    ];
    const resourceId = await hashCheckoutApprovalContext({
      mode: 'fresh',
      saleId: null,
      customerId: null,
      items: approvalItems,
      paymentMethod: 'cash',
      payments: [],
      amountReceived: 90,
      discountAmount: 10,
      total: 90,
      creditAmount: 0,
      tipAmount: 0,
      serviceChargeAmount: 0,
      currencyCode: 'COP',
    });
    mockApprovalRows = [
      {
        id: 'approval-discount-1',
        action: 'sale_discount',
        status: 'approved',
        resourceType: 'sale_checkout',
        resourceId,
        decisionReason: null,
      },
    ];
    renderModal({
      userRole: 'cashier',
      total: 90,
      approvalItems,
      approvalDiscountAmount: 10,
      onSubmit,
    });

    const confirm = screen.getByRole('button', { name: /Confirm Sale/i });
    await waitFor(() => expect(confirm).toBeEnabled());
    expect(screen.getByTestId('checkout-approval-status-sale_discount')).toHaveTextContent(
      'Approved'
    );

    const amountReceived = screen.getByLabelText(/Amount received/i);
    await user.clear(amountReceived);
    await user.type(amountReceived, '100');
    await waitFor(() => expect(confirm).toBeDisabled());
    await waitFor(() =>
      expect(screen.getByTestId('checkout-approval-status-sale_discount')).toHaveTextContent(
        'Not requested'
      )
    );

    await user.clear(amountReceived);
    await user.type(amountReceived, '90');
    await waitFor(() => expect(confirm).toBeEnabled());
    await user.click(confirm);

    const submitted = onSubmit.mock.calls.at(0)?.at(0) as unknown as SalePaymentValues;
    expect(submitted.approvalRequests).toEqual([
      { action: 'sale_discount', requestId: 'approval-discount-1' },
    ]);
  });

  it('never associates a delayed approval response with a newer payment context', async () => {
    const user = userEvent.setup();
    const approvalItems = [
      {
        productId: 'product-delayed',
        unitId: 'unit-1',
        quantity: 1,
        unitPrice: 100,
        discount: 10,
      },
    ];
    renderModal({
      userRole: 'cashier',
      total: 90,
      approvalItems,
      approvalDiscountAmount: 10,
    });

    await screen.findByTestId('checkout-approval-sale_discount');
    await user.type(
      screen.getByLabelText('Reason for Discounted checkout'),
      'Customer price match'
    );
    await user.click(screen.getByRole('button', { name: 'Request approval' }));
    const submittedVariables = mockApprovalMutation.mutate.mock.calls[0]?.[0] as Record<
      string,
      unknown
    >;

    const amountReceived = screen.getByLabelText(/Amount received/i);
    await user.clear(amountReceived);
    await user.type(amountReceived, '100');
    expect(amountReceived).toHaveValue(100);

    mockApprovalRows = [
      {
        id: 'approval-delayed-1',
        action: 'sale_discount',
        status: 'approved',
        resourceType: 'sale_checkout',
        resourceId: 'checkout:sha256:server-context-a',
        decisionReason: null,
      },
    ];
    await act(async () => {
      await mockApprovalOnSuccess?.(
        {
          resourceType: 'sale_checkout',
          resourceId: 'checkout:sha256:server-context-a',
        },
        submittedVariables
      );
    });

    await waitFor(() =>
      expect(screen.getByTestId('checkout-approval-status-sale_discount')).toHaveTextContent(
        'Not requested'
      )
    );
    expect(screen.getByRole('button', { name: /Confirm Sale/i })).toBeDisabled();
  });

  it('rehashes the exact approval context when the resolved currency changes', async () => {
    const approvalItems = [
      {
        productId: 'product-currency',
        unitId: 'unit-1',
        quantity: 1,
        unitPrice: 100,
        discount: 10,
      },
    ];
    const copResourceId = await hashCheckoutApprovalContext({
      mode: 'fresh',
      saleId: null,
      customerId: null,
      items: approvalItems,
      paymentMethod: 'cash',
      payments: [],
      amountReceived: 90,
      discountAmount: 10,
      total: 90,
      creditAmount: 0,
      tipAmount: 0,
      serviceChargeAmount: 0,
      currencyCode: 'COP',
    });
    mockApprovalRows = [
      {
        id: 'approval-currency-1',
        action: 'sale_discount',
        status: 'approved',
        resourceType: 'sale_checkout',
        resourceId: copResourceId,
        decisionReason: null,
      },
    ];
    const props = {
      userRole: 'cashier' as const,
      total: 90,
      approvalItems,
      approvalDiscountAmount: 10,
    };
    const view = renderModal({ ...props, currencyCode: 'USD' });
    await waitFor(() =>
      expect(screen.getByTestId('checkout-approval-status-sale_discount')).toHaveTextContent(
        'Not requested'
      )
    );

    view.rerender(buildModal({ ...props, currencyCode: 'COP' }));
    await waitFor(() =>
      expect(screen.getByTestId('checkout-approval-status-sale_discount')).toHaveTextContent(
        'Approved'
      )
    );
  });

  it('binds a resumed draft approval to its frozen customer', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn(async () => undefined);
    const approvalItems = [
      {
        productId: 'product-draft',
        unitId: 'unit-1',
        quantity: 1,
        unitPrice: 100,
        discount: 10,
      },
    ];
    const resourceId = await hashCheckoutApprovalContext({
      mode: 'fromDraft',
      saleId: 'draft-1',
      customerId: 'cust-1',
      items: approvalItems,
      paymentMethod: 'cash',
      payments: [],
      amountReceived: 90,
      discountAmount: 10,
      total: 90,
      creditAmount: 0,
      tipAmount: 0,
      serviceChargeAmount: 0,
      currencyCode: 'COP',
    });
    mockApprovalRows = [
      {
        id: 'approval-draft-1',
        action: 'sale_discount',
        status: 'approved',
        resourceType: 'sale_checkout',
        resourceId,
        decisionReason: null,
      },
    ];

    renderModal({
      userRole: 'cashier',
      total: 90,
      approvalSaleId: 'draft-1',
      approvalCustomerId: 'cust-1',
      approvalItems,
      approvalDiscountAmount: 10,
      onSubmit,
    });

    const customer = screen.getByLabelText('Customer');
    expect(customer).toHaveValue('cust-1');
    expect(customer).toBeDisabled();
    const confirm = screen.getByRole('button', { name: /Confirm Sale/i });
    await waitFor(() => expect(confirm).toBeEnabled());
    await user.click(confirm);

    const submitted = onSubmit.mock.calls.at(0)?.at(0) as unknown as SalePaymentValues;
    expect(submitted.customerId).toBe('cust-1');
    expect(submitted.approvalRequests).toEqual([
      { action: 'sale_discount', requestId: 'approval-draft-1' },
    ]);
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

  it('ENG-014: cashier can request approval for credit inside split tender', async () => {
    const user = userEvent.setup();
    renderModal({ userRole: 'cashier' });
    await user.selectOptions(screen.getByLabelText('Customer'), 'cust-1');
    // Enable split mode and inspect the tender method select. The
    // The cashier can select credit; completing it remains gated by the
    // payload-bound manager request rendered by the modal.
    await user.click(screen.getByRole('button', { name: /Split payment across tenders/i }));
    expect(screen.getByTestId('split-tender-credit-option-0')).toBeInTheDocument();
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
