import { beforeEach, describe, expect, it, vi } from 'vitest';
import userEvent from '@testing-library/user-event';

import i18n from '@/i18n';
import { render, screen, waitFor } from '@/test/utils';
import type { Customer } from '@/types';
import { SalePaymentModal, type SalePaymentValues } from './SalePaymentModal';

const state = vi.hoisted(() => ({
  quote: {
    data: undefined as
      | undefined
      | {
          fingerprint: string;
          subtotal: number;
          taxAmount: number;
          total: number;
          promotionDiscountAmount: number;
          lines: Array<{
            lineKey: string;
            productId: string;
            manualDiscountRate: number;
            effectiveDiscountRate: number;
            lineBase: number;
            lineTax: number;
            lineTotal: number;
            taxComponents: [];
            promotionDiscountAmount: number;
            promotions: Array<{
              promotionId: string;
              promotionVersion: number;
              name: string;
              discountPct: number;
              discountAmount: number;
              priority: number;
              combinable: boolean;
              position: number;
              source: 'manual';
              sourceLotId: null;
            }>;
          }>;
        },
    isLoading: false,
    isFetching: false,
    isError: false,
  },
  customerValue: {
    points: 20,
    movements: [],
    redemption: { enabled: true, valuePerPoint: 10 },
    storeCredit: { balance: 40, currencyCode: 'USD', movements: [] },
  },
}));
const quoteRefetch = vi.hoisted(() => vi.fn());
const customerValueRefetch = vi.hoisted(() => vi.fn());
const quoteInputSpy = vi.hoisted(() => vi.fn());

vi.mock('@/lib/trpc', () => ({
  trpc: {
    useUtils: () => ({
      managerApprovals: { mine: { invalidate: vi.fn() } },
    }),
    sales: {
      quotePromotions: {
        useQuery: (input: unknown) => {
          quoteInputSpy(input);
          return {
            ...state.quote,
            error: state.quote.isError ? new Error('offline') : null,
            refetch: quoteRefetch,
          };
        },
      },
    },
    pharmacy: {
      checkoutRequirements: {
        useQuery: () => ({
          data: { countryCode: 'CO', businessDate: '2026-09-02', customerValid: null, requirements: [], ready: true },
          isLoading: false,
          isFetching: false,
          isError: false,
          error: null,
          refetch: vi.fn(),
        }),
      },
    },
    loyalty: {
      forCustomer: {
        useQuery: () => ({
          data: state.customerValue,
          isLoading: false,
          isFetching: false,
          isError: false,
          error: null,
          refetch: customerValueRefetch,
        }),
      },
    },
    customerLedger: {
      getBalance: {
        useQuery: () => ({
          data: { balance: 0 },
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
    managerApprovals: {
      mine: {
        useQuery: () => ({
          data: [],
          isLoading: false,
          error: null,
          refetch: vi.fn(),
        }),
      },
    },
  },
}));

vi.mock('@/lib/useCriticalMutation', () => ({
  useCriticalMutation: () => ({ mutate: vi.fn(), isPending: false }),
}));

vi.mock('@/components/feedback/ToastProvider', () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() }),
}));

