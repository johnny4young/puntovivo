import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import i18next from 'i18next';
import { render } from '@/test/utils';
import { formatCurrency } from '@/lib/utils';
import type { Customer } from '@/types';
import { SalePaymentModal, type SalePaymentValues } from './SalePaymentModal';
import { useCartWorkspaceStore } from './useCartWorkspaceStore';
import { useQuickCreateStore } from './useQuickCreateStore';

const approvalInvalidateMock = vi.hoisted(() => vi.fn());
const approvalRefetchMock = vi.hoisted(() => vi.fn());
const approvalMutationMock = vi.hoisted(() => ({ mutate: vi.fn(), isPending: false }));
const electronicInvoiceAvailabilityMock = vi.hoisted(() =>
  vi.fn(() => ({
    available: false,
    identificationTypes: [] as Array<{
      code: string;
      abbr: string;
      nameEs: string;
      nameEn: string;
    }>,
  }))
);

vi.mock('@/lib/trpc', () => ({
  trpc: {
    useUtils: () => ({
      managerApprovals: { mine: { invalidate: approvalInvalidateMock } },
    }),
    customerLedger: {
      getBalance: {
        useQuery: () => ({ data: { balance: 0 }, isLoading: false, error: null }),
      },
    },
    lossPrevention: {
      evaluateCheckout: {
        useQuery: () => ({
          data: { requiredActions: [], violations: [] },
          isLoading: false,
          isFetching: false,
          error: null,
          refetch: vi.fn(),
        }),
      },
    },
    sales: {
      electronicInvoiceAvailability: {
        useQuery: () => ({ data: electronicInvoiceAvailabilityMock() }),
      },
      quotePromotions: {
        useQuery: () => ({
          data: undefined,
          isLoading: false,
          isFetching: false,
          isError: false,
          error: null,
          refetch: vi.fn(),
        }),
      },
    },
    pharmacy: {
      checkoutRequirements: {
        useQuery: () => ({
          data: {
            countryCode: 'CO',
            businessDate: '2026-09-02',
            customerValid: null,
            requirements: [],
            ready: true,
          },
          isLoading: false,
          isFetching: false,
          isError: false,
          error: null,
          refetch: vi.fn(),
        }),
      },
    },
    managerApprovals: {
      mine: {
        useQuery: () => ({
          data: [],
          isLoading: false,
          error: null,
          refetch: approvalRefetchMock,
        }),
      },
    },
    // the drawer mounts CustomerLoyaltyChip, which reads this.
    // Zero points keeps the chip silent, so this suite keeps asserting the
    // same surface it did before loyalty existed.
    loyalty: {
      forCustomer: {
        useQuery: () => ({ data: { points: 0, movements: [] }, isLoading: false, error: null }),
      },
    },
  },
}));

vi.mock('@/lib/useCriticalMutation', () => ({
  useCriticalMutation: () => approvalMutationMock,
}));

const toastSuccessMock = vi.hoisted(() => vi.fn());

// SalePaymentModal now consumes the toast pipeline to
// surface the auto-attach confirmation. The existing test suite does
// not mount ToastProvider, so we stub `useToast` with a stable mock for
// the new assertions and no-op shapes for the unused methods.
vi.mock('@/components/feedback/ToastProvider', () => ({
  useToast: () => ({
    success: toastSuccessMock,
    error: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
  }),
}));

const customers: Customer[] = [];

beforeEach(() => {
  let uuidCounter = 0;
  vi.mocked(crypto.randomUUID).mockImplementation(() => {
    uuidCounter += 1;
    return `00000000-0000-4000-8000-${String(uuidCounter).padStart(12, '0')}`;
  });
});

function makeCustomer(overrides: Partial<Customer> = {}): Customer {
  return {
    id: 'cust-new',
    tenantId: 'tenant-1',
    name: 'New Customer',
    isActive: true,
    version: 0,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    creditLimit: 0,
    ...overrides,
  };
}

function createProps(overrides?: Partial<React.ComponentProps<typeof SalePaymentModal>>) {
  return {
    isOpen: true,
    total: 100,
    customers,
    isSaving: false,
    error: null,
    promotionPricingEnabled: false,
    onClose: vi.fn(),
    onSubmit: vi.fn(async () => undefined) as (v: SalePaymentValues) => Promise<void>,
    ...overrides,
  };
}

afterEach(() => {
  act(() => {
    useQuickCreateStore.getState().reset();
    useCartWorkspaceStore.getState().resetAllWorkspaces();
  });
  toastSuccessMock.mockClear();
});

describe('SalePaymentModal — quick-created customer auto-attach', () => {
  beforeAll(async () => {
    await i18next.changeLanguage('en');
  });

  it('selects the pending quick-created customer when the option is already loaded', async () => {
    const customer = makeCustomer({ id: 'cust-ready', name: 'Ready Customer', priceTier: 2 });
    const onCustomerPriceTierChange = vi.fn();
    useQuickCreateStore.getState().setPendingCustomerAttach(customer.id);

    render(
      <SalePaymentModal {...createProps({ customers: [customer], onCustomerPriceTierChange })} />
    );

    await waitFor(() => {
      expect(screen.getByLabelText('Customer')).toHaveValue(customer.id);
    });
    expect(useQuickCreateStore.getState().pendingCustomerAttachId).toBeNull();
    expect(toastSuccessMock).toHaveBeenCalledWith({
      title: 'Customer created and attached to the sale.',
    });
    expect(onCustomerPriceTierChange).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: "Apply customer's Tier 2 prices" }));
    expect(onCustomerPriceTierChange).toHaveBeenCalledWith(2);
  });

  it('waits for the customers refetch before consuming the pending attach id', async () => {
    const customer = makeCustomer({ id: 'cust-delayed', name: 'Delayed Customer' });
    useQuickCreateStore.getState().setPendingCustomerAttach(customer.id);

    const { rerender } = render(<SalePaymentModal {...createProps({ customers: [] })} />);

    expect(screen.getByLabelText('Customer')).toHaveValue('');
    expect(useQuickCreateStore.getState().pendingCustomerAttachId).toBe(customer.id);
    expect(toastSuccessMock).not.toHaveBeenCalled();

    rerender(<SalePaymentModal {...createProps({ customers: [customer] })} />);

    await waitFor(() => {
      expect(screen.getByLabelText('Customer')).toHaveValue(customer.id);
    });
    expect(useQuickCreateStore.getState().pendingCustomerAttachId).toBeNull();
    expect(toastSuccessMock).toHaveBeenCalledWith({
      title: 'Customer created and attached to the sale.',
    });
  });

  it.each([
    { label: 'accepted quotation', customerLocked: true, approvalSaleId: null },
    { label: 'resumed draft', customerLocked: true, approvalSaleId: 'sale-locked' },
  ])('discards a pending attach for a locked $label', async props => {
    useQuickCreateStore.getState().setPendingCustomerAttach('cust-must-not-leak');

    render(<SalePaymentModal {...createProps(props)} />);

    await waitFor(() => {
      expect(useQuickCreateStore.getState().pendingCustomerAttachId).toBeNull();
    });
    expect(screen.getByLabelText('Customer')).toHaveValue('');
    expect(toastSuccessMock).not.toHaveBeenCalled();
  });

  it('attaches only to the workspace that requested the customer', async () => {
    const customer = makeCustomer({ id: 'cust-scoped', name: 'Scoped Customer' });
    const store = useCartWorkspaceStore.getState();
    const targetWorkspaceId = store.createDraft('tenant-1:user-1');
    const otherWorkspaceId = store.createDraft('tenant-1:user-1');
    useQuickCreateStore.getState().setPendingCustomerAttach(customer.id, targetWorkspaceId);

    render(<SalePaymentModal {...createProps({ customers: [customer] })} />);

    expect(screen.getByLabelText('Customer')).toHaveValue('');
    expect(useQuickCreateStore.getState().pendingCustomerAttachId).toBe(customer.id);

    await act(async () => {
      useCartWorkspaceStore.getState().setActive(targetWorkspaceId);
    });
    await waitFor(() => {
      expect(screen.getByLabelText('Customer')).toHaveValue(customer.id);
    });
    expect(useQuickCreateStore.getState().pendingCustomerAttachId).toBeNull();
    expect(useCartWorkspaceStore.getState().workspaces[otherWorkspaceId]).toBeDefined();
  });
});

