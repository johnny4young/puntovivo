import { beforeEach, describe, expect, it, vi } from 'vitest';
import userEvent from '@testing-library/user-event';

import { render, screen, waitFor } from '@/test/utils';
import type { Customer } from '@/types';
import { SalePaymentModal, type SalePaymentValues } from './SalePaymentModal';

const state = vi.hoisted(() => ({
  blockedErrorCode: null as string | null,
  eligibleEvidence: [{ id: 'evidence-approved-1', remainingQuantity: 2 }],
}));

vi.mock('@/lib/trpc', () => ({
  trpc: {
    useUtils: () => ({ managerApprovals: { mine: { invalidate: vi.fn() } } }),
    pharmacy: {
      checkoutRequirements: {
        useQuery: (input: { customerId: string | null }) => ({
          data: {
            countryCode: 'CO',
            businessDate: '2026-09-02',
            customerValid: input.customerId ? true : null,
            canApproveEvidence: false,
            ready:
              state.blockedErrorCode === null &&
              Boolean(input.customerId) &&
              state.eligibleEvidence.length > 0,
            requirements: [
              {
                productId: 'medicine-1',
                productName: 'Acetaminophen 500 mg',
                classification: 'prescription',
                requestedQuantity: 2,
                policyVersion: 'co-pharmacy-v1',
                evidenceRequired: true,
                professionalApprovalRequired: true,
                blockedErrorCode: state.blockedErrorCode,
                eligibleEvidence: input.customerId ? state.eligibleEvidence : [],
              },
            ],
          },
          isLoading: false,
          isFetching: false,
          isError: false,
          error: null,
          refetch: vi.fn(),
        }),
      },
    },
    sales: {
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
    customerLedger: {
      getBalance: {
        useQuery: () => ({ data: { balance: 0 }, isLoading: false, isError: false, error: null }),
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

vi.mock('@/lib/useCriticalMutation', () => ({
  useCriticalMutation: () => ({
    mutate: vi.fn(),
    isPending: false,
    error: null,
    reset: vi.fn(),
  }),
}));

vi.mock('@/components/feedback/ToastProvider', () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() }),
}));

const customer: Customer = {
  id: 'customer-1',
  tenantId: 'tenant-1',
  name: 'Ana Cliente',
  isActive: true,
  version: 1,
  creditLimit: 0,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

function renderPharmacyPayment(onSubmit = vi.fn(async (_values: SalePaymentValues) => undefined)) {
  render(
    <SalePaymentModal
      isOpen
      total={100}
      customers={[customer]}
      isSaving={false}
      error={null}
      userRole="cashier"
      promotionPricingEnabled={false}
      approvalItems={[
        {
          productId: 'medicine-1',
          unitId: 'unit-1',
          unitEquivalence: 1,
          quantity: 2,
          unitPrice: 50,
          discount: 0,
        },
      ]}
      onClose={vi.fn()}
      onSubmit={onSubmit}
    />
  );
  return onSubmit;
}

describe('SalePaymentModal pharmacy policy', () => {
  beforeEach(() => {
    state.blockedErrorCode = null;
    state.eligibleEvidence = [{ id: 'evidence-approved-1', remainingQuantity: 2 }];
  });

  it('requires an identified customer and exact evidence selection before checkout', async () => {
    const user = userEvent.setup();
    const onSubmit = renderPharmacyPayment();
    const confirm = screen.getByRole('button', { name: 'Confirm Sale' });

    expect(
      await screen.findByText('Select an active customer before using prescription evidence.')
    ).toBeVisible();
    expect(confirm).toBeDisabled();

    await user.selectOptions(screen.getByLabelText('Customer'), customer.id);
    const evidence = await screen.findByRole('checkbox', {
      name: /Select evidence.*Acetaminophen 500 mg/,
    });
    expect(evidence).not.toBeChecked();
    expect(confirm).toBeDisabled();

    await user.click(evidence);
    await waitFor(() => expect(confirm).toBeEnabled());
    await user.click(confirm);

    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ pharmacyEvidenceIds: ['evidence-approved-1'] })
    );
  });

  it('clears evidence selected for a previous customer', async () => {
    const user = userEvent.setup();
    renderPharmacyPayment();
    await user.selectOptions(screen.getByLabelText('Customer'), customer.id);
    const evidence = await screen.findByRole('checkbox', {
      name: /Select evidence.*Acetaminophen 500 mg/,
    });
    await user.click(evidence);
    expect(evidence).toBeChecked();

    await user.selectOptions(screen.getByLabelText('Customer'), '');
    await waitFor(() =>
      expect(
        screen.queryByRole('checkbox', {
          name: /Select evidence.*Acetaminophen 500 mg/,
        })
      ).not.toBeInTheDocument()
    );
    await user.selectOptions(screen.getByLabelText('Customer'), customer.id);
    const refreshedEvidence = await screen.findByRole('checkbox', {
      name: /Select evidence.*Acetaminophen 500 mg/,
    });
    expect(refreshedEvidence).not.toBeChecked();
  });

  it('keeps a policy-blocked controlled medicine impossible to charge', async () => {
    state.blockedErrorCode = 'PHARMACY_CONTROLLED_NOT_ENABLED';
    state.eligibleEvidence = [];
    renderPharmacyPayment();

    expect(await screen.findByText(/Controlled medicines are disabled/)).toBeVisible();
    expect(screen.getByRole('button', { name: 'Confirm Sale' })).toBeDisabled();
  });
});
