/** One focused state per tender: cash and its change, transfer, credit, split, invoice. */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import i18next from 'i18next';
import { render } from '@/test/utils';
import { setActiveTenantLocale } from '@/lib/utils';
import type { Customer } from '@/types';
import { SalePaymentModal, type SalePaymentValues } from './SalePaymentModal';

const mocks = vi.hoisted(() => ({
  balance: 0,
  invoiceAvailable: false,
  approvalMutation: { mutate: vi.fn(), isPending: false },
}));

vi.mock('@/lib/trpc', () => ({
  trpc: {
    useUtils: () => ({ managerApprovals: { mine: { invalidate: vi.fn() } } }),
    customerLedger: {
      getBalance: {
        useQuery: () => ({
          data: { balance: mocks.balance },
          isLoading: false,
          isError: false,
          error: null,
          refetch: vi.fn(),
        }),
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
        useQuery: () => ({
          data: {
            available: mocks.invoiceAvailable,
            identificationTypes: [
              { code: '13', abbr: 'CC', nameEs: 'Cédula de ciudadanía', nameEn: 'Citizenship ID' },
              { code: '31', abbr: 'NIT', nameEs: 'NIT', nameEn: 'Tax ID' },
            ],
          },
        }),
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
        useQuery: () => ({ data: [], isLoading: false, error: null, refetch: vi.fn() }),
      },
    },
    loyalty: {
      forCustomer: {
        useQuery: () => ({ data: { points: 0, movements: [] }, isLoading: false, error: null }),
      },
    },
  },
}));

vi.mock('./SaleCashDrawerHint', () => ({
  SaleCashDrawerHint: () => <p data-testid="sale-cash-drawer-hint" />,
}));
vi.mock('./SaleTransferPanel', () => ({
  SaleTransferPanel: ({ isAdmin }: { isAdmin: boolean }) => (
    <div data-testid="sale-transfer-panel" data-admin={isAdmin} />
  ),
}));
vi.mock('@/lib/useCriticalMutation', () => ({
  useCriticalMutation: () => mocks.approvalMutation,
}));
vi.mock('@/components/feedback/ToastProvider', () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() }),
}));

const customer = {
  id: 'cust-1',
  tenantId: 'tenant-1',
  name: 'Ferretería Prueba SAS',
  taxId: '900373115-3',
  isActive: true,
  version: 0,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
  creditLimit: 150_000,
} as Customer;

function renderModal(overrides: Partial<React.ComponentProps<typeof SalePaymentModal>> = {}) {
  const onSubmit = vi.fn(async (_values: SalePaymentValues) => undefined);
  render(
    <SalePaymentModal
      isOpen
      total={87_420}
      customers={[customer]}
      isSaving={false}
      error={null}
      promotionPricingEnabled={false}
      userRole="admin"
      onClose={vi.fn()}
      onSubmit={onSubmit}
      {...overrides}
    />
  );
  return { onSubmit, user: userEvent.setup() };
}

const confirm = () => screen.getByTestId('sale-payment-confirm');
const submitted = (onSubmit: ReturnType<typeof vi.fn>) =>
  onSubmit.mock.calls.at(0)?.at(0) as SalePaymentValues;

beforeEach(async () => {
  vi.clearAllMocks();
  // Field-array rows key on a UUID; the shared setup returns a constant one.
  let uuidCounter = 0;
  vi.mocked(crypto.randomUUID).mockImplementation(() => {
    uuidCounter += 1;
    return `00000000-0000-4000-8000-${String(uuidCounter).padStart(12, '0')}`;
  });
  mocks.balance = 0;
  mocks.invoiceAvailable = false;
  await i18next.changeLanguage('en');
  setActiveTenantLocale({
    locale: 'en-US',
    currency: 'COP',
    displayDecimals: 0,
    timezone: 'America/Bogota',
    dateFormatShort: 'yyyy-MM-dd',
  });
});

