import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import i18next from 'i18next';
import { render } from '@/test/utils';

const mocks = vi.hoisted(() => ({
  refundPolicy: {
    data: undefined as { requiresApproval: boolean } | undefined,
    isFetching: true,
    error: null as Error | null,
    refetch: vi.fn(),
  },
  voidPolicy: {
    data: { requiresApproval: false } as { requiresApproval: boolean } | undefined,
    isFetching: false,
    error: null as Error | null,
    refetch: vi.fn(),
  },
  approval: {
    views: [] as Array<{
      action: 'sale_refund';
      requestId: string | null;
      status: 'not_requested' | 'approved';
      decisionReason: string | null;
    }>,
    approvalRequestId: null as string | null,
    allApproved: false,
    isLoading: false,
    error: null as Error | null,
    isRequesting: false,
    requestApproval: vi.fn(),
    refetch: vi.fn(),
  },
}));

vi.mock('@/features/auth/AuthProvider', () => ({
  useAuth: () => ({ user: { id: 'manager-1', role: 'manager' } }),
}));

vi.mock('@/features/tenant/TenantProvider', () => ({
  useTenant: () => ({ currentSite: { id: 'site-1', name: 'Central' } }),
}));

vi.mock('@/features/approvals/useManagerApproval', () => ({
  useManagerApproval: () => mocks.approval,
}));

vi.mock('@/components/feedback/ToastProvider', () => ({
  useToast: () => ({ success: vi.fn(), warning: vi.fn(), error: vi.fn() }),
}));

vi.mock('@/lib/useCriticalMutation', () => ({
  useCriticalMutation: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

vi.mock('@/lib/trpc', () => ({
  trpc: {
    useUtils: () => ({
      peripherals: { buildReceiptBytes: { fetch: vi.fn() } },
      sales: { getById: { invalidate: vi.fn() } },
    }),
    peripherals: {
      printReceipt: { useMutation: () => ({ mutateAsync: vi.fn() }) },
    },
    sales: {
      getById: {
        useQuery: () => ({
          data: {
            id: 'sale-1',
            saleNumber: 'VTA-0001',
            status: 'completed',
            paymentStatus: 'paid',
            total: 125,
            currencyCode: 'COP',
            items: [],
            fiscalDocuments: [],
          },
          isLoading: false,
          error: null,
        }),
      },
    },
    lossPrevention: {
      evaluateShiftAction: {
        useQuery: ({ action }: { action: 'sale_refund' | 'sale_void' }) =>
          action === 'sale_refund' ? mocks.refundPolicy : mocks.voidPolicy,
      },
    },
  },
}));

vi.mock('@/features/sales/SaleDetailsContent', () => ({
  SaleDetailsContent: () => <div>Sale details</div>,
}));

vi.mock('@/features/sales/SaleDetailsFiscalBlock', () => ({
  SaleDetailsFiscalBlock: () => null,
}));

vi.mock('@/features/sales/SaleReprintModal', () => ({
  SaleReprintModal: () => null,
}));

vi.mock('@/components/form-controls/Modal', () => ({
  Modal: ({
    isOpen,
    title,
    children,
    footer,
  }: {
    isOpen: boolean;
    title?: string;
    children: ReactNode;
    footer?: ReactNode;
  }) =>
    isOpen ? (
      <section aria-label={title}>
        {children}
        {footer}
      </section>
    ) : null,
  ModalButton: ({ children, ...props }: ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button type="button" {...props}>
      {children}
    </button>
  ),
  ConfirmModal: () => null,
}));

vi.mock('@/features/sales/RefundConfirmOverlay', () => ({
  RefundConfirmOverlay: ({
    isOpen,
    approvalPanel,
    confirmDisabled,
  }: {
    isOpen: boolean;
    approvalPanel?: ReactNode;
    confirmDisabled?: boolean;
  }) =>
    isOpen ? (
      <section aria-label="Refund confirmation">
        {approvalPanel}
        <button type="button" disabled={confirmDisabled}>
          Confirm refund
        </button>
      </section>
    ) : null,
}));

import { SaleDetailsModal } from './SaleDetailsModal';

describe('SaleDetailsModal shift policy', () => {
  beforeAll(async () => {
    await i18next.changeLanguage('en');
  });

  beforeEach(() => {
    mocks.refundPolicy.data = undefined;
    mocks.refundPolicy.isFetching = true;
    mocks.refundPolicy.error = null;
    mocks.refundPolicy.refetch.mockReset().mockResolvedValue({ data: undefined, error: null });
    mocks.approval.views = [];
    mocks.approval.approvalRequestId = null;
    mocks.approval.allApproved = false;
    mocks.approval.error = null;
    mocks.approval.refetch.mockReset();
  });

  it('fails closed while checking a manager refund cap and until its exact grant is approved', () => {
    const view = render(<SaleDetailsModal saleId="sale-1" isOpen onClose={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: 'Refund Sale' }));
    expect(screen.getByRole('status')).toHaveTextContent('Checking the current checkout policy');
    expect(screen.getByRole('button', { name: 'Confirm refund' })).toBeDisabled();

    mocks.refundPolicy.isFetching = false;
    mocks.refundPolicy.error = new Error('Policy unavailable');
    view.rerender(<SaleDetailsModal saleId="sale-1" isOpen onClose={vi.fn()} />);
    expect(screen.getByRole('alert')).toHaveTextContent('Approval status could not be refreshed');
    expect(screen.getByRole('button', { name: 'Confirm refund' })).toBeDisabled();

    mocks.refundPolicy.error = null;
    mocks.refundPolicy.data = { requiresApproval: true };
    mocks.approval.views = [
      {
        action: 'sale_refund',
        requestId: 'approval-1',
        status: 'approved',
        decisionReason: null,
      },
    ];
    view.rerender(<SaleDetailsModal saleId="sale-1" isOpen onClose={vi.fn()} />);
    expect(screen.getByTestId('checkout-approval-sale_refund')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Confirm refund' })).toBeDisabled();

    mocks.approval.approvalRequestId = 'approval-1';
    mocks.approval.allApproved = true;
    view.rerender(<SaleDetailsModal saleId="sale-1" isOpen onClose={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Confirm refund' })).toBeEnabled();
  });
});
