import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ComponentProps, ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const tablesQueryMock = vi.fn();
const tableStateQueryMock = vi.fn();

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('@/components/form-controls/Modal', () => ({
  Modal: ({
    isOpen,
    onClose,
    closeOnBackdrop = true,
    closeOnEsc = true,
    showCloseButton = true,
    title,
    children,
    footer,
  }: {
    isOpen: boolean;
    onClose: () => void;
    closeOnBackdrop?: boolean;
    closeOnEsc?: boolean;
    showCloseButton?: boolean;
    title: string;
    children: ReactNode;
    footer: ReactNode;
  }) =>
    isOpen ? (
      <div
        aria-label={title}
        data-close-on-backdrop={closeOnBackdrop}
        data-close-on-esc={closeOnEsc}
      >
        {showCloseButton && (
          <button type="button" data-testid="modal-header-close" onClick={onClose}>
            close
          </button>
        )}
        <button type="button" data-testid="modal-close-request" onClick={onClose}>
          force close request
        </button>
        {children}
        {footer}
      </div>
    ) : null,
  ModalButton: ({
    children,
    onClick,
    disabled,
  }: {
    children: ReactNode;
    onClick: () => void;
    disabled?: boolean;
  }) => (
    <button type="button" onClick={onClick} disabled={disabled}>
      {children}
    </button>
  ),
}));

vi.mock('@/components/dialogs/ProductSearchDialog', () => ({
  ProductSearchDialog: () => null,
}));
vi.mock('@/features/sales/lazySalePaymentModal', () => ({ LazySalePaymentModal: () => null }));
vi.mock('@/features/sales/salePaymentModal.loader', () => ({
  preloadSalePaymentModal: vi.fn(async () => undefined),
}));
vi.mock('@/features/auth/AuthProvider', () => ({
  useAuth: () => ({
    user: { id: 'user-1', role: 'cashier' },
    tenant: { settings: { businessType: 'restaurant' } },
  }),
}));
vi.mock('@/features/tenant/TenantProvider', () => ({
  useTenant: () => ({ currentSite: { id: 'site-1' } }),
}));
vi.mock('@/features/modules/ModulesContext', () => ({
  useIsModuleActive: () => true,
}));
vi.mock('@/features/sales/useQuickCreateStore', () => {
  const useQuickCreateStore = (selector: (state: Record<string, unknown>) => unknown) =>
    selector({ requestedCreateProduct: null, requestedCreateCustomer: null });
  Object.assign(useQuickCreateStore, { getState: () => ({}) });
  return { useQuickCreateStore };
});
vi.mock('@/lib/trpc', () => ({
  trpc: {
    customers: {
      list: { useQuery: () => ({ data: { items: [] } }) },
    },
    categories: {
      tree: { useQuery: () => ({ data: { items: [] } }) },
    },
    providers: {
      list: { useQuery: () => ({ data: { items: [] } }) },
    },
    restaurantTables: {
      list: { useQuery: (...args: unknown[]) => tablesQueryMock(...args) },
    },
    restaurantServices: {
      getTableState: { useQuery: (...args: unknown[]) => tableStateQueryMock(...args) },
    },
  },
}));

import { SalesModals } from './SalesModals';

function baseProps(
  overrides: Partial<ComponentProps<typeof SalesModals>> = {}
): ComponentProps<typeof SalesModals> {
  return {
    isProductSearchOpen: false,
    discountSuggestionSiteId: 'site-1',
    productSearchDialogKey: 0,
    onCloseProductSearch: vi.fn(),
    onSelectProduct: vi.fn(),
    productSearchInitialQuery: '',
    setCartItems: vi.fn(),
    isPaymentModalOpen: false,
    paymentModalKey: 0,
    paymentTotal: 0,
    paymentApprovalSaleId: null,
    paymentApprovalCustomerId: null,
    paymentCustomerLocked: false,
    paymentLockedCustomerName: null,
    paymentApprovalItems: [],
    paymentApprovalDiscountAmount: 0,
    promotionPricingEnabled: false,
    currencyCode: 'COP',
    isPaymentSaving: false,
    saleError: null,
    serviceChargeRate: 0,
    allowTip: false,
    fastCashTrigger: 0,
    paymentRestoreFocusTo: () => null,
    activePriceTier: 1,
    onClosePayment: vi.fn(),
    onSubmitPayment: vi.fn(async () => undefined),
    selectedSaleId: null,
    onCloseSaleDetails: vi.fn(),
    isSuspendLabelPromptOpen: true,
    isSuspending: false,
    suspendLabelDraft: '',
    onChangeSuspendLabel: vi.fn(),
    onCloseSuspendPrompt: vi.fn(),
    onConfirmSuspend: vi.fn(),
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  tablesQueryMock.mockReturnValue({
    data: {
      items: [
        { id: 'table-1', name: 'Mesa 1', seatCount: 6 },
        { id: 'table-2', name: 'Mesa 2', seatCount: 2 },
      ],
    },
    isLoading: false,
    error: null,
  });
  tableStateQueryMock.mockReturnValue({
    data: { service: null, checks: [], diners: [] },
    isLoading: false,
    error: null,
  });
});

