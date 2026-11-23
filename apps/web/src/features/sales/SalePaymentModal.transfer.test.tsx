import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import i18next from 'i18next';
import { render } from '@/test/utils';
import { SalePaymentModal, type SalePaymentValues } from './SalePaymentModal';
import { useCheckoutTransferDisplay } from './checkoutTransferDisplay';

const forChargeMock = vi.hoisted(() => vi.fn());
const moduleActiveMock = vi.hoisted(() => vi.fn(() => false));
const roleMock = vi.hoisted(() => vi.fn(() => 'cashier'));
const startWalletMock = vi.hoisted(() => vi.fn());
const cancelWalletMock = vi.hoisted(() => vi.fn());
const startPresentationMock = vi.hoisted(() => vi.fn());
const presentationStatusMock = vi.hoisted(() => vi.fn(() => 'presented'));
const walletStatusMock = vi.hoisted(() => vi.fn());
const toastWarningMock = vi.hoisted(() => vi.fn());

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
    payments: {
      startWalletCharge: { useMutation: () => ({ mutateAsync: startWalletMock }) },
      cancelWalletCharge: { useMutation: () => ({ mutate: cancelWalletMock }) },
      walletChargeStatus: { useQuery: walletStatusMock },
      startPresentation: { useMutation: () => ({ mutateAsync: startPresentationMock }) },
      // Fase 5.2: el display sigue el ciclo de vida de la presentación.
      presentation: {
        useQuery: () => ({
          data: { id: 'pres-1', status: presentationStatusMock() },
          isLoading: false,
        }),
      },
    },
  },
}));