describe('SalePaymentModal — customer price tier', () => {
  it('offers customer pricing without silently repricing the cart', async () => {
    const user = userEvent.setup();
    const onCustomerPriceTierChange = vi.fn();
    const customer = makeCustomer({ id: 'tier-3', name: 'Tier Three', priceTier: 3 });
    render(
      <SalePaymentModal {...createProps({ customers: [customer], onCustomerPriceTierChange })} />
    );

    expect(onCustomerPriceTierChange).not.toHaveBeenCalled();
    await user.selectOptions(screen.getByLabelText('Customer'), customer.id);
    expect(onCustomerPriceTierChange).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: "Apply customer's Tier 3 prices" }));
    expect(onCustomerPriceTierChange).toHaveBeenLastCalledWith(3);

    await user.selectOptions(screen.getByLabelText('Customer'), '');
    expect(onCustomerPriceTierChange).toHaveBeenCalledTimes(1);
  });

  it('updates untouched payment inputs when repricing changes the total', async () => {
    const props = createProps({ total: 100 });
    const { rerender } = render(<SalePaymentModal {...props} />);
    const amountInput = screen.getByLabelText(/Amount received/i) as HTMLInputElement;
    expect(amountInput.value).toBe('100');

    rerender(<SalePaymentModal {...props} total={80} />);
    await waitFor(() => expect(amountInput.value).toBe('80'));
  });

  it('preserves a manually edited payment amount across repricing', async () => {
    const user = userEvent.setup();
    const props = createProps({ total: 100 });
    const { rerender } = render(<SalePaymentModal {...props} />);
    const amountInput = screen.getByLabelText(/Amount received/i) as HTMLInputElement;
    await user.clear(amountInput);
    await user.type(amountInput, '150');

    rerender(<SalePaymentModal {...props} total={80} />);
    await waitFor(() => expect(amountInput.value).toBe('150'));
  });
});

