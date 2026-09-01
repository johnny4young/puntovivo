import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
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
  receiptHtmlFetch: vi.fn(),
  printSaleReceipt: vi.fn(),
  saleQueryError: null as Error | null,
  sale: {
    id: 'sale-1',
    saleNumber: 'VTA-0001',
    status: 'completed',
    paymentStatus: 'paid' as 'paid' | 'partially_refunded',
    total: 125,
    currencyCode: 'COP',
    items: [],
    fiscalDocuments: [],
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

vi.mock('@/features/sales/receiptPrinter', () => ({
  createEscposReceiptDispatcher: vi.fn(() => undefined),
  printSaleReceipt: mocks.printSaleReceipt,
}));

vi.mock('@/lib/trpc', () => ({
  trpc: {
    useUtils: () => ({
      peripherals: {
        buildReceiptBytes: { fetch: vi.fn() },
        renderReceiptHtml: { fetch: mocks.receiptHtmlFetch },
      },
      sales: { getById: { invalidate: vi.fn() } },
      productSerials: {
        list: { invalidate: vi.fn() },
        lookup: { invalidate: vi.fn() },
      },
    }),
    peripherals: {
      printReceipt: { useMutation: () => ({ mutateAsync: vi.fn() }) },
    },
    sales: {
      getById: {
        useQuery: () => ({
          data: mocks.sale,
          isLoading: false,
          error: mocks.saleQueryError,
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
  const receiptShareSection = <button type="button">Share receipt</button>;
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
    mocks.receiptHtmlFetch.mockReset().mockResolvedValue({
      status: 'ready',
      html: '<html><body>Fresh template</body></html>',
    });
    mocks.printSaleReceipt.mockReset().mockImplementation(async (_sale, options) => {
      await options.htmlProvider?.();
    });
    mocks.saleQueryError = null;
    mocks.sale.paymentStatus = 'paid';
  });

  it('fails closed while checking a manager refund cap and until its exact grant is approved', async () => {
    const view = render(
      <SaleDetailsModal
        saleId="sale-1"
        isOpen
        onClose={vi.fn()}
        receiptShareSection={receiptShareSection}
      />
    );
    await screen.findByRole('button', { name: 'Share receipt' });

    fireEvent.click(screen.getByRole('button', { name: 'Refund Sale' }));
    expect(screen.getByRole('status')).toHaveTextContent('Checking the current checkout policy');
    expect(screen.getByRole('button', { name: 'Confirm refund' })).toBeDisabled();

    mocks.refundPolicy.isFetching = false;
    mocks.refundPolicy.error = new Error('Policy unavailable');
    view.rerender(
      <SaleDetailsModal
        saleId="sale-1"
        isOpen
        onClose={vi.fn()}
        receiptShareSection={receiptShareSection}
      />
    );
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
    view.rerender(
      <SaleDetailsModal
        saleId="sale-1"
        isOpen
        onClose={vi.fn()}
        receiptShareSection={receiptShareSection}
      />
    );
    expect(screen.getByTestId('checkout-approval-sale_refund')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Confirm refund' })).toBeDisabled();

    mocks.approval.approvalRequestId = 'approval-1';
    mocks.approval.allApproved = true;
    view.rerender(
      <SaleDetailsModal
        saleId="sale-1"
        isOpen
        onClose={vi.fn()}
        receiptShareSection={receiptShareSection}
      />
    );
    expect(screen.getByRole('button', { name: 'Confirm refund' })).toBeEnabled();
  });

  it('bypasses the query cache when resolving the active receipt template', async () => {
    render(
      <SaleDetailsModal
        saleId="sale-1"
        isOpen
        onClose={vi.fn()}
        receiptShareSection={receiptShareSection}
      />
    );
    await screen.findByRole('button', { name: 'Share receipt' });

    fireEvent.click(screen.getByRole('button', { name: 'Print' }));

    await waitFor(() => {
      expect(mocks.receiptHtmlFetch).toHaveBeenCalledWith(
        { saleId: 'sale-1', siteId: 'site-1' },
        { staleTime: 0 }
      );
    });
  });

  it('exposes customer receipt sharing for a completed historical sale', async () => {
    render(
      <SaleDetailsModal
        saleId="sale-1"
        isOpen
        onClose={vi.fn()}
        receiptShareSection={receiptShareSection}
      />
    );

    expect(await screen.findByRole('button', { name: 'Share receipt' })).toBeInTheDocument();
  });

  it('allows another partial return but never offers a whole-ticket void afterwards', async () => {
    mocks.sale.paymentStatus = 'partially_refunded';

    render(
      <SaleDetailsModal
        saleId="sale-1"
        isOpen
        onClose={vi.fn()}
        receiptShareSection={receiptShareSection}
      />
    );

    expect(await screen.findByRole('button', { name: 'Refund Sale' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Void Sale' })).not.toBeInTheDocument();
  });

  it('never exposes an internal sale-load error to the operator', () => {
    mocks.saleQueryError = Object.assign(new Error('SQLITE_CORRUPT: internal table detail'), {
      data: { code: 'INTERNAL_SERVER_ERROR' },
    });

    render(
      <SaleDetailsModal
        saleId="sale-1"
        isOpen
        onClose={vi.fn()}
        receiptShareSection={receiptShareSection}
      />
    );

    expect(screen.getByRole('alert')).toHaveTextContent('Something went wrong. Please try again.');
    expect(screen.getByRole('alert')).not.toHaveTextContent('SQLITE_CORRUPT');
  });
});