describe('SalePaymentModal — cash, where the change is the hero', () => {
  it('counts the articles beside the title without renaming the dialog', () => {
    renderModal({
      approvalItems: [
        { productId: 'p1', unitId: 'u1', quantity: 2, unitPrice: 1000, discount: 0 },
        { productId: 'p2', unitId: 'u1', quantity: 0.25, unitPrice: 24_000, discount: 0 },
      ],
    });
    expect(screen.getByRole('dialog', { name: 'Charge Sale' })).toBeInTheDocument();
    expect(screen.getByTestId('sale-payment-item-count')).toHaveTextContent('· 3 items');
  });

  it('shows the change and one way to hand it over when a note is tapped', async () => {
    const { user } = renderModal();
    await user.click(await screen.findByTestId('quick-amount-100000'));

    const settlement = within(screen.getByTestId('payment-settlement'));
    expect(settlement.getByText('Change to give back')).toBeVisible();
    expect(screen.getByTestId('payment-settlement-amount')).toHaveTextContent('12,580');
    const breakdown = screen.getByTestId('change-breakdown');
    expect(breakdown).toHaveTextContent('One way to give it:');
    expect(breakdown).toHaveTextContent(/1 × \D*10,000/);
    expect(breakdown).toHaveTextContent(/1 × \D*2,000/);
    expect(breakdown).toHaveTextContent(/580 in coins/);
    expect(await screen.findByTestId('sale-cash-drawer-hint')).toBeInTheDocument();
  });

  it('gives no breakdown for an exact payment', async () => {
    renderModal();
    await screen.findByTestId('payment-settlement');
    expect(screen.queryByTestId('change-breakdown')).not.toBeInTheDocument();
    expect(screen.queryByTestId('sale-cash-drawer-hint')).not.toBeInTheDocument();
  });

  it('types the amount from the on-screen keys, replacing the preset first', async () => {
    const { user, onSubmit } = renderModal();
    const amount = (await screen.findByLabelText('Amount received')) as HTMLInputElement;
    expect(amount).toHaveValue(87_420);

    await user.click(screen.getByTestId('sale-payment-key-1'));
    expect(amount).toHaveValue(1);
    await user.click(screen.getByTestId('sale-payment-key-0'));
    await user.click(screen.getByTestId('sale-payment-key-0'));
    await user.click(screen.getByTestId('sale-payment-key-000'));
    expect(amount).toHaveValue(100_000);
    await user.click(screen.getByRole('button', { name: 'Delete the last digit' }));
    expect(amount).toHaveValue(10_000);
    await user.click(screen.getByTestId('sale-payment-key-0'));

    await user.click(confirm());
    expect(submitted(onSubmit)).toMatchObject({
      paymentMethod: 'cash',
      amountReceived: 100_000,
      tenders: [],
    });
  });

  it('opens on the tender chosen before the sheet', async () => {
    renderModal({ initialMethod: 'card' });
    expect(await screen.findByTestId('sale-payment-tab-card')).toHaveAttribute(
      'aria-pressed',
      'true'
    );
    expect(screen.queryByTestId('quick-denomination-selector')).not.toBeInTheDocument();
  });

  it('falls back to cash when credit was asked for without a customer', async () => {
    renderModal({ initialMethod: 'credit' });
    await waitFor(() =>
      expect(screen.getByTestId('sale-payment-tab-cash')).toHaveAttribute('aria-pressed', 'true')
    );
  });

  it('puts the cursor on the customer picker from the add-customer chip', async () => {
    const { user } = renderModal();
    await user.click(screen.getByTestId('sale-payment-add-customer'));
    expect(screen.getByLabelText('Customer')).toHaveFocus();

    await user.selectOptions(screen.getByLabelText('Customer'), 'cust-1');
    expect(screen.queryByTestId('sale-payment-add-customer')).not.toBeInTheDocument();
  });
});

describe('SalePaymentModal — transfer', () => {
  it('asks for the receipt reference before the cashier can confirm', async () => {
    const { user, onSubmit } = renderModal();
    await user.click(screen.getByRole('button', { name: 'Transfer' }));

    expect(await screen.findByTestId('sale-transfer-panel')).toHaveAttribute('data-admin', 'true');
    expect(confirm()).toHaveTextContent('It arrived · confirm sale');
    expect(confirm()).toBeDisabled();

    const reference = screen.getByLabelText('Last digits or reference of the receipt');
    expect(reference).toHaveAttribute('aria-required', 'true');
    await user.type(reference, ' M482190 ');
    expect(confirm()).toBeEnabled();

    await user.click(confirm());
    expect(submitted(onSubmit)).toMatchObject({
      paymentMethod: 'transfer',
      tenders: [{ method: 'transfer', amount: 87_420, reference: 'M482190' }],
    });
    expect(submitted(onSubmit)).not.toHaveProperty('paymentReference');
  });

  it('keeps the reference with a partial transfer, which has no tender list', async () => {
    const { user, onSubmit } = renderModal();
    await user.click(screen.getByRole('button', { name: 'Transfer' }));
    await user.type(
      await screen.findByLabelText('Last digits or reference of the receipt'),
      'M482190'
    );
    const amount = screen.getByLabelText('Amount received');
    await user.clear(amount);
    await user.type(amount, '50000');

    expect(screen.getByTestId('payment-settlement-amount')).toHaveTextContent('37,420');
    await user.click(confirm());
    expect(submitted(onSubmit)).toMatchObject({
      paymentMethod: 'transfer',
      amountReceived: 50_000,
      tenders: [],
      notes: 'Payment reference: M482190',
    });
  });

  it('charges only the total when the cashier leaves cash for another tender', async () => {
    const { user } = renderModal();
    await user.click(await screen.findByTestId('quick-amount-100000'));
    await user.click(screen.getByRole('button', { name: 'Card' }));

    expect(await screen.findByLabelText('Amount received')).toHaveValue(87_420);
    expect(screen.queryByTestId('payment-settlement')).not.toBeInTheDocument();
  });

  it('lets a card payment carry its voucher, and stay plain without one', async () => {
    const { user, onSubmit } = renderModal();
    await user.click(screen.getByRole('button', { name: 'Card' }));
    expect(confirm()).toBeEnabled();
    await user.type(await screen.findByLabelText('Voucher or reference (optional)'), '004512');
    await user.click(confirm());

    expect(submitted(onSubmit).tenders).toEqual([
      { method: 'card', amount: 87_420, reference: '004512' },
    ]);
  });
});