describe('SalePaymentModal — stable drawer shell', () => {
  it('asks for the tip above the total, then the tender, then the customer', async () => {
    render(<SalePaymentModal {...createProps({ allowTip: true })} />);

    const tip = await screen.findByRole('group', { name: 'Voluntary tip' });
    const total = screen.getByRole('status', { name: 'Sale total' });
    const amount = await screen.findByLabelText('Amount received');
    const customer = screen.getByLabelText('Customer');

    expect(screen.getByTestId('sale-payment-summary')).toContainElement(tip);
    expect(tip.compareDocumentPosition(total)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(total.compareDocumentPosition(amount)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(amount.compareDocumentPosition(customer)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  });

  it('shows the impoconsumo included in the total', async () => {
    render(<SalePaymentModal {...createProps({ total: 108, consumptionTaxAmount: 8 })} />);
    expect(screen.getByTestId('sale-payment-total-detail')).toHaveTextContent(
      'Consumption tax included $8.00'
    );
  });

  it('charges whole pesos for a fractional COP total and names the rounding', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn(async () => undefined);
    render(<SalePaymentModal {...createProps({ total: 3737.5, currencyCode: 'COP', onSubmit })} />);
    expect(screen.getByRole('status', { name: 'Sale total' })).toHaveTextContent(
      formatCurrency(3738)
    );
    expect(screen.getByTestId('sale-payment-total-detail')).toHaveTextContent('Rounding $0.50');
    const amountInput = screen.getByLabelText(/Amount received/i) as HTMLInputElement;
    await waitFor(() => expect(amountInput.value).toBe('3738'));

    await user.click(screen.getByRole('button', { name: /Confirm Sale/i }));
    const submitted = onSubmit.mock.calls.at(0)?.at(0) as unknown as SalePaymentValues;
    expect(submitted.amountReceived).toBe(3738);
  });

  it('blocks cash received with cents in a whole-peso currency', async () => {
    const user = userEvent.setup();
    render(<SalePaymentModal {...createProps({ total: 3737.5, currencyCode: 'COP' })} />);
    const amountInput = screen.getByLabelText(/Amount received/i) as HTMLInputElement;
    await waitFor(() => expect(amountInput.value).toBe('3738'));
    await user.clear(amountInput);
    await user.type(amountInput, '4000.5');
    const confirm = screen.getByRole('button', { name: /Use whole amounts/i });
    expect(confirm).toBeDisabled();
  });

  beforeAll(async () => {
    await i18next.changeLanguage('en');
  });

  it('keeps the title, total summary, and actions in a labelled wide drawer', () => {
    render(<SalePaymentModal {...createProps()} />);

    const dialog = screen.getByRole('dialog', { name: 'Charge Sale' });
    const drawer = screen.getByTestId('sale-payment-drawer');
    expect(dialog).toContainElement(drawer);
    expect(drawer).toHaveClass('sm:max-w-[40rem]');
    const summary = screen.getByTestId('sale-payment-summary');
    expect(summary.parentElement).toHaveClass('drawer-pinned-content');
    expect(summary.closest('.modal-body')).toBeNull();
    expect(screen.getByRole('status', { name: 'Sale total' })).toHaveTextContent('$100.00');
    expect(screen.getByRole('group', { name: 'Payment method' })).toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: 'Payment method' })).not.toBeInTheDocument();
    expect(screen.getByTestId('sale-payment-method-select')).toHaveAttribute('hidden');
    expect(screen.getByRole('button', { name: 'Back' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Confirm Sale' })).toBeVisible();
  });

  it('announces a server checkout error', () => {
    render(<SalePaymentModal {...createProps({ error: 'Terminal unavailable' })} />);

    expect(screen.getByRole('alert')).toHaveTextContent('Terminal unavailable');
  });

  it('forwards the explicit cashier focus target to the drawer', () => {
    const searchInput = document.createElement('input');
    document.body.appendChild(searchInput);
    const props = createProps({ restoreFocusTo: () => searchInput });
    const { rerender } = render(<SalePaymentModal {...props} />);

    rerender(<SalePaymentModal {...props} isOpen={false} />);

    expect(searchInput).toHaveFocus();
    searchInput.remove();
  });
});

describe('SalePaymentModal — split payments', () => {
  beforeAll(async () => {
    await i18next.changeLanguage('en');
  });

  it('defaults to single-tender mode and submits the legacy shape', async () => {
    const onSubmit = vi.fn(async () => undefined);
    render(<SalePaymentModal {...createProps({ onSubmit })} />);

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /Confirm Sale/i }));

    expect(onSubmit).toHaveBeenCalledTimes(1);
    const submittedValues = onSubmit.mock.calls.at(0)?.at(0) as unknown as SalePaymentValues;
    expect(submittedValues).toBeDefined();
    expect(submittedValues.tenders).toEqual([]);
    expect(submittedValues.paymentMethod).toBe('cash');
    expect(submittedValues.amountReceived).toBe(100);
  });

  it('blocks confirm while split tenders do not sum to the total', async () => {
    const onSubmit = vi.fn(async () => undefined);
    render(<SalePaymentModal {...createProps({ onSubmit })} />);

    const user = userEvent.setup();
    // Enable split mode (adds one initial tender at amount=total=100).
    await user.click(screen.getByRole('button', { name: /Split payment across tenders/i }));
    // Adjust the amount below total — confirm must go disabled.
    const firstAmount = (await screen.findByLabelText('Amount for tender 1')) as HTMLInputElement;
    await user.clear(firstAmount);
    await user.type(firstAmount, '40');

    expect(screen.getByRole('button', { name: /Confirm Sale/i })).toBeDisabled();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('shows what is left to cover until the split reaches zero', async () => {
    render(<SalePaymentModal {...createProps()} />);

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /Split payment across tenders/i }));
    const remaining = await screen.findByTestId('split-remaining');
    expect(screen.getByTestId('split-meter')).toHaveTextContent('Tendered');

    const firstAmount = (await screen.findByLabelText('Amount for tender 1')) as HTMLInputElement;
    await user.clear(firstAmount);
    await user.type(firstAmount, '40');
    expect(screen.getByText('Remaining')).toBeInTheDocument();
    expect(remaining).toHaveTextContent(/60/);
    expect(screen.getByRole('button', { name: /missing/i })).toBeDisabled();

    await user.clear(firstAmount);
    await user.type(firstAmount, '130');
    expect(screen.getByText('Over')).toBeInTheDocument();
    expect(remaining).toHaveTextContent(/30/);
    expect(screen.getByRole('button', { name: /over$/i })).toBeDisabled();

    await user.clear(firstAmount);
    await user.type(firstAmount, '100');
    expect(remaining).toHaveTextContent(/0/);
    expect(screen.getByRole('button', { name: /^Confirm Sale$/i })).toBeInTheDocument();
  });

  it('accepts a balanced two-tender split and forwards the tenders array on submit', async () => {
    const onSubmit = vi.fn(async () => undefined);
    render(<SalePaymentModal {...createProps({ onSubmit })} />);

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /Split payment across tenders/i }));

    // First tender already seeded to 100. Lower it to 60 (cash).
    const firstAmount = (await screen.findByLabelText('Amount for tender 1')) as HTMLInputElement;
    fireEvent.change(firstAmount, { target: { value: '60' } });

    // Add a second tender row and fill it in (card, 40, reference).
    await user.click(screen.getByRole('button', { name: /Add payment method/i }));
    const secondAmount = screen.getByLabelText('Amount for tender 2') as HTMLInputElement;
    fireEvent.change(secondAmount, { target: { value: '40' } });
    const secondReference = screen.getByLabelText('Reference for tender 2');
    await user.type(secondReference, 'AUTH-42');
    const secondMethod = screen.getByLabelText('Method for tender 2') as HTMLSelectElement;
    await user.selectOptions(secondMethod, 'card');

    // Confirm becomes enabled because Σ=100 matches total.
    const confirmBtn = screen.getByRole('button', { name: /Confirm Sale/i });
    await waitFor(() => {
      expect(confirmBtn).not.toBeDisabled();
    });

    await user.click(confirmBtn);
    expect(onSubmit).toHaveBeenCalledTimes(1);
    const submittedValues = onSubmit.mock.calls.at(0)?.at(0) as unknown as SalePaymentValues;
    expect(submittedValues).toBeDefined();
    expect(submittedValues.tenders).toHaveLength(2);
    expect(submittedValues.tenders[0]?.method).toBe('cash');
    expect(submittedValues.tenders[0]?.amount).toBe(60);
    expect(submittedValues.tenders[1]?.method).toBe('card');
    expect(submittedValues.tenders[1]?.amount).toBe(40);
    expect(submittedValues.tenders[1]?.reference).toBe('AUTH-42');
  });

  it('does not offer credit as a split tender option', async () => {
    render(<SalePaymentModal {...createProps()} />);

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /Split payment across tenders/i }));

    const firstMethod = (await screen.findByLabelText('Method for tender 1')) as HTMLSelectElement;
    expect(Array.from(firstMethod.options).map(option => option.value)).not.toContain('credit');
  });

  it('switching back to single-tender strips the tenders from submit payload', async () => {
    const onSubmit = vi.fn(async () => undefined);
    render(<SalePaymentModal {...createProps({ onSubmit })} />);

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /Split payment across tenders/i }));
    await user.click(await screen.findByRole('button', { name: /Use single tender/i }));
    await user.click(screen.getByRole('button', { name: /Confirm Sale/i }));

    expect(onSubmit).toHaveBeenCalledTimes(1);
    const submittedValues = onSubmit.mock.calls.at(0)?.at(0) as unknown as SalePaymentValues;
    expect(submittedValues).toBeDefined();
    expect(submittedValues.tenders).toEqual([]);
  });
});