const customer: Customer = {
  id: 'customer-1',
  tenantId: 'tenant-1',
  name: 'Ana Customer',
  isActive: true,
  version: 1,
  creditLimit: 0,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

function renderModal(
  onSubmit: (values: SalePaymentValues) => Promise<void>,
  overrides: Partial<React.ComponentProps<typeof SalePaymentModal>> = {}
) {
  return render(
    <SalePaymentModal
      isOpen
      total={100}
      customers={[customer]}
      isSaving={false}
      error={null}
      approvalItems={[
        { productId: 'product-1', unitId: 'unit-1', quantity: 1, unitPrice: 100, discount: 0 },
      ]}
      promotionPricingEnabled
      currencyCode="USD"
      onClose={vi.fn()}
      onSubmit={onSubmit}
      {...overrides}
    />
  );
}

describe('SalePaymentModal promotions and customer value', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en');
    vi.clearAllMocks();
    let uuidCounter = 0;
    vi.mocked(crypto.randomUUID).mockImplementation(() => {
      uuidCounter += 1;
      return `00000000-0000-4000-8000-${String(uuidCounter).padStart(12, '0')}`;
    });
    state.quote = { data: undefined, isLoading: false, isFetching: false, isError: false };
    state.customerValue = {
      points: 20,
      movements: [],
      redemption: { enabled: true, valuePerPoint: 10 },
      storeCredit: { balance: 40, currencyCode: 'USD', movements: [] },
    };
  });

  it('shows and submits the exact authoritative promotion quote', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn(async () => undefined);
    state.quote.data = {
      fingerprint: 'a'.repeat(64),
      subtotal: 80,
      taxAmount: 0,
      total: 80,
      promotionDiscountAmount: 20,
      lines: [
        {
          lineKey: 'fresh:0',
          productId: 'product-1',
          manualDiscountRate: 0,
          effectiveDiscountRate: 20,
          lineBase: 80,
          lineTax: 0,
          lineTotal: 80,
          taxComponents: [],
          promotionDiscountAmount: 20,
          promotions: [
            {
              promotionId: 'promotion-1',
              promotionVersion: 1,
              name: 'Morning offer',
              discountPct: 20,
              discountAmount: 20,
              priority: 1,
              combinable: false,
              position: 0,
              source: 'manual',
              sourceLotId: null,
            },
          ],
        },
      ],
    };
    renderModal(onSubmit);

    expect(await screen.findByTestId('promotion-summary')).toHaveTextContent('Morning offer');
    expect(screen.getByTestId('promotion-summary')).toHaveTextContent('$20.00');
    await waitFor(() => expect(screen.getByRole('button', { name: 'Confirm Sale' })).toBeEnabled());
    await user.click(screen.getByRole('button', { name: 'Confirm Sale' }));

    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({
          promotionFingerprint: 'a'.repeat(64),
          promotionTotal: 80,
          amountReceived: 80,
        })
      )
    );
  });

  it('quotes the same serial identities and tax selections that completion will submit', async () => {
    renderModal(vi.fn(async () => undefined), {
      approvalItems: [
        {
          productId: 'serialized-product',
          unitId: 'unit-1',
          quantity: 1,
          unitPrice: 100,
          discount: 0,
          serialIds: ['serial-1'],
          taxRate: 19,
          taxComponents: [{ vatRateId: 'vat-19' }],
        },
      ],
    });

    await waitFor(() =>
      expect(quoteInputSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          items: [
            expect.objectContaining({
              productId: 'serialized-product',
              serialIds: ['serial-1'],
              taxRate: 19,
              taxComponents: [{ vatRateId: 'vat-19' }],
            }),
          ],
        })
      )
    );
  });

  it('blocks checkout and offers a retry when promotion verification fails', async () => {
    const user = userEvent.setup();
    state.quote.isError = true;
    renderModal(vi.fn(async () => undefined));

    expect(screen.getByRole('button', { name: 'Confirm Sale' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Check promotions again' }));
    expect(quoteRefetch).toHaveBeenCalledTimes(1);
  });

  it('redeems a full sale with a whole-points tender', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn(async () => undefined);
    renderModal(onSubmit, { promotionPricingEnabled: false });

    await user.selectOptions(screen.getByLabelText('Customer'), customer.id);
    await user.click(screen.getByRole('button', { name: 'Split payment across tenders' }));
    await user.selectOptions(await screen.findByLabelText('Method for tender 1'), 'loyalty');

    expect(screen.getByLabelText('Points for tender 1')).toHaveValue(10);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Confirm Sale' })).toBeEnabled());
    await user.click(screen.getByRole('button', { name: 'Confirm Sale' }));
    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({
          customerId: customer.id,
          tenders: [expect.objectContaining({ method: 'loyalty', amount: 100, loyaltyPoints: 10 })],
        })
      )
    );
  });

  it('combines store credit with an external tender without exceeding its balance', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn(async () => undefined);
    renderModal(onSubmit, { promotionPricingEnabled: false });

    await user.selectOptions(screen.getByLabelText('Customer'), customer.id);
    await user.click(screen.getByRole('button', { name: 'Split payment across tenders' }));
    await user.selectOptions(await screen.findByLabelText('Method for tender 1'), 'store_credit');
    expect(screen.getByLabelText('Amount for tender 1')).toHaveValue(40);
    await user.click(screen.getByRole('button', { name: 'Add payment method' }));
    expect(screen.getByLabelText('Amount for tender 2')).toHaveValue(60);
    await user.click(screen.getByRole('button', { name: 'Confirm Sale' }));

    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({
          tenders: [
            expect.objectContaining({ method: 'store_credit', amount: 40 }),
            expect.objectContaining({ method: 'card', amount: 60 }),
          ],
        })
      )
    );
  });
});