describe('SalesModals restaurant suspend path', () => {
  it('keeps generic parking available when no table is selected', () => {
    const onConfirmSuspend = vi.fn();
    render(<SalesModals {...baseProps({ onConfirmSuspend })} />);

    fireEvent.click(screen.getByRole('button', { name: 'park.labelPromptConfirm' }));

    expect(onConfirmSuspend).toHaveBeenCalledWith(undefined);
  });

  it('forwards an explicit table and operator-entered guest count', () => {
    const onConfirmSuspend = vi.fn();
    render(<SalesModals {...baseProps({ onConfirmSuspend })} />);
    fireEvent.change(screen.getByTestId('suspend-table-select'), {
      target: { value: 'table-1' },
    });

    expect(screen.getByTestId('suspend-guest-count')).toHaveValue(1);
    fireEvent.change(screen.getByTestId('suspend-guest-count'), {
      target: { value: '4' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'park.labelPromptConfirm' }));

    expect(onConfirmSuspend).toHaveBeenCalledWith({ tableId: 'table-1', guestCount: 4 });
  });

  it('clears a committed table choice before the next park operation', async () => {
    const onConfirmSuspend = vi.fn(async () => true);
    render(<SalesModals {...baseProps({ onConfirmSuspend })} />);
    fireEvent.change(screen.getByTestId('suspend-table-select'), {
      target: { value: 'table-1' },
    });

    fireEvent.click(screen.getByRole('button', { name: 'park.labelPromptConfirm' }));

    await waitFor(() => expect(screen.getByTestId('suspend-table-select')).toHaveValue(''));
    expect(screen.queryByTestId('suspend-guest-count')).not.toBeInTheDocument();
  });

  it('preserves the table and guest selection while a failed suspend is pending', async () => {
    let resolveFirstSuspend: ((value: boolean) => void) | undefined;
    const onConfirmSuspend = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<boolean>(resolve => {
            resolveFirstSuspend = resolve;
          })
      )
      .mockResolvedValueOnce(true);
    const onCloseSuspendPrompt = vi.fn();
    const props = baseProps({ onConfirmSuspend, onCloseSuspendPrompt });
    const { rerender } = render(<SalesModals {...props} />);
    fireEvent.change(screen.getByTestId('suspend-table-select'), {
      target: { value: 'table-1' },
    });
    fireEvent.change(screen.getByTestId('suspend-guest-count'), {
      target: { value: '4' },
    });

    fireEvent.click(screen.getByRole('button', { name: 'park.labelPromptConfirm' }));
    await waitFor(() => expect(onConfirmSuspend).toHaveBeenCalledTimes(1));
    rerender(<SalesModals {...props} isSuspending />);

    const modal = screen.getByLabelText('park.labelPromptTitle');
    expect(modal).toHaveAttribute('data-close-on-backdrop', 'false');
    expect(modal).toHaveAttribute('data-close-on-esc', 'false');
    expect(screen.queryByTestId('modal-header-close')).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId('modal-close-request'));
    expect(onCloseSuspendPrompt).not.toHaveBeenCalled();
    expect(screen.getByTestId('suspend-table-select')).toHaveValue('table-1');
    expect(screen.getByTestId('suspend-guest-count')).toHaveValue(4);

    await act(async () => {
      resolveFirstSuspend?.(false);
    });
    rerender(<SalesModals {...props} isSuspending={false} />);

    expect(screen.getByTestId('suspend-table-select')).toHaveValue('table-1');
    expect(screen.getByTestId('suspend-guest-count')).toHaveValue(4);
    fireEvent.click(screen.getByRole('button', { name: 'park.labelPromptConfirm' }));
    await waitFor(() => expect(onConfirmSuspend).toHaveBeenCalledTimes(2));
    expect(onConfirmSuspend).toHaveBeenLastCalledWith({ tableId: 'table-1', guestCount: 4 });
  });

  it('clamps guests to table capacity instead of defaulting to capacity', () => {
    const onConfirmSuspend = vi.fn();
    render(<SalesModals {...baseProps({ onConfirmSuspend })} />);
    fireEvent.change(screen.getByTestId('suspend-table-select'), {
      target: { value: 'table-2' },
    });
    expect(screen.getByTestId('suspend-guest-count')).toHaveValue(1);

    fireEvent.change(screen.getByTestId('suspend-guest-count'), {
      target: { value: '99' },
    });
    expect(screen.getByTestId('suspend-guest-count')).toHaveValue(2);
    fireEvent.click(screen.getByRole('button', { name: 'park.labelPromptConfirm' }));
    expect(onConfirmSuspend).toHaveBeenCalledWith({ tableId: 'table-2', guestCount: 2 });
  });

  it('normalizes fractional guest input to a whole diner count', () => {
    const onConfirmSuspend = vi.fn();
    render(<SalesModals {...baseProps({ onConfirmSuspend })} />);
    fireEvent.change(screen.getByTestId('suspend-table-select'), {
      target: { value: 'table-1' },
    });
    const guestInput = screen.getByTestId('suspend-guest-count');
    expect(guestInput).toHaveAttribute('step', '1');
    fireEvent.change(guestInput, { target: { value: '3.9' } });
    expect(guestInput).toHaveValue(3);
    fireEvent.click(screen.getByRole('button', { name: 'park.labelPromptConfirm' }));

    expect(onConfirmSuspend).toHaveBeenCalledWith({ tableId: 'table-1', guestCount: 3 });
  });

  it('locks and reuses the guest count of an existing table service', () => {
    tableStateQueryMock.mockReturnValue({
      data: { service: { id: 'service-1', guestCount: 3 }, checks: [], diners: [] },
      isLoading: false,
      error: null,
    });
    const onConfirmSuspend = vi.fn();
    render(<SalesModals {...baseProps({ onConfirmSuspend })} />);
    fireEvent.change(screen.getByTestId('suspend-table-select'), {
      target: { value: 'table-1' },
    });

    expect(screen.getByTestId('suspend-guest-count')).toHaveValue(3);
    expect(screen.getByTestId('suspend-guest-count')).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'park.labelPromptConfirm' }));
    expect(onConfirmSuspend).toHaveBeenCalledWith({ tableId: 'table-1', guestCount: 3 });
  });

  it.each([
    ['loading', { data: undefined, isLoading: true, error: null }, 'suspend-table-state-loading'],
    [
      'error',
      { data: undefined, isLoading: false, error: new Error('busy') },
      'suspend-table-state-error',
    ],
  ])('blocks restaurant parking while table state is %s', (_label, state, testId) => {
    tableStateQueryMock.mockReturnValue(state);
    const onConfirmSuspend = vi.fn();
    render(<SalesModals {...baseProps({ onConfirmSuspend })} />);
    fireEvent.change(screen.getByTestId('suspend-table-select'), {
      target: { value: 'table-1' },
    });

    expect(screen.getByTestId(testId)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'park.labelPromptConfirm' })).toBeDisabled();
    expect(onConfirmSuspend).not.toHaveBeenCalled();
  });

  it('does not silently fall back to generic parking when the selected table disappears', () => {
    const onConfirmSuspend = vi.fn();
    const props = baseProps({ onConfirmSuspend });
    const { rerender } = render(<SalesModals {...props} />);
    fireEvent.change(screen.getByTestId('suspend-table-select'), {
      target: { value: 'table-1' },
    });

    tablesQueryMock.mockReturnValue({ data: { items: [] }, isLoading: false, error: null });
    rerender(<SalesModals {...props} />);

    expect(screen.getByTestId('suspend-table-state-error')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'park.labelPromptConfirm' })).toBeDisabled();
    expect(onConfirmSuspend).not.toHaveBeenCalled();
  });
});