describe('SalePaymentModal — tip / propina', () => {
  beforeAll(async () => {
    await i18next.changeLanguage('en');
  });

  it('defaults to zero tip and submits tipMethod=null', async () => {
    const onSubmit = vi.fn(async () => undefined);
    render(<SalePaymentModal {...createProps({ onSubmit })} />);

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /Confirm Sale/i }));

    expect(onSubmit).toHaveBeenCalledTimes(1);
    const submittedValues = onSubmit.mock.calls.at(0)?.at(0) as unknown as SalePaymentValues;
    expect(submittedValues.tipAmount).toBe(0);
    expect(submittedValues.tipMethod).toBeNull();
  });

  it('applies the 10% preset on top of the base total and submits tipMethod=percentage', async () => {
    const onSubmit = vi.fn(async () => undefined);
    render(<SalePaymentModal {...createProps({ onSubmit, total: 100 })} />);

    const user = userEvent.setup();
    // Each preset shows what it adds: "10% $10.00".
    const preset = await screen.findByRole('button', { name: '10% $10.00' });
    expect(screen.getByRole('button', { name: '15% $15.00' })).toBeInTheDocument();
    await user.click(preset);

    // The total includes the tip and the consumption stays readable under it.
    await waitFor(() => {
      expect(screen.getByRole('status', { name: 'Sale total' })).toHaveTextContent('$110.00');
    });
    expect(preset).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('sale-payment-total-detail')).toHaveTextContent(
      'Consumption $100.00'
    );

    await user.click(screen.getByRole('button', { name: /Confirm Sale/i }));

    expect(onSubmit).toHaveBeenCalledTimes(1);
    const submittedValues = onSubmit.mock.calls.at(0)?.at(0) as unknown as SalePaymentValues;
    expect(submittedValues.amountReceived).toBeCloseTo(110, 2);
    expect(submittedValues.tipAmount).toBeCloseTo(10, 2);
    expect(submittedValues.tipMethod).toBe('percentage');
  });

  it('treats a custom tip amount as tipMethod=fixed at submit time', async () => {
    const onSubmit = vi.fn(async () => undefined);
    render(<SalePaymentModal {...createProps({ onSubmit, total: 80 })} />);

    const user = userEvent.setup();
    expect(screen.queryByLabelText('Tip amount')).not.toBeInTheDocument();
    await user.click(await screen.findByRole('button', { name: 'Other amount' }));
    const customInput = screen.getByLabelText('Tip amount') as HTMLInputElement;
    fireEvent.change(customInput, { target: { value: '7' } });

    await waitFor(() => {
      expect(screen.getByRole('status', { name: 'Sale total' })).toHaveTextContent('$87.00');
    });
    expect(screen.getByRole('button', { name: 'Other amount' })).toHaveAttribute(
      'aria-pressed',
      'true'
    );

    await user.click(screen.getByRole('button', { name: /Confirm Sale/i }));

    expect(onSubmit).toHaveBeenCalledTimes(1);
    const submittedValues = onSubmit.mock.calls.at(0)?.at(0) as unknown as SalePaymentValues;
    expect(submittedValues.amountReceived).toBeCloseTo(87, 2);
    expect(submittedValues.tipAmount).toBeCloseTo(7, 2);
    expect(submittedValues.tipMethod).toBe('fixed');
  });

  it('keeps the custom tip field while its amount is cleared and retyped', async () => {
    const user = userEvent.setup();
    const props = createProps({ total: 100 });
    const { rerender } = render(<SalePaymentModal {...props} />);
    await user.click(await screen.findByRole('button', { name: /^10%/ }));
    // The base moves under the chosen preset, so the same tip now reads as a custom amount.
    rerender(<SalePaymentModal {...props} total={80} />);
    const field = await screen.findByLabelText('Tip amount');
    await user.clear(field);
    expect(screen.getByLabelText('Tip amount')).toBeInTheDocument();
    await user.type(screen.getByLabelText('Tip amount'), '4');
    expect(screen.getByRole('status', { name: 'Sale total' })).toHaveTextContent('$84.00');
  });

  it('updates the seeded split tender when a tip is added after split mode is enabled', async () => {
    const onSubmit = vi.fn(async () => undefined);
    render(<SalePaymentModal {...createProps({ onSubmit, total: 100 })} />);

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /Split payment across tenders/i }));

    const firstAmount = (await screen.findByLabelText('Amount for tender 1')) as HTMLInputElement;
    expect(firstAmount.value).toBe('100');

    await user.click(await screen.findByRole('button', { name: /^10%/ }));

    await waitFor(() => {
      expect(firstAmount.value).toBe('110');
    });
    expect(screen.getByRole('button', { name: /Confirm Sale/i })).toBeDisabled();
  });

  it('seeds the first split tender at base + tip and blocks confirm until the sum matches', async () => {
    const onSubmit = vi.fn(async () => undefined);
    render(<SalePaymentModal {...createProps({ onSubmit, total: 100 })} />);

    const user = userEvent.setup();
    // Pick 10% tip first so the seeded split tender will be 110.
    await user.click(await screen.findByRole('button', { name: /^10%/ }));
    await user.click(screen.getByRole('button', { name: /Split payment across tenders/i }));

    const firstAmount = (await screen.findByLabelText('Amount for tender 1')) as HTMLInputElement;
    // The seeded amount mirrors base + tip (= grandTotal).
    expect(firstAmount.value).toBe('110');

    // Lower the first tender below the grand total — confirm goes
    // disabled because Σ no longer matches `total + tip = 110`.
    fireEvent.change(firstAmount, { target: { value: '100' } });
    expect(screen.getByRole('button', { name: /Confirm Sale/i })).toBeDisabled();
  });
});

describe('SalePaymentModal — service charge / propina sugerida', () => {
  beforeAll(async () => {
    await i18next.changeLanguage('en');
  });

  it('hides the service section when the tenant rate is zero and submits zeros', async () => {
    const onSubmit = vi.fn(async () => undefined);
    render(<SalePaymentModal {...createProps({ onSubmit, total: 100 })} />);

    expect(screen.queryByLabelText('Service charge')).not.toBeInTheDocument();

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /Confirm Sale/i }));

    expect(onSubmit).toHaveBeenCalledTimes(1);
    const submittedValues = onSubmit.mock.calls.at(0)?.at(0) as unknown as SalePaymentValues;
    expect(submittedValues.serviceChargeAmount).toBe(0);
    expect(submittedValues.serviceChargeRate).toBeNull();
  });

  it('auto-applies the tenant rate as a read-only line and folds it into the grand total', async () => {
    const onSubmit = vi.fn(async () => undefined);
    render(<SalePaymentModal {...createProps({ onSubmit, total: 100, serviceChargeRate: 10 })} />);

    expect(screen.getByLabelText('Service charge')).toBeInTheDocument();
    // The breakdown line above the totals header shows base + service.
    expect(screen.getByTestId('sale-payment-total-detail')).toHaveTextContent(
      'Consumption $100.00'
    );

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /Confirm Sale/i }));

    expect(onSubmit).toHaveBeenCalledTimes(1);
    const submittedValues = onSubmit.mock.calls.at(0)?.at(0) as unknown as SalePaymentValues;
    expect(submittedValues.serviceChargeAmount).toBeCloseTo(10, 2);
    expect(submittedValues.serviceChargeRate).toBe(10);
    // amountReceived defaults to grandTotal (110) when service is on.
    expect(submittedValues.amountReceived).toBeCloseTo(110, 2);
  });

  it('combines service charge and a tip preset into the grand total breakdown', async () => {
    const onSubmit = vi.fn(async () => undefined);
    render(<SalePaymentModal {...createProps({ onSubmit, total: 100, serviceChargeRate: 10 })} />);

    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: /^10%/ }));

    await waitFor(() => {
      expect(screen.getByRole('status', { name: 'Sale total' })).toHaveTextContent('$120.00');
    });

    await user.click(screen.getByRole('button', { name: /Confirm Sale/i }));

    expect(onSubmit).toHaveBeenCalledTimes(1);
    const submittedValues = onSubmit.mock.calls.at(0)?.at(0) as unknown as SalePaymentValues;
    expect(submittedValues.tipAmount).toBeCloseTo(10, 2);
    expect(submittedValues.serviceChargeAmount).toBeCloseTo(10, 2);
    // grandTotal = base 100 + service 10 + tip 10 = 120.
    expect(submittedValues.amountReceived).toBeCloseTo(120, 2);
  });

  it('seeds the first split tender at base + service when split mode is enabled', async () => {
    const onSubmit = vi.fn(async () => undefined);
    render(<SalePaymentModal {...createProps({ onSubmit, total: 100, serviceChargeRate: 10 })} />);

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /Split payment across tenders/i }));

    const firstAmount = (await screen.findByLabelText('Amount for tender 1')) as HTMLInputElement;
    expect(firstAmount.value).toBe('110');
  });
});