describe('SalePaymentModal — credit', () => {
  async function openCredit() {
    const result = renderModal();
    await result.user.selectOptions(screen.getByLabelText('Customer'), 'cust-1');
    await result.user.click(await screen.findByRole('button', { name: 'Credit' }));
    await screen.findByTestId('credit-sale-customer-card');
    return result;
  }

  it('shows who owes, what this sale adds and what they would owe', async () => {
    mocks.balance = 40_000;
    await openCredit();

    const card = within(screen.getByTestId('credit-sale-customer-card'));
    expect(card.getByText('FP')).toBeInTheDocument();
    expect(screen.getByTestId('credit-sale-current-balance')).toHaveTextContent('40,000');
    expect(screen.getByTestId('credit-sale-this-sale')).toHaveTextContent('87,420');
    expect(screen.getByTestId('credit-sale-projected')).toHaveTextContent('127,420');
    expect(screen.getByTestId('credit-sale-cupo')).toHaveTextContent('150,000');
    expect(screen.getByTestId('credit-sale-bar')).toHaveAccessibleName(/limit \D*150,000/);
    expect(screen.getByTestId('credit-sale-rule')).toBeInTheDocument();
    expect(confirm()).toHaveTextContent(/Put \D*87,420 on credit$/);
  });

  it('splits the sale into cash paid now and the rest on credit', async () => {
    mocks.balance = 40_000;
    const { user, onSubmit } = await openCredit();

    await user.type(screen.getByLabelText('Pays now in cash'), '20000');

    expect(screen.getByTestId('credit-sale-on-credit')).toHaveTextContent('67,420');
    expect(screen.getByTestId('credit-sale-projected')).toHaveTextContent('107,420');
    expect(confirm()).toHaveTextContent(/Put \D*67,420 on credit and collect \D*20,000/);

    await user.click(confirm());
    expect(submitted(onSubmit)).toMatchObject({
      paymentMethod: 'credit',
      customerId: 'cust-1',
      tenders: [
        { method: 'cash', amount: 20_000 },
        { method: 'credit', amount: 67_420 },
      ],
    });
    expect(submitted(onSubmit).creditDownPayment).toBeUndefined();
  });

  it('never carries a transfer reference into a credit sale', async () => {
    const result = renderModal();
    await result.user.click(screen.getByRole('button', { name: 'Transfer' }));
    await result.user.type(
      await screen.findByLabelText('Last digits or reference of the receipt'),
      'M482190'
    );
    await result.user.selectOptions(screen.getByLabelText('Customer'), 'cust-1');
    await result.user.click(await screen.findByRole('button', { name: 'Credit' }));
    await screen.findByTestId('credit-sale-customer-card');
    await result.user.click(confirm());

    expect(submitted(result.onSubmit)).toMatchObject({
      paymentMethod: 'credit',
      tenders: [],
      notes: '',
    });
  });

  it('refuses a down payment that covers the whole sale', async () => {
    const { user } = await openCredit();
    await user.type(screen.getByLabelText('Pays now in cash'), '87420');
    expect(confirm()).toBeDisabled();
  });

  it('treats a down payment within half a cent of the total as the whole sale', async () => {
    const { user } = await openCredit();
    await user.type(screen.getByLabelText('Pays now in cash'), '87419.996');
    expect(confirm()).toBeDisabled();
  });

  it('brings the sale back under the limit with a down payment', async () => {
    mocks.balance = 100_000;
    const { user } = await openCredit();
    expect(screen.getByTestId('credit-sale-warning')).toBeInTheDocument();

    await user.type(screen.getByLabelText('Pays now in cash'), '40000');
    expect(screen.queryByTestId('credit-sale-warning')).not.toBeInTheDocument();
  });

  it('moves to a split without keeping credit as the single method', async () => {
    const { user } = await openCredit();
    await user.click(screen.getByRole('button', { name: 'Split payment across tenders' }));

    await screen.findByTestId('split-meter');
    expect(screen.queryByTestId('credit-sale-customer-card')).not.toBeInTheDocument();
    expect(screen.getByTestId('sale-payment-method-select')).toHaveValue('cash');
  });
});

