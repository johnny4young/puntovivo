import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import i18next from 'i18next';
import { render } from '@/test/utils';
import { SalePaymentModal, type SalePaymentValues } from './SalePaymentModal';
import { useCheckoutTransferDisplay } from './checkoutTransferDisplay';

const forChargeMock = vi.hoisted(() => vi.fn());
const moduleActiveMock = vi.hoisted(() => vi.fn(() => false));
const roleMock = vi.hoisted(() => vi.fn(() => 'cashier'));

const idle = { data: undefined, isLoading: false, isFetching: false, isError: false, error: null };

vi.mock('@/lib/trpc', () => ({
  trpc: {
    useUtils: () => ({ managerApprovals: { mine: { invalidate: vi.fn() } } }),
    customerLedger: {
      getBalance: { useQuery: () => ({ data: { balance: 0 }, isLoading: false }) },
    },
    lossPrevention: {
      evaluateCheckout: {
        useQuery: () => ({ ...idle, data: { requiredActions: [] }, refetch: vi.fn() }),
      },
    },
    sales: {
      electronicInvoiceAvailability: { useQuery: () => ({ data: { available: false } }) },
      quotePromotions: { useQuery: () => ({ ...idle, refetch: vi.fn() }) },
    },
    pharmacy: {
      checkoutRequirements: {
        useQuery: () => ({ ...idle, data: { requirements: [] }, refetch: vi.fn() }),
      },
    },
    managerApprovals: { mine: { useQuery: () => ({ data: [], isLoading: false, error: null }) } },
    loyalty: { forCustomer: { useQuery: () => ({ data: { points: 0 }, isLoading: false }) } },
    transferDestinations: { forCharge: { useQuery: forChargeMock } },
  },
}));

vi.mock('@/lib/useCriticalMutation', () => ({
  useCriticalMutation: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock('@/components/feedback/ToastProvider', () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() }),
}));
vi.mock('@/features/tenant/TenantProvider', () => ({
  useTenant: () => ({ currentSite: { id: 'site-1' } }),
}));
vi.mock('@/features/modules', () => ({ useIsModuleActive: moduleActiveMock }));
vi.mock('@/features/auth/AuthProvider', () => ({
  useAuth: () => ({ user: { role: roleMock() } }),
}));
vi.mock('qrcode', () => ({
  create: () => ({ modules: { size: 2, data: new Uint8Array([1, 0, 0, 1]) } }),
}));

const destinations = [
  {
    id: 'd-breb',
    kind: 'bre_b',
    label: 'Bre-B',
    account: '@tienda',
    holderName: null,
    qr: { format: 'text', payload: 'Bre-B\n@tienda\nCOP 100', amountIncluded: true },
  },
  {
    id: 'd-nequi',
    kind: 'nequi',
    label: 'Nequi',
    account: '310 555 0142',
    holderName: null,
    qr: { format: 'emvco', payload: '000201nequi', amountIncluded: false },
  },
];

function mockDestinations(list: typeof destinations) {
  forChargeMock.mockReturnValue({
    data: { currency: 'COP', destinations: list },
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  });
}

function renderTransfer(
  onSubmit = vi.fn<(values: SalePaymentValues) => Promise<void>>(async () => undefined)
) {
  render(
    <SalePaymentModal
      isOpen
      total={100}
      customers={[]}
      isSaving={false}
      error={null}
      promotionPricingEnabled={false}
      initialMethod="transfer"
      onClose={vi.fn()}
      onSubmit={onSubmit}
    />
  );
  return onSubmit;
}

beforeAll(async () => {
  await i18next.changeLanguage('en');
});

afterEach(() => {
  act(() => useCheckoutTransferDisplay.getState().setTransfer(null));
  moduleActiveMock.mockReturnValue(false);
  roleMock.mockReturnValue('cashier');
});