// F2 fast-cash flow. Mount-time + trigger-while-open
// behaviour, plus backward-compat (defaults do nothing).
describe('SalePaymentModal —  fast-cash', () => {
  it('does not auto-fill when fastCashTrigger is omitted (backward compat)', () => {
    render(<SalePaymentModal {...createProps({ total: 100 })} />);
    const amountInput = screen.getByLabelText(/Amount received/i) as HTMLInputElement;
    // Default seed is total + serviceCharge (0 here) so the value is
    // 100, but the toast must NOT have fired since fastCashTrigger=0.
    expect(amountInput.value).toBe('100');
    expect(toastSuccessMock).not.toHaveBeenCalled();
  });

  it('auto-applies rapid-cash when fastCashTrigger is positive on mount', async () => {
    render(<SalePaymentModal {...createProps({ total: 100, fastCashTrigger: 1 })} />);
    const amountInput = screen.getByLabelText(/Amount received/i) as HTMLInputElement;
    await waitFor(() => {
      expect(amountInput.value).toBe('100');
    });
    // The success toast confirms the auto-fill landed (i18n key:
    // sales:fastCash.toast.applied). Toast presence is the most
    // robust signal of the flow firing — the form value alone could
    // be the default seed.
    await waitFor(() => {
      expect(toastSuccessMock).toHaveBeenCalled();
    });
  });

  it('re-applies rapid-cash when fastCashTrigger increments while the modal is open', async () => {
    const user = userEvent.setup();
    const { rerender } = render(
      <SalePaymentModal {...createProps({ total: 100, fastCashTrigger: 0 })} />
    );
    const amountInput = screen.getByLabelText(/Amount received/i) as HTMLInputElement;
    // Cashier types a wrong amount — simulate by clearing and typing.
    await user.clear(amountInput);
    await user.type(amountInput, '50');
    expect(amountInput.value).toBe('50');
    expect(toastSuccessMock).not.toHaveBeenCalled();

    // Parent increments the trigger (F2 pressed again).
    rerender(<SalePaymentModal {...createProps({ total: 100, fastCashTrigger: 1 })} />);

    await waitFor(() => {
      expect(amountInput.value).toBe('100');
    });
    expect(toastSuccessMock).toHaveBeenCalled();
  });

  it('does NOT re-apply when fastCashTrigger stays at its mount-time baseline', async () => {
    const { rerender } = render(
      <SalePaymentModal {...createProps({ total: 100, fastCashTrigger: 5 })} />
    );
    // Re-rendering with the SAME trigger value must not call the
    // toast — only INCREMENTS fire the effect.
    rerender(<SalePaymentModal {...createProps({ total: 100, fastCashTrigger: 5 })} />);
    await waitFor(() => {
      expect(toastSuccessMock).toHaveBeenCalledTimes(1);
    });
  });
});

describe('SalePaymentModal — explicit partial settlement', () => {
  beforeEach(async () => {
    await i18next.changeLanguage('en');
  });
  it('announces the unpaid balance and submits a deliberate partial sale', async () => {
    const props = createProps({ total: 30000 });
    render(<SalePaymentModal {...props} />);
    const user = userEvent.setup();
    const amount = await screen.findByLabelText(/Amount received/i);
    await user.clear(amount);
    await user.type(amount, '20000');
    expect(screen.getByRole('alert')).toHaveTextContent('outstanding balance');
    expect(screen.getByRole('alert')).toHaveTextContent('10,000');
    await user.click(
      screen.getByRole('button', { name: /Confirm partial sale .*10,000.* missing/ })
    );
    expect(props.onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ amountReceived: 20000, paymentMethod: 'cash', tenders: [] })
    );
  });
  it('pins received and change next to confirm, and the balance when short', async () => {
    render(<SalePaymentModal {...createProps({ total: 30000 })} />);
    const user = userEvent.setup();
    const amount = await screen.findByLabelText(/Amount received/i);
    await user.clear(amount);
    await user.type(amount, '50000');

    const settlement = within(screen.getByTestId('payment-settlement'));
    expect(settlement.getByText('Change due')).toBeVisible();
    expect(screen.getByTestId('payment-settlement-amount')).toHaveTextContent('20,000');

    await user.clear(amount);
    await user.type(amount, '20000');
    expect(settlement.getByText('Outstanding balance')).toBeVisible();
    // Same tenant formatting as the total, never the drawer's unwired currency default.
    expect(screen.getByTestId('payment-settlement-amount')).toHaveTextContent(
      formatCurrency(10000)
    );

    await user.click(screen.getByRole('button', { name: 'Split payment across tenders' }));
    expect(screen.queryByTestId('payment-settlement')).not.toBeInTheDocument();
  });

  it('removes the partial warning when the received amount covers the sale', async () => {
    render(<SalePaymentModal {...createProps()} />);
    const user = userEvent.setup();
    const amount = await screen.findByLabelText(/Amount received/i);
    await user.clear(amount);
    await user.type(amount, '50');
    expect(screen.getByRole('button', { name: /Confirm partial sale/ })).toBeVisible();
    await user.clear(amount);
    await user.type(amount, '200');
    expect(screen.queryByText('This sale will remain partially paid')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Confirm Sale' })).toBeVisible();
  });
});