describe('SalePaymentModal — split', () => {
  it('fills what is missing on the last tender', async () => {
    const { user } = renderModal();
    await user.click(screen.getByRole('button', { name: 'Split payment across tenders' }));
    const first = (await screen.findByLabelText('Amount for tender 1')) as HTMLInputElement;
    await user.clear(first);
    await user.type(first, '50000');
    await user.click(screen.getByRole('button', { name: 'Add payment method' }));
    const second = screen.getByLabelText('Amount for tender 2') as HTMLInputElement;
    await user.clear(second);
    await user.type(second, '30000');
    expect(screen.getByTestId('split-remaining')).toHaveTextContent('7,420');

    await user.click(screen.getByTestId('split-fill-remainder'));

    expect(second).toHaveValue(37_420);
    expect(screen.getByTestId('split-remaining')).toHaveTextContent(/\D0$/);
    expect(screen.getByTestId('split-fill-remainder')).toBeDisabled();
    expect(confirm()).toBeEnabled();
  });

  it('splits half and half and submits both tenders', async () => {
    const { user, onSubmit } = renderModal({ total: 87_421 });
    await user.click(screen.getByRole('button', { name: 'Split payment across tenders' }));
    await user.click(await screen.findByTestId('split-halves'));

    expect(screen.getByLabelText('Amount for tender 1')).toHaveValue(43_710.5);
    expect(screen.getByLabelText('Amount for tender 2')).toHaveValue(43_710.5);
    expect(screen.getByLabelText('Method for tender 2')).toHaveValue('card');

    await user.click(confirm());
    expect(submitted(onSubmit).tenders.map(tender => tender.method)).toEqual(['cash', 'card']);
  });

  it('returns to a single tender from its tab', async () => {
    const { user } = renderModal();
    await user.click(screen.getByRole('button', { name: 'Split payment across tenders' }));
    await screen.findByTestId('split-meter');
    await user.click(screen.getByRole('button', { name: 'Card' }));

    expect(screen.queryByTestId('split-meter')).not.toBeInTheDocument();
    expect(screen.getByTestId('sale-payment-tab-card')).toHaveAttribute('aria-pressed', 'true');
  });
});

describe('SalePaymentModal — electronic invoice', () => {
  beforeEach(() => {
    mocks.invoiceAvailable = true;
  });

  it('ticks the NIT when its verification digit is right', async () => {
    const { user } = renderModal();
    expect(screen.getByTestId('sale-payment-document')).toHaveTextContent('POS ticket');

    await user.click(
      await screen.findByRole('checkbox', { name: 'Customer asked for an electronic invoice' })
    );
    expect(screen.getByTestId('sale-payment-document')).toHaveTextContent('electronic invoice');
    expect(confirm()).toHaveTextContent('Confirm and invoice');

    await user.selectOptions(screen.getByLabelText('ID type'), '31');
    await user.type(screen.getByLabelText('ID number'), '900373115-3');
    const dv = screen.getByTestId('sale-invoice-nit-dv');
    expect(dv).toHaveTextContent('3');
    expect(within(dv).getByText('The verification digit is correct')).toBeInTheDocument();

    await user.clear(screen.getByLabelText('ID number'));
    await user.type(screen.getByLabelText('ID number'), '900373115-9');
    expect(
      within(screen.getByTestId('sale-invoice-nit-dv')).queryByText(
        'The verification digit is correct'
      )
    ).not.toBeInTheDocument();
  });

  it('shows no verification digit for a document that has none', async () => {
    const { user } = renderModal();
    await user.click(
      await screen.findByRole('checkbox', { name: 'Customer asked for an electronic invoice' })
    );
    await user.type(screen.getByLabelText('ID number'), '1032456789');
    expect(screen.queryByTestId('sale-invoice-nit-dv')).not.toBeInTheDocument();
  });

  it('says the buyer is already saved when the attached customer has a tax id', async () => {
    const { user } = renderModal();
    await user.click(
      await screen.findByRole('checkbox', { name: 'Customer asked for an electronic invoice' })
    );
    expect(screen.queryByTestId('sale-invoice-saved-customer')).not.toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText('Customer'), 'cust-1');
    expect(await screen.findByTestId('sale-invoice-saved-customer')).toBeInTheDocument();
    expect(screen.getByLabelText('ID number')).toHaveValue('900373115-3');
  });
});