vi.mock('@/lib/useCriticalMutation', () => ({
  useCriticalMutation: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock('@/components/feedback/ToastProvider', () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: toastWarningMock }),
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

function mockDestinations(list: typeof destinations, autoConfirm = false) {
  forChargeMock.mockReturnValue({
    data: { currency: 'COP', destinations: list, autoConfirm },
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  });
}

function transferModal(onSubmit: (values: SalePaymentValues) => Promise<void>, total = 100) {
  return (
    <SalePaymentModal
      isOpen
      total={total}
      customers={[]}
      isSaving={false}
      error={null}
      promotionPricingEnabled={false}
      initialMethod="transfer"
      onClose={vi.fn()}
      onSubmit={onSubmit}
    />
  );
}

function renderTransfer(
  onSubmit = vi.fn<(values: SalePaymentValues) => Promise<void>>(async () => undefined)
) {
  render(transferModal(onSubmit));
  return onSubmit;
}

const liveCharge = {
  mode: 'live',
  chargeId: 'charge-1',
  railLabel: 'Nequi',
  status: 'pending',
  reference: 'nequi_tx_9001',
  qrPayload: 'NEQUI-QR-9001',
} as const;

function mockWallet(start: object, status?: 'pending' | 'approved' | 'declined') {
  mockDestinations(destinations, true);
  startWalletMock.mockResolvedValue(start);
  walletStatusMock.mockReturnValue({
    data: status ? { chargeId: 'charge-1', status, reference: 'nequi_tx_9001' } : undefined,
  });
}

beforeAll(async () => {
  await i18next.changeLanguage('en');
});

beforeEach(() => {
  window.sessionStorage.clear();
  startWalletMock.mockReset();
  cancelWalletMock.mockReset();
  startPresentationMock.mockReset();
  presentationStatusMock.mockReturnValue('presented');
  startPresentationMock.mockResolvedValue({ id: 'pres-1' });
  toastWarningMock.mockReset();
  mockWallet({ mode: 'manual', providerUnavailable: false });
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
    await waitFor(() => expect(startPresentationMock).toHaveBeenCalledTimes(1));
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
    expect(values.tenders).toEqual([
      { method: 'transfer', amount: 100, reference: '482190', presentationId: 'pres-1' },
    ]);
    expect(values).not.toHaveProperty('transferReference');
  });

  it('stops showing the QR on the customer display once the presentation is no longer live', async () => {
    moduleActiveMock.mockReturnValue(true);
    mockDestinations(destinations);
    presentationStatusMock.mockReturnValue('timeout');
    renderTransfer();

    // An expired presentation must not sit on the customer screen inviting a
    // payment the till already considers gone.
    await waitFor(() => expect(useCheckoutTransferDisplay.getState().transfer).toBeNull());
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

  it('holds back a QR that spells out an old amount while the new total loads', async () => {
    const user = userEvent.setup();
    moduleActiveMock.mockReturnValue(true);
    forChargeMock.mockReturnValue({
      data: { currency: 'COP', destinations },
      isLoading: false,
      isError: false,
      isPlaceholderData: true,
      refetch: vi.fn(),
    });
    renderTransfer();

    expect(await screen.findByTestId('sale-payment-transfer-qr')).not.toHaveAttribute('data-ready');
    expect(useCheckoutTransferDisplay.getState().transfer).toBeNull();

    await user.click(screen.getByTestId('sale-payment-transfer-destination-d-nequi'));
    await waitFor(() =>
      expect(screen.getByTestId('sale-payment-transfer-qr')).toHaveAttribute('data-ready', 'true')
    );
    expect(useCheckoutTransferDisplay.getState().transfer?.qrPayload).toBe('000201nequi');
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

  it('keeps manual confirmation without asking when no payment provider is live', async () => {
    mockDestinations(destinations);
    renderTransfer();

    const note = await screen.findByTestId('sale-payment-wallet-status');
    expect(startWalletMock).not.toHaveBeenCalled();
    expect(note).toHaveAttribute('data-state', 'manual');
    expect(note).toHaveTextContent('You confirm the money arrived');
    expect(walletStatusMock).toHaveBeenCalledWith(
      { chargeId: '' },
      expect.objectContaining({ enabled: false })
    );
  });

  it('waits for a live provider with its own QR, mirrored to the customer display', async () => {
    moduleActiveMock.mockReturnValue(true);
    mockWallet(liveCharge, 'pending');
    const onSubmit = renderTransfer();

    expect(await screen.findByText('Show the Nequi QR')).toBeInTheDocument();
    expect(startWalletMock).toHaveBeenCalledWith({ siteId: 'site-1', amount: 100 });
    const note = screen.getByTestId('sale-payment-wallet-status');
    expect(note).toHaveAttribute('data-state', 'pending');
    expect(note).toHaveTextContent('Waiting for Nequi to confirm.');
    expect(
      screen.queryByTestId('sale-payment-transfer-destination-d-breb')
    ).not.toBeInTheDocument();
    expect(walletStatusMock).toHaveBeenCalledWith(
      { chargeId: 'charge-1' },
      expect.objectContaining({ enabled: true })
    );
    await waitFor(() =>
      expect(useCheckoutTransferDisplay.getState().transfer).toEqual({
        label: 'Nequi',
        account: '',
        qrPayload: 'NEQUI-QR-9001',
        amount: 100,
      })
    );
    expect(screen.getByRole('button', { name: /It arrived · confirm sale/ })).toBeDisabled();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('confirms the sale by itself with the provider reference once approved', async () => {
    mockWallet(liveCharge, 'approved');
    const onSubmit = renderTransfer();

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0]![0].tenders).toEqual([
      { method: 'transfer', amount: 100, reference: 'nequi_tx_9001' },
    ]);
    expect(screen.getByTestId('sale-payment-wallet-status')).toHaveAttribute(
      'data-state',
      'approved'
    );
    expect(screen.getByTestId('sale-payment-wallet-status')).toHaveTextContent(
      /^Nequi confirmed the payment\.$/
    );
    expect(screen.getByTestId('sale-payment-transfer-reference')).toHaveValue('nequi_tx_9001');
  });

  it('says when the provider declines or does not answer, and keeps manual confirm', async () => {
    mockWallet(liveCharge, 'declined');
    const onSubmit = renderTransfer();

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Nequi declined the payment. Ask for another payment method.'
    );
    expect(screen.getByTestId('sale-payment-transfer-qr')).toBeInTheDocument();
    expect(screen.getByText('Show the store QR')).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('tells the cashier when the provider did not answer', async () => {
    mockWallet({ mode: 'manual', providerUnavailable: true });
    renderTransfer();

    await waitFor(() =>
      expect(screen.getByTestId('sale-payment-wallet-status')).toHaveAttribute(
        'data-state',
        'unavailable'
      )
    );
    expect(screen.getByTestId('sale-payment-wallet-status')).toHaveTextContent(
      'The payment provider did not answer.'
    );
  });

  it('cancels the open charge when the cashier switches method', async () => {
    const user = userEvent.setup();
    mockWallet(liveCharge, 'pending');
    renderTransfer();

    await screen.findByText('Show the Nequi QR');
    await user.click(screen.getByTestId('sale-payment-tender-cash'));
    await waitFor(() =>
      expect(cancelWalletMock).toHaveBeenCalledWith({ chargeId: 'charge-1' }, expect.anything())
    );
  });

  it('never shows the store QR beside an open provider charge without its own QR', async () => {
    moduleActiveMock.mockReturnValue(true);
    mockWallet({ ...liveCharge, qrPayload: null }, 'pending');
    renderTransfer();

    expect(await screen.findByTestId('sale-payment-wallet-status')).toHaveAttribute(
      'data-state',
      'pending'
    );
    expect(screen.queryByTestId('sale-payment-transfer-qr')).not.toBeInTheDocument();
    expect(screen.queryByText('Show the store QR')).not.toBeInTheDocument();
    expect(useCheckoutTransferDisplay.getState().transfer).toBeNull();
  });

  it('warns the cashier when a charge being left had already been paid', async () => {
    const user = userEvent.setup();
    mockWallet(liveCharge, 'pending');
    cancelWalletMock.mockImplementation(
      (_input: unknown, options?: { onSuccess?: (left: { status: string }) => void }) =>
        options?.onSuccess?.({ status: 'approved' })
    );
    renderTransfer();

    await screen.findByText('Show the Nequi QR');
    await user.click(screen.getByTestId('sale-payment-tender-cash'));
    await waitFor(() =>
      expect(toastWarningMock).toHaveBeenCalledWith({
        title: 'Nequi had already confirmed that charge. Check before charging again.',
      })
    );
  });

  it('records exactly one presentation for the static QR on screen', async () => {
    mockDestinations(destinations);
    renderTransfer();

    expect(await screen.findByTestId('sale-payment-transfer-qr')).toBeInTheDocument();
    await waitFor(() => expect(startPresentationMock).toHaveBeenCalledTimes(1));
    expect(startPresentationMock).toHaveBeenCalledWith({
      siteId: 'site-1',
      destinationId: 'd-breb',
      amount: 100,
      idempotencyKey: expect.any(String),
    });
  });

  it('reuses the same presentation across a re-render and a modal reopen', async () => {
    mockDestinations(destinations);
    const onSubmit = vi.fn<(values: SalePaymentValues) => Promise<void>>(async () => undefined);
    const view = render(transferModal(onSubmit));
    await waitFor(() => expect(startPresentationMock).toHaveBeenCalledTimes(1));
    const firstKey = startPresentationMock.mock.calls[0]![0].idempotencyKey as string;

    view.rerender(transferModal(onSubmit));
    await waitFor(() => expect(startPresentationMock).toHaveBeenCalledTimes(1));

    view.unmount();
    render(transferModal(onSubmit));
    await waitFor(() => expect(startPresentationMock).toHaveBeenCalledTimes(2));

    const keys = startPresentationMock.mock.calls.map(call => call[0].idempotencyKey);
    expect(keys).toEqual([firstKey, firstKey]);
    expect(startPresentationMock.mock.calls[1]![0]).toMatchObject({ amount: 100 });
  });

  it('creates a different presentation when the total changes', async () => {
    mockDestinations(destinations);
    const onSubmit = vi.fn<(values: SalePaymentValues) => Promise<void>>(async () => undefined);
    const view = render(transferModal(onSubmit, 100));
    await waitFor(() => expect(startPresentationMock).toHaveBeenCalledTimes(1));
    const firstKey = startPresentationMock.mock.calls[0]![0].idempotencyKey as string;

    view.rerender(transferModal(onSubmit, 120));
    await waitFor(() => expect(startPresentationMock).toHaveBeenCalledTimes(2), { timeout: 3000 });

    const second = startPresentationMock.mock.calls[1]![0];
    expect(second.amount).toBe(120);
    expect(second.idempotencyKey).not.toBe(firstKey);
  });

  it('keeps the QR and the sale when the presentation cannot be created', async () => {
    const user = userEvent.setup();
    mockDestinations(destinations);
    startPresentationMock.mockRejectedValue(new Error('offline'));
    const onSubmit = renderTransfer();

    await waitFor(() => expect(startPresentationMock).toHaveBeenCalled());
    expect(screen.getByTestId('sale-payment-transfer-qr')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();

    const confirm = await screen.findByRole('button', { name: /It arrived · confirm sale/ });
    await user.type(screen.getByTestId('sale-payment-transfer-reference'), '482190');
    await waitFor(() => expect(confirm).toBeEnabled());
    await user.click(confirm);

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0]![0].tenders).toEqual([
      { method: 'transfer', amount: 100, reference: '482190' },
    ]);
  });

  it('hands the presentation id to the transfer tender', async () => {
    const user = userEvent.setup();
    mockDestinations(destinations);
    const onSubmit = renderTransfer();

    await waitFor(() => expect(startPresentationMock).toHaveBeenCalledTimes(1));
    const confirm = await screen.findByRole('button', { name: /It arrived · confirm sale/ });
    await user.type(screen.getByTestId('sale-payment-transfer-reference'), '482190');
    await waitFor(() => expect(confirm).toBeEnabled());
    await user.click(confirm);

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0]![0].tenders).toEqual([
      { method: 'transfer', amount: 100, reference: '482190', presentationId: 'pres-1' },
    ]);
  });

  it('drops the approved reference when a new total opens a new charge', async () => {
    mockWallet(liveCharge, 'approved');
    const onSubmit = vi.fn<(values: SalePaymentValues) => Promise<void>>(async () => undefined);
    const view = render(transferModal(onSubmit));
    await waitFor(() =>
      expect(screen.getByTestId('sale-payment-transfer-reference')).toHaveValue('nequi_tx_9001')
    );

    walletStatusMock.mockReturnValue({ data: undefined });
    startWalletMock.mockReturnValue(new Promise(() => {}));
    view.rerender(transferModal(onSubmit, 120));
    await waitFor(() =>
      expect(screen.getByTestId('sale-payment-transfer-reference')).toHaveValue('')
    );
  });
});