describe('SalePaymentModal — customer asked for an electronic invoice', () => {
  const identificationTypes = [
    { code: '13', abbr: 'CC', nameEs: 'Cédula de ciudadanía', nameEn: 'Citizenship ID' },
    { code: '31', abbr: 'NIT', nameEs: 'Número de identificación tributaria', nameEn: 'Tax ID' },
  ];

  beforeAll(async () => {
    await i18next.changeLanguage('en');
  });

  beforeEach(() => {
    electronicInvoiceAvailabilityMock.mockReturnValue({ available: true, identificationTypes });
  });

  afterEach(() => {
    electronicInvoiceAvailabilityMock.mockReset();
    electronicInvoiceAvailabilityMock.mockReturnValue({
      available: false,
      identificationTypes: [],
    });
  });

  function lastSubmitted(onSubmit: ReturnType<typeof vi.fn>): SalePaymentValues {
    return onSubmit.mock.calls.at(-1)?.at(0) as unknown as SalePaymentValues;
  }

  it('hides the selector where the business cannot issue an invoice', async () => {
    electronicInvoiceAvailabilityMock.mockReturnValue({
      available: false,
      identificationTypes: [],
    });
    render(<SalePaymentModal {...createProps()} />);

    await screen.findByRole('button', { name: /Confirm Sale/i });
    expect(screen.queryByTestId('sale-electronic-invoice')).not.toBeInTheDocument();
  });

  it('charges a large sale without asking for buyer data when the selector stays off', async () => {
    const onSubmit = vi.fn(async () => undefined);
    render(<SalePaymentModal {...createProps({ onSubmit, total: 300_000 })} />);

    const toggle = await screen.findByRole('switch', { name: 'Electronic invoice' });
    expect(toggle).not.toBeChecked();
    expect(screen.queryByLabelText('Name or business name')).not.toBeInTheDocument();

    await userEvent.setup().click(screen.getByRole('button', { name: /Confirm Sale/i }));

    expect(onSubmit).toHaveBeenCalledTimes(1);
    const submitted = lastSubmitted(onSubmit);
    expect(submitted.electronicInvoice).toBeUndefined();
    expect(submitted).not.toHaveProperty('invoiceRequested');
    expect(submitted).not.toHaveProperty('invoiceBuyer');
  });

  it('asks for buyer data only after the selector is on and submits the request', async () => {
    const onSubmit = vi.fn(async () => undefined);
    render(<SalePaymentModal {...createProps({ onSubmit })} />);
    const user = userEvent.setup();

    await user.click(await screen.findByRole('switch', { name: 'Electronic invoice' }));
    await user.click(screen.getByRole('button', { name: /Confirm and invoice/i }));
    expect(onSubmit).not.toHaveBeenCalled();
    expect(await screen.findAllByText('Required')).toHaveLength(2);

    await user.type(screen.getByLabelText('Name or business name'), '  Ferretería La 14 SAS ');
    await user.selectOptions(screen.getByLabelText('ID type'), '31');
    await user.type(screen.getByLabelText('ID number'), '900373115-3');
    await user.click(screen.getByRole('button', { name: /Confirm and invoice/i }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(lastSubmitted(onSubmit).electronicInvoice).toEqual({
      buyer: {
        name: 'Ferretería La 14 SAS',
        identificationTypeCode: '31',
        identificationNumber: '900373115-3',
      },
    });
  });

  it('flags a NIT whose verification digit does not match', async () => {
    const onSubmit = vi.fn(async () => undefined);
    render(<SalePaymentModal {...createProps({ onSubmit })} />);
    const user = userEvent.setup();

    await user.click(await screen.findByRole('switch', { name: 'Electronic invoice' }));
    await user.type(screen.getByLabelText('Name or business name'), 'Ferretería La 14 SAS');
    await user.selectOptions(screen.getByLabelText('ID type'), '31');
    await user.type(screen.getByLabelText('ID number'), '900373115-9');
    await user.click(screen.getByRole('button', { name: /Confirm and invoice/i }));

    expect(
      await screen.findByText('The verification digit does not match (should be 3)')
    ).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('picks NIT when the attached customer number carries a verification digit', async () => {
    const customer = makeCustomer({
      id: 'cust-company',
      name: 'Ferretería La 13 S.A.S.',
      taxId: '900373115-3',
    });
    render(
      <SalePaymentModal
        {...createProps({ customers: [customer], approvalCustomerId: customer.id })}
      />
    );

    await userEvent
      .setup()
      .click(await screen.findByRole('switch', { name: 'Electronic invoice' }));
    expect(screen.getByLabelText('ID type')).toHaveValue('31');
    expect(screen.getByLabelText('ID number')).toHaveValue('900373115');
    expect(screen.getByLabelText('DV')).toHaveValue('3');
    expect(screen.getByRole('img', { name: 'Verification digit is correct' })).toBeInTheDocument();
    expect(screen.getByTestId('sale-invoice-saved-buyer')).toHaveTextContent(
      'Saved customer: next time the NIT is enough'
    );
  });

  it('keeps the ticket customer selected when the customer list arrives after opening', async () => {
    const customer = makeCustomer({ id: 'cust-late', name: 'María López' });
    const { rerender } = render(
      <SalePaymentModal
        {...createProps({
          customers: [],
          approvalCustomerId: customer.id,
          lockedCustomerName: customer.name,
        })}
      />
    );
    expect(screen.getByLabelText('Customer')).toHaveDisplayValue('María López');

    rerender(
      <SalePaymentModal
        {...createProps({
          customers: [customer],
          approvalCustomerId: customer.id,
          lockedCustomerName: customer.name,
        })}
      />
    );

    await waitFor(() => expect(screen.getByLabelText('Customer')).toHaveValue('cust-late'));
    expect(screen.getByLabelText('Customer')).toHaveDisplayValue('María López');
  });

  it('shows the verification digit an undashed NIT will be recorded with', async () => {
    render(<SalePaymentModal {...createProps()} />);
    const user = userEvent.setup();

    await user.click(await screen.findByRole('switch', { name: 'Electronic invoice' }));
    await user.selectOptions(screen.getByLabelText('ID type'), '31');
    await user.type(screen.getByLabelText('ID number'), '9003731153');

    expect(screen.getByLabelText('DV')).toHaveAttribute('placeholder', '4');
    expect(screen.getByLabelText('DV')).toHaveValue('');
  });

  it('keeps the NIT and its verification digit in separate boxes and submits them together', async () => {
    const onSubmit = vi.fn(async () => undefined);
    render(<SalePaymentModal {...createProps({ onSubmit })} />);
    const user = userEvent.setup();

    await user.click(await screen.findByRole('switch', { name: 'Electronic invoice' }));
    await user.type(screen.getByLabelText('Name or business name'), 'Ferretería La 14 SAS');
    await user.selectOptions(screen.getByLabelText('ID type'), '31');
    await user.type(screen.getByLabelText('ID number'), '900.373.115');
    await user.type(screen.getByLabelText('DV'), '3');
    expect(screen.getByRole('img', { name: 'Verification digit is correct' })).toBeInTheDocument();
    expect(screen.getByText(/Sent to the DIAN on confirm/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Confirm and invoice' }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(lastSubmitted(onSubmit).electronicInvoice?.buyer.identificationNumber).toBe(
      '900.373.115-3'
    );
  });

  it('asks for the number again when the cashier clears a NIT that had its DV', async () => {
    render(<SalePaymentModal {...createProps()} />);
    const user = userEvent.setup();

    await user.click(await screen.findByRole('switch', { name: 'Electronic invoice' }));
    await user.type(screen.getByLabelText('Name or business name'), 'Ferretería La 14 SAS');
    await user.selectOptions(screen.getByLabelText('ID type'), '31');
    await user.type(screen.getByLabelText('ID number'), '900373115-3');
    await user.clear(screen.getByLabelText('ID number'));
    await user.click(screen.getByRole('button', { name: /Confirm and invoice/i }));

    expect(await screen.findByText('Required')).toBeInTheDocument();
    expect(screen.queryByText('Invalid ID number')).not.toBeInTheDocument();
  });

  it('switches to NIT when the typed number belongs to a saved company', async () => {
    const company = makeCustomer({
      id: 'cust-andina',
      name: 'Constructora Andina SAS',
      taxId: '900373115-3',
    });
    render(<SalePaymentModal {...createProps({ customers: [company] })} />);
    const user = userEvent.setup();

    await user.click(await screen.findByRole('switch', { name: 'Electronic invoice' }));
    expect(screen.getByLabelText('ID type')).toHaveValue('13');
    await user.type(screen.getByLabelText('ID number'), '900373115');

    expect(screen.getByLabelText('ID type')).toHaveValue('31');
    expect(screen.getByLabelText('DV')).toHaveAttribute('placeholder', '3');
    expect(screen.getByTestId('sale-invoice-saved-buyer')).toHaveTextContent('NIT');
  });

  it('keeps a dashed ID whole when the cashier moves between non-NIT types', async () => {
    electronicInvoiceAvailabilityMock.mockReturnValue({
      available: true,
      identificationTypes: [
        { code: '13', abbr: 'CC', nameEs: 'Cédula de ciudadanía', nameEn: 'Citizenship ID' },
        { code: '41', abbr: 'PA', nameEs: 'Pasaporte', nameEn: 'Passport' },
      ],
    });
    render(<SalePaymentModal {...createProps()} />);
    const user = userEvent.setup();

    await user.click(await screen.findByRole('switch', { name: 'Electronic invoice' }));
    await user.type(screen.getByLabelText('ID number'), 'AB123-4');
    await user.selectOptions(screen.getByLabelText('ID type'), '41');

    expect(screen.getByLabelText('ID number')).toHaveValue('AB123-4');
  });

  it('drops the verification digit when the ID type stops being a NIT', async () => {
    render(<SalePaymentModal {...createProps()} />);
    const user = userEvent.setup();

    await user.click(await screen.findByRole('switch', { name: 'Electronic invoice' }));
    await user.selectOptions(screen.getByLabelText('ID type'), '31');
    await user.type(screen.getByLabelText('ID number'), '900373115-3');
    await user.selectOptions(screen.getByLabelText('ID type'), '13');

    expect(screen.queryByLabelText('DV')).not.toBeInTheDocument();
    expect(screen.getByLabelText('ID number')).toHaveValue('900373115');
  });

  it('fills a saved buyer from the typed ID on a walk-in sale', async () => {
    const company = makeCustomer({
      id: 'cust-andina',
      name: 'Constructora Andina SAS',
      taxId: '900373115-3',
      email: 'compras@andina.co',
    });
    render(<SalePaymentModal {...createProps({ customers: [company] })} />);
    const user = userEvent.setup();

    await user.click(await screen.findByRole('switch', { name: 'Electronic invoice' }));
    await user.selectOptions(screen.getByLabelText('ID type'), '31');
    await user.type(screen.getByLabelText('ID number'), '900373115');

    expect(screen.getByLabelText('Name or business name')).toHaveValue('Constructora Andina SAS');
    expect(screen.getByLabelText('Email to send it to')).toHaveValue('compras@andina.co');
    expect(screen.getByTestId('sale-invoice-saved-buyer')).toBeInTheDocument();
    expect(screen.getByLabelText('Customer')).toHaveValue('');

    await user.type(screen.getByLabelText('ID number'), '9');
    expect(screen.getByLabelText('Name or business name')).toHaveValue('');
    expect(screen.queryByTestId('sale-invoice-saved-buyer')).not.toBeInTheDocument();
  });

  it('prefills the buyer from the attached customer', async () => {
    const onSubmit = vi.fn(async () => undefined);
    const customer = makeCustomer({
      id: 'cust-invoice',
      name: 'Ana Gómez',
      taxId: '1020304050',
      email: 'ana@example.co',
    });
    render(
      <SalePaymentModal
        {...createProps({ onSubmit, customers: [customer], approvalCustomerId: customer.id })}
      />
    );
    const user = userEvent.setup();

    await user.click(await screen.findByRole('switch', { name: 'Electronic invoice' }));
    expect(screen.getByLabelText('Name or business name')).toHaveValue('Ana Gómez');
    expect(screen.getByLabelText('ID number')).toHaveValue('1020304050');
    await user.click(screen.getByRole('button', { name: /Confirm and invoice/i }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(lastSubmitted(onSubmit).electronicInvoice).toEqual({
      buyer: {
        name: 'Ana Gómez',
        identificationTypeCode: '13',
        identificationNumber: '1020304050',
        email: 'ana@example.co',
      },
    });
  });

  it('replaces the buyer the previous customer filled in when the customer changes', async () => {
    const ana = makeCustomer({ id: 'cust-ana', name: 'Ana Gómez', taxId: '1020304050' });
    const luis = makeCustomer({ id: 'cust-luis', name: 'Luis Pérez', taxId: '79876543' });
    render(<SalePaymentModal {...createProps({ customers: [ana, luis] })} />);
    const user = userEvent.setup();

    await user.selectOptions(await screen.findByLabelText('Customer'), 'cust-ana');
    await user.click(screen.getByRole('switch', { name: 'Electronic invoice' }));
    await user.clear(screen.getByLabelText('Name or business name'));
    await user.type(screen.getByLabelText('Name or business name'), 'Ana G.');
    await user.selectOptions(screen.getByLabelText('Customer'), 'cust-luis');

    expect(screen.getByLabelText('ID number')).toHaveValue('79876543');
    expect(screen.getByLabelText('Name or business name')).toHaveValue('Ana G.');
  });

  it('flags an ID the server would reject before charging', async () => {
    const onSubmit = vi.fn(async () => undefined);
    render(<SalePaymentModal {...createProps({ onSubmit })} />);
    const user = userEvent.setup();

    await user.click(await screen.findByRole('switch', { name: 'Electronic invoice' }));
    expect(screen.getByLabelText('Name or business name')).toHaveAttribute('maxLength', '200');
    await user.type(screen.getByLabelText('Name or business name'), 'Ana Gómez');
    await user.type(screen.getByLabelText('ID number'), '12');
    await user.click(screen.getByRole('button', { name: /Confirm and invoice/i }));
    expect(await screen.findByText('Invalid ID number')).toBeInTheDocument();

    await user.clear(screen.getByLabelText('ID number'));
    await user.type(screen.getByLabelText('ID number'), '222222222222');
    await user.click(screen.getByRole('button', { name: /Confirm and invoice/i }));
    expect(
      await screen.findByText('This is the consumidor final number, not a buyer')
    ).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });
});

describe('SalePaymentModal — electronic invoice selector in Spanish', () => {
  beforeAll(async () => {
    await i18next.changeLanguage('es');
  });

  afterAll(async () => {
    await i18next.changeLanguage('en');
  });

  beforeEach(() => {
    electronicInvoiceAvailabilityMock.mockReturnValue({
      available: true,
      identificationTypes: [
        { code: '13', abbr: 'CC', nameEs: 'Cédula de ciudadanía', nameEn: 'Citizenship ID' },
      ],
    });
  });

  afterEach(() => {
    electronicInvoiceAvailabilityMock.mockReturnValue({
      available: false,
      identificationTypes: [],
    });
  });

  it('labels the selector and buyer fields in neutral Spanish', async () => {
    render(<SalePaymentModal {...createProps()} />);
    await userEvent
      .setup()
      .click(await screen.findByRole('switch', { name: 'Factura electrónica' }));

    expect(screen.getByLabelText('Nombre o razón social')).toBeInTheDocument();
    expect(screen.getByLabelText('Tipo')).toHaveDisplayValue('CC');
    expect(screen.getByLabelText('Número')).toBeInTheDocument();
    expect(screen.getByLabelText('Correo para enviarla')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Confirmar y facturar' })).toBeInTheDocument();
    expect(
      screen.getByText(
        'Se envía a la DIAN al confirmar. Sin conexión, la venta sale y la factura queda en cola.'
      )
    ).toBeInTheDocument();
  });
});

describe('SalePaymentModal — cash change hero', () => {
  beforeEach(async () => {
    await i18next.changeLanguage('en');
  });

  it('builds the received amount on the keypad and shows the change with one way to give it', async () => {
    render(<SalePaymentModal {...createProps({ total: 30000, currencyCode: 'COP' })} />);
    const user = userEvent.setup();
    const amount = await screen.findByLabelText(/Amount received/i);

    // The preset total is replaced by the first key, then each key extends it.
    await user.click(screen.getByTestId('sale-payment-key-5'));
    await user.click(screen.getByTestId('sale-payment-key-0'));
    await user.click(screen.getByTestId('sale-payment-key-000'));
    expect(amount).toHaveValue(50000);
    expect(screen.getByTestId('payment-settlement-amount')).toHaveTextContent(
      formatCurrency(20000)
    );
    expect(screen.getByTestId('payment-change-breakdown')).toHaveTextContent(
      `1 × ${formatCurrency(20000)}`
    );

    await user.click(screen.getByRole('button', { name: 'Delete last digit' }));
    expect(amount).toHaveValue(5000);
    expect(
      within(screen.getByTestId('payment-settlement')).getByText('Outstanding balance')
    ).toBeVisible();
    expect(screen.queryByTestId('payment-change-breakdown')).not.toBeInTheDocument();
  });

  it('lets a bill key preset the amount and a typed amount keep extending', async () => {
    render(<SalePaymentModal {...createProps({ total: 30000, currencyCode: 'COP' })} />);
    const user = userEvent.setup();
    const amount = await screen.findByLabelText(/Amount received/i);

    await user.click(screen.getByTestId('quick-denomination-50000'));
    expect(amount).toHaveValue(50000);
    await user.click(screen.getByTestId('sale-payment-key-1'));
    expect(amount).toHaveValue(1);

    await user.clear(amount);
    await user.type(amount, '4');
    await user.click(screen.getByTestId('sale-payment-key-0'));
    expect(amount).toHaveValue(40);
  });

  it('treats a bill key as a preset even when it matches the keyed amount', async () => {
    render(<SalePaymentModal {...createProps({ total: 30000, currencyCode: 'COP' })} />);
    const user = userEvent.setup();
    const amount = await screen.findByLabelText(/Amount received/i);

    for (const key of ['5', '0', '000']) {
      await user.click(screen.getByTestId(`sale-payment-key-${key}`));
    }
    await user.click(screen.getByTestId('quick-denomination-50000'));
    await user.click(screen.getByTestId('sale-payment-key-1'));
    expect(amount).toHaveValue(1);
  });

  it('splits the change into bills and coins for the tenant currency only', async () => {
    const { unmount } = render(
      <SalePaymentModal {...createProps({ total: 87420, currencyCode: 'COP' })} />
    );
    const user = userEvent.setup();
    await user.click(await screen.findByTestId('quick-denomination-100000'));
    const chips = within(screen.getByTestId('payment-change-breakdown'))
      .getAllByRole('listitem')
      .map(item => item.textContent);
    expect(chips).toEqual([
      `1 × ${formatCurrency(10000)}`,
      `1 × ${formatCurrency(2000)}`,
      `${formatCurrency(580)} in coins`,
    ]);
    unmount();

    render(<SalePaymentModal {...createProps({ total: 87420, currencyCode: 'GTQ' })} />);
    await user.click(await screen.findByTestId('quick-denomination-100000'));
    expect(screen.getByTestId('payment-settlement-amount')).toHaveTextContent(
      formatCurrency(12580)
    );
    expect(screen.queryByTestId('payment-change-breakdown')).not.toBeInTheDocument();
  });

  it('keeps the keypad and the change to cash', async () => {
    render(<SalePaymentModal {...createProps({ total: 30000 })} />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Card' }));
    expect(screen.queryByTestId('sale-payment-keypad')).not.toBeInTheDocument();
    expect(screen.queryByTestId('quick-denomination-selector')).not.toBeInTheDocument();
    expect(screen.queryByTestId('payment-settlement')).not.toBeInTheDocument();
  });

  it('applies cashRoundingStep to cash-only checkouts and clears it on card', async () => {
    render(
      <SalePaymentModal
        {...createProps({ total: 5544, currencyCode: 'COP', cashRoundingStep: 50 })}
      />
    );
    const user = userEvent.setup();
    const summary = await screen.findByTestId('sale-payment-summary');
    expect(summary).toHaveTextContent(formatCurrency(5550));
    expect(screen.getByTestId('sale-payment-total-detail')).toHaveTextContent(
      formatCurrency(6, undefined, undefined, 2)
    );

    await user.click(screen.getByRole('button', { name: 'Card' }));
    expect(summary).toHaveTextContent(formatCurrency(5544));
    expect(screen.queryByTestId('sale-payment-total-detail')).not.toBeInTheDocument();
  });
});
