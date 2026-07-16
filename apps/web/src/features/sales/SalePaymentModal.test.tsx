import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import i18next from 'i18next';
import { render } from '@/test/utils';
import type { Customer } from '@/types';
import { SalePaymentModal, type SalePaymentValues } from './SalePaymentModal';
import { useQuickCreateStore } from './useQuickCreateStore';

const approvalInvalidateMock = vi.hoisted(() => vi.fn());
const approvalRefetchMock = vi.hoisted(() => vi.fn());
const approvalMutationMock = vi.hoisted(() => ({ mutate: vi.fn(), isPending: false }));

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
  },
}));

vi.mock('@/lib/useCriticalMutation', () => ({
  useCriticalMutation: () => approvalMutationMock,
}));

const toastSuccessMock = vi.hoisted(() => vi.fn());

// ENG-105c2 — SalePaymentModal now consumes the toast pipeline to
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
    onClose: vi.fn(),
    onSubmit: vi.fn(async () => undefined) as (v: SalePaymentValues) => Promise<void>,
    ...overrides,
  };
}

afterEach(() => {
  useQuickCreateStore.getState().reset();
  toastSuccessMock.mockClear();
});

describe('SalePaymentModal — quick-created customer auto-attach', () => {
  beforeAll(async () => {
    await i18next.changeLanguage('en');
  });

  it('selects the pending quick-created customer when the option is already loaded', async () => {
    const customer = makeCustomer({ id: 'cust-ready', name: 'Ready Customer' });
    useQuickCreateStore.getState().setPendingCustomerAttach(customer.id);

    render(<SalePaymentModal {...createProps({ customers: [customer] })} />);

    await waitFor(() => {
      expect(screen.getByLabelText('Customer')).toHaveValue(customer.id);
    });
    expect(useQuickCreateStore.getState().pendingCustomerAttachId).toBeNull();
    expect(toastSuccessMock).toHaveBeenCalledWith({
      title: 'Customer created and attached to the sale.',
    });
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
});

describe('SalePaymentModal — stable drawer shell (ENG-105h)', () => {
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
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeVisible();
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
    const firstAmount = screen.getByLabelText('Amount for tender 1') as HTMLInputElement;
    await user.clear(firstAmount);
    await user.type(firstAmount, '40');

    expect(screen.getByRole('button', { name: /Confirm Sale/i })).toBeDisabled();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('accepts a balanced two-tender split and forwards the tenders array on submit', async () => {
    const onSubmit = vi.fn(async () => undefined);
    render(<SalePaymentModal {...createProps({ onSubmit })} />);

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /Split payment across tenders/i }));

    // First tender already seeded to 100. Lower it to 60 (cash).
    const firstAmount = screen.getByLabelText('Amount for tender 1') as HTMLInputElement;
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

    const firstMethod = screen.getByLabelText('Method for tender 1') as HTMLSelectElement;
    expect(Array.from(firstMethod.options).map(option => option.value)).not.toContain('credit');
  });

  it('switching back to single-tender strips the tenders from submit payload', async () => {
    const onSubmit = vi.fn(async () => undefined);
    render(<SalePaymentModal {...createProps({ onSubmit })} />);

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /Split payment across tenders/i }));
    await user.click(screen.getByRole('button', { name: /Use single tender/i }));
    await user.click(screen.getByRole('button', { name: /Confirm Sale/i }));

    expect(onSubmit).toHaveBeenCalledTimes(1);
    const submittedValues = onSubmit.mock.calls.at(0)?.at(0) as unknown as SalePaymentValues;
    expect(submittedValues).toBeDefined();
    expect(submittedValues.tenders).toEqual([]);
  });
});

describe('SalePaymentModal — tip / propina (ENG-039d)', () => {
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
    // Three preset buttons render: "No tip", "10%", "15%".
    await user.click(screen.getByRole('button', { name: '10%' }));

    // Grand total header updates to base+tip = 110.
    await waitFor(() => {
      expect(screen.getByText(/Base \$100\.00 \+ tip \$10\.00/i)).toBeInTheDocument();
    });

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
    const customInput = screen.getByLabelText('Custom amount') as HTMLInputElement;
    fireEvent.change(customInput, { target: { value: '7' } });

    await waitFor(() => {
      expect(screen.getByText(/Base \$80\.00 \+ tip \$7\.00/i)).toBeInTheDocument();
    });

    await user.click(screen.getByRole('button', { name: /Confirm Sale/i }));

    expect(onSubmit).toHaveBeenCalledTimes(1);
    const submittedValues = onSubmit.mock.calls.at(0)?.at(0) as unknown as SalePaymentValues;
    expect(submittedValues.amountReceived).toBeCloseTo(87, 2);
    expect(submittedValues.tipAmount).toBeCloseTo(7, 2);
    expect(submittedValues.tipMethod).toBe('fixed');
  });

  it('updates the seeded split tender when a tip is added after split mode is enabled', async () => {
    const onSubmit = vi.fn(async () => undefined);
    render(<SalePaymentModal {...createProps({ onSubmit, total: 100 })} />);

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /Split payment across tenders/i }));

    const firstAmount = screen.getByLabelText('Amount for tender 1') as HTMLInputElement;
    expect(firstAmount.value).toBe('100');

    await user.click(screen.getByRole('button', { name: '10%' }));

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
    await user.click(screen.getByRole('button', { name: '10%' }));
    await user.click(screen.getByRole('button', { name: /Split payment across tenders/i }));

    const firstAmount = screen.getByLabelText('Amount for tender 1') as HTMLInputElement;
    // The seeded amount mirrors base + tip (= grandTotal).
    expect(firstAmount.value).toBe('110');

    // Lower the first tender below the grand total — confirm goes
    // disabled because Σ no longer matches `total + tip = 110`.
    fireEvent.change(firstAmount, { target: { value: '100' } });
    expect(screen.getByRole('button', { name: /Confirm Sale/i })).toBeDisabled();
  });
});

describe('SalePaymentModal — service charge / propina sugerida (ENG-039d3)', () => {
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
    expect(screen.getByText(/Base \$100\.00 \+ service \$10\.00$/i)).toBeInTheDocument();

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
    await user.click(screen.getByRole('button', { name: '10%' }));

    await waitFor(() => {
      expect(
        screen.getByText(/Base \$100\.00 \+ service \$10\.00 \+ tip \$10\.00$/i)
      ).toBeInTheDocument();
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

    const firstAmount = screen.getByLabelText('Amount for tender 1') as HTMLInputElement;
    expect(firstAmount.value).toBe('110');
  });
});

// ENG-105e — F2 fast-cash flow. Mount-time + trigger-while-open
// behaviour, plus backward-compat (defaults do nothing).
describe('SalePaymentModal — ENG-105e fast-cash', () => {
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