describe('SalePaymentModal — transfer', () => {
  it('shows the store QR instead of the received amount for the whole total', async () => {
    mockDestinations(destinations);
    renderTransfer();

    expect(await screen.findByTestId('sale-payment-transfer')).toBeInTheDocument();
    expect(screen.queryByLabelText('Amount received')).not.toBeInTheDocument();
    expect(screen.getByText('Show the store QR')).toBeInTheDocument();
    expect(forChargeMock).toHaveBeenCalledWith(
      { siteId: 'site-1', amount: 100, locale: 'en' },
      expect.objectContaining({ enabled: true })
    );
    await waitFor(() =>
      expect(screen.getByTestId('sale-payment-transfer-qr')).toHaveAttribute('data-ready', 'true')
    );
    expect(screen.getByRole('img', { name: 'QR to transfer to Bre-B' })).toBeInTheDocument();
    expect(screen.getByTestId('sale-payment-transfer-destination-d-breb')).toHaveAttribute(
      'aria-pressed',
      'true'
    );
    expect(screen.queryByText('It also shows on the customer display.')).not.toBeInTheDocument();
    expect(useCheckoutTransferDisplay.getState().transfer).toBeNull();
  });

  it('requires the voucher reference and submits it as a single transfer tender', async () => {
    const user = userEvent.setup();
    mockDestinations(destinations);
    const onSubmit = renderTransfer();
    const confirm = await screen.findByRole('button', { name: /It arrived · confirm sale/ });

    expect(confirm).toBeDisabled();
    await user.type(screen.getByTestId('sale-payment-transfer-reference'), '482');
    expect(confirm).toBeDisabled();
    expect(screen.queryByTestId('sale-payment-transfer-reference-ok')).not.toBeInTheDocument();
    await user.type(screen.getByTestId('sale-payment-transfer-reference'), '190');
    expect(screen.getByTestId('sale-payment-transfer-reference-ok')).toBeInTheDocument();
    await waitFor(() => expect(confirm).toBeEnabled());

    await user.click(confirm);
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    const values = onSubmit.mock.calls[0]![0];
    expect(values.paymentMethod).toBe('transfer');
    expect(values.amountReceived).toBe(100);
    expect(values.tenders).toEqual([{ method: 'transfer', amount: 100, reference: '482190' }]);
    expect(values).not.toHaveProperty('transferReference');
  });

  it('mirrors the picked destination to the customer display and says so', async () => {
    const user = userEvent.setup();
    moduleActiveMock.mockReturnValue(true);
    mockDestinations(destinations);
    renderTransfer();

    expect(
      await screen.findByText('It also shows on the customer display.', { exact: false })
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(useCheckoutTransferDisplay.getState().transfer).toEqual({
        label: 'Bre-B',
        account: '@tienda',
        qrPayload: 'Bre-B\n@tienda\nCOP 100',
        amount: 100,
      })
    );

    await user.click(screen.getByTestId('sale-payment-transfer-destination-d-nequi'));
    expect(screen.getByText(/The customer types the amount in their app\./)).toBeInTheDocument();
    await waitFor(() =>
      expect(useCheckoutTransferDisplay.getState().transfer?.qrPayload).toBe('000201nequi')
    );

    await user.click(screen.getByTestId('sale-payment-tender-cash'));
    await waitFor(() => expect(useCheckoutTransferDisplay.getState().transfer).toBeNull());
  });

  it('points administrators to the setup when the site has no destinations', async () => {
    roleMock.mockReturnValue('admin');
    mockDestinations([]);
    renderTransfer();

    expect(await screen.findByTestId('sale-payment-transfer-empty')).toHaveTextContent(
      'This site has no accounts to receive transfers.'
    );
    expect(screen.getByRole('link', { name: 'Set up' })).toHaveAttribute(
      'href',
      '/company?tab=payments'
    );
    expect(screen.getByTestId('sale-payment-transfer-reference')).toBeInTheDocument();
  });
});
